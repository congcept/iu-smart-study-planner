const audioContext = typeof window !== 'undefined'
  ? new (window.AudioContext || (window as unknown as Record<string, AudioContextConstructor>).webkitAudioContext)()
  : null;

const playTone = (frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.3) => {
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
  playTone(523.25, 0.15, 'sine', 0.3);
  setTimeout(() => playTone(659.25, 0.15, 'sine', 0.3), 80);
  setTimeout(() => playTone(783.99, 0.25, 'sine', 0.3), 160);
};

export const playUncompleteSound = () => {
  playTone(440, 0.2, 'sine', 0.2);
  setTimeout(() => playTone(349.23, 0.3, 'sine', 0.2), 100);
};
