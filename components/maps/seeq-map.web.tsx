import React, { Children, Fragment, forwardRef, isValidElement, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MapViewProps, MapMarkerProps as MarkerProps, MapPolylineProps as PolylineProps, Region, LatLng } from 'react-native-maps';
import type * as Leaflet from 'leaflet';
import './leaflet.web.css';

type FitOptions = { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean };
type MapHandle = { animateToRegion: (region: Region, duration?: number) => void; fitToCoordinates: (coordinates: LatLng[], options?: FitOptions) => void };
type ElementProps = Partial<MarkerProps & PolylineProps> & { children?: React.ReactNode };
type WebMapProps = Omit<MapViewProps, 'region' | 'initialRegion'> & { region?: Region; initialRegion?: Region };
export function Marker(_props: MarkerProps) { return null; }
export function Polyline(_props: PolylineProps) { return null; }

function walk(children: React.ReactNode, callback: (element: React.ReactElement<ElementProps>) => void) {
  Children.forEach(children, child => {
    if (!isValidElement<ElementProps>(child)) return;
    if (child.type === Fragment) walk((child.props as ElementProps).children, callback);
    else callback(child);
  });
}
function valid(coord: LatLng) { return Number.isFinite(coord?.latitude) && Number.isFinite(coord?.longitude); }

const MapView = forwardRef<MapHandle, WebMapProps>(function WebMap({ initialRegion, region, children, style, showsUserLocation, onMapReady, ..._props }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const userMarker = useRef<Leaflet.CircleMarker | null>(null);
  const initial = useRef(region ?? initialRegion);
  const position = useRef<LatLng | undefined>(region ?? initialRegion);
  const pendingFit = useRef<{ coordinates: LatLng[]; options?: FitOptions } | null>(null);
  const fitted = useRef(false);
  const onReady = useRef(onMapReady);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onReady.current = onMapReady; }, [onMapReady]);

  const fit = (coordinates: LatLng[], options?: FitOptions) => {
    const points = coordinates.filter(valid).map(point => [point.latitude, point.longitude] as [number, number]);
    if (!map.current || !points.length) { pendingFit.current = { coordinates, options }; return; }
    const padding = options?.edgePadding;
    map.current.fitBounds(points, {
      paddingTopLeft: padding ? [padding.left, padding.top] : [32, 32],
      paddingBottomRight: padding ? [padding.right, padding.bottom] : [32, 32],
      maxZoom: 18, animate: options?.animated ?? false,
    });
    fitted.current = true;
  };
  const showRegion = (next: Region, animate = false) => {
    initial.current = next; position.current = next;
    userMarker.current?.setLatLng([next.latitude, next.longitude]);
    if (!map.current || !leaflet.current) return;
    const halfLat = Math.max(next.latitudeDelta ?? 0.006, 0.0001) / 2;
    const halfLon = Math.max(next.longitudeDelta ?? 0.006, 0.0001) / 2;
    map.current.fitBounds([[next.latitude - halfLat, next.longitude - halfLon], [next.latitude + halfLat, next.longitude + halfLon]], { animate });
  };
  useImperativeHandle(ref, () => ({
    animateToRegion: next => showRegion(next, true),
    fitToCoordinates: fit,
  }));

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    // Leaflet touches window/document at import time; load it only in the browser.
    void import('leaflet').then(L => {
      if (disposed || !container.current) return;
      leaflet.current = L;
      const instance = L.map(container.current, { zoomControl: true, attributionControl: false });
      map.current = instance;
      L.control.attribution({ position: 'topright', prefix: false }).addTo(instance);
      const tileUrl = process.env.EXPO_PUBLIC_WEB_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      L.tileLayer(tileUrl, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' })
        .on('tileerror', () => { if (!disposed) setError('지도 이미지를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'); })
        .on('tileload', () => { if (!disposed) setError(''); })
        .addTo(instance);
      layers.current = L.layerGroup().addTo(instance);
      showRegion(initial.current ?? { latitude: 37.5665, longitude: 126.978, latitudeDelta: 0.02, longitudeDelta: 0.02 });
      if (pendingFit.current) fit(pendingFit.current.coordinates, pendingFit.current.options);
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(() => instance.invalidateSize());
        resize.observe(container.current);
      }
      setReady(true);
      onReady.current?.();
    }).catch(() => { if (!disposed) setError('웹 지도를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'); });
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; layers.current = null; };
    // The map instance is created once; later props are applied below.
  }, []);

  useEffect(() => {
    if (region && ready) showRegion(region);
  }, [region, ready]);
  useEffect(() => {
    if (!ready || !leaflet.current || !layers.current) return;
    const L = leaflet.current, group = layers.current;
    group.clearLayers();
    userMarker.current = null;
    let route: LatLng[] = [];
    walk(children, child => {
      if (child.type === Polyline && child.props.coordinates) {
        const coords = child.props.coordinates.filter(valid);
        route = coords;
        if (coords.length > 1) L.polyline(coords.map(point => [point.latitude, point.longitude]), {
          color: typeof child.props.strokeColor === 'string' ? child.props.strokeColor : '#3B82F6',
          weight: child.props.strokeWidth ?? 5,
        }).addTo(group);
      } else if (child.type === Marker && child.props.coordinate && valid(child.props.coordinate)) {
        const { latitude, longitude } = child.props.coordinate;
        const marker = L.circleMarker([latitude, longitude], { radius: 8, color: '#111', weight: 2, fillColor: '#D2FF00', fillOpacity: 1 }).addTo(group);
        if (child.props.title) {
          const label = document.createElement('span'); label.textContent = child.props.title;
          marker.bindTooltip(label);
        }
      }
    });
    if (showsUserLocation && position.current && valid(position.current)) {
      userMarker.current = L.circleMarker([position.current.latitude, position.current.longitude], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(group);
    }
    if (route.length > 1 && !fitted.current) fit(route);
    if (!route.length) fitted.current = false;
  }, [children, ready, showsUserLocation]);
  return (
    <View style={[{ minHeight: 100, backgroundColor: '#dce5e9', overflow: 'hidden' }, style]}>
      <div ref={container} aria-label="SeeQ 웹 지도" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0 }} />
      {!ready && !error && <Text style={styles.notice}>웹 지도 불러오는 중…</Text>}
      {!!error && <Text style={styles.notice}>{error}</Text>}
    </View>
  );
});
const styles = StyleSheet.create({ notice: { position: 'absolute', bottom: 8, left: 8, right: 8, padding: 10, color: '#fff', backgroundColor: '#222e', fontSize: 14 } });
export default MapView;
