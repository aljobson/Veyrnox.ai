// A short synthesised chime (no audio file). It runs only after a person has already interacted with the page, so browsers allow it,
// and it stays silent if sound is off or the browser has no audio.
const OFF_KEY = 'veyrnox_sound_off';
const NOTES = [523.25, 659.25, 783.99, 1046.5];
export function soundEnabled() {
  try { return localStorage.getItem(OFF_KEY) !== '1'; } catch { return true; }
}
export function playCelebrationSound() {
  if (typeof window === 'undefined' || !soundEnabled()) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    const start = context.currentTime + 0.02;
    NOTES.forEach((hz, i) => {
      const osc = context.createOscillator(), gain = context.createGain();
      osc.type = 'sine'; osc.frequency.value = hz;
      const at = start + i * 0.09;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain); gain.connect(context.destination);
      osc.start(at); osc.stop(at + 0.55);
    });
    window.setTimeout(() => { try { void context.close(); } catch { /* already closed */ } }, 1500);
  } catch { /* sound is a bonus; never break the screen */ }
}
