// All ordinary app speech passes through the existing Speech wrapper.
// Hazard output bypasses that wrapper and owns the audio while this lock is held.
let hazardOwnsAudio = false;
export const isHazardAudioActive = () => hazardOwnsAudio;
export const setHazardAudioActive = (active: boolean) => { hazardOwnsAudio = active; };
