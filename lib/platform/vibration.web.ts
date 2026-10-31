export const Vibration = {
  vibrate(pattern: number | number[] = 400, _repeat = false) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  },
  cancel() { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(0); },
};
