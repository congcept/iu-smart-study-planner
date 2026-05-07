const audioContext = typeof window !== 'undefined'
  ? new (window.AudioContext || (window as unknown as Record<string, AudioContextConstructor>).webkitAudioContext)()
  : null;

const playTone = (frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.1) => {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
};

export const playCompleteSound = () => {
  playTone(523.25, 0.08, 'sine', 0.1);
  setTimeout(() => playTone(659.25, 0.08, 'sine', 0.1), 50);
  setTimeout(() => playTone(783.99, 0.12, 'sine', 0.1), 100);
};

export const playUncompleteSound = () => {
  playTone(440, 0.1, 'sine', 0.05);
  setTimeout(() => playTone(349.23, 0.15, 'sine', 0.05), 60);
};

export const playPlanSound = () => {
  playTone(880, 0.06, 'sine', 0.08);
};

export const playUnplanSound = () => {
  playTone(660, 0.08, 'sine', 0.05);
};

export const playLockedSound = () => {
  playTone(150, 0.05, 'triangle', 0.08);
};

export const playToggleSound = () => {
  playTone(1200, 0.03, 'sine', 0.05);
};

export const playRecommendationsSound = () => {
  playTone(200, 0.03, 'square', 0.08);
};
