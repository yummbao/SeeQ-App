export type WebExperienceProps = {
  backendError?: string;
  isDemo: boolean;
  hasLocation: boolean;
  onRequestLocation: () => void;
  onHazardSettings: () => void;
};
export function WebExperienceBar(_props: WebExperienceProps) { return null; }
export type WebLocationGateProps = { onDemo: () => void; onRetry: () => void; onMenu: () => void };
export function WebLocationGate(_props: WebLocationGateProps) { return null; }
