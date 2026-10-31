// Do not fabricate a north-facing heading or request unsupported sensor APIs.
export const Magnetometer = {
  addListener: (_callback: (value: { x: number; y: number; z: number }) => void) => ({ remove() {} }),
  setUpdateInterval: (_milliseconds: number) => {},
};
