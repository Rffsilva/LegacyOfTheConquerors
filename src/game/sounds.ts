/** Simulation sound names -> files in public/assets/sound (sounds.h). */
export const SOUND_FILES: Readonly<Record<string, string>> = {
  blast: 'blast1.wav',
  bolt: 'bolt1.wav',
  boom: 'boom.wav',
  charge: 'charge.wav',
  clang: 'clang.wav',
  die1: 'die1.wav',
  die2: 'die2.wav',
  eat: 'eat.wav',
  explode: 'explode1.wav',
  sparkle: 'faerie1.wav',
  fwip: 'fwip.wav',
  heal: 'heal1.wav',
  money: 'money.wav',
  roar: 'roar.wav',
  teleport: 'teleport.wav',
  bow: 'twang.wav',
  yo: 'yo.wav',
};

export const soundKey = (name: string) => `sfx:${name}`;
