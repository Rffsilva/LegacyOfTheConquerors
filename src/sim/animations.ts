// Animation tables from loader.cpp. A set is indexed by `curdir + ani_type * 8`; each sequence
// is a list of pixie frames terminated by -1, exactly as in the original.

export type Sequence = readonly number[];
export type AnimationSet = readonly (Sequence | null)[];

const repeat = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);
const eightOf = (...seqs: Sequence[]): Sequence[] => seqs.flatMap((s) => repeat(8, s));

// Walking (bit*) and attacking (att*) for the standard eight-facing sprites.
const bit = [
  [1, 5, 1, 9, -1], // up
  [13, 17, 13, 21, -1], // up-right
  [2, 6, 2, 10, -1], // right
  [14, 18, 14, 22, -1], // down-right
  [0, 4, 0, 8, -1], // down
  [12, 16, 12, 20, -1], // down-left
  [3, 7, 3, 11, -1], // left
  [15, 19, 15, 23, -1], // up-left
];
const att = [
  [1, 5, 1, -1],
  [13, 17, 13, -1],
  [2, 6, 2, -1],
  [14, 18, 14, -1],
  [0, 4, 0, -1],
  [12, 16, 12, -1],
  [3, 7, 3, -1],
  [15, 19, 15, -1],
];
const bitm2 = [21, 25, 21, 29, -1];
const bitm4 = [22, 26, 22, 30, -1];
const bitm6 = [20, 24, 20, 28, -1];
const bitm8 = [23, 27, 23, 31, -1];
const mageatt = [
  [5, 17, 1, -1],
  [25, 33, 21, -1],
  [6, 18, 2, -1],
  [26, 34, 22, -1],
  [4, 16, 0, -1],
  [24, 32, 20, -1],
  [7, 19, 3, -1],
  [27, 35, 23, -1],
];
const teleOut1 = [12, 13, 14, 15, -1];
const teleIn1 = [15, 14, 13, 12, 1, -1];
const teleIn2 = [15, 14, 13, 12, 2, -1];
const teleIn3 = [15, 14, 13, 12, 0, -1];
const teleIn4 = [15, 14, 13, 12, 3, -1];
const gsDown = [0, 1, 2, 3, -1];
const gsUp = [3, 2, 1, 0, -1];
const skelGrow = [27, 26, 25, 24, 0, -1];
const skelShrink = [0, 24, 25, 26, 27, -1];
const slimePulse = [0, 0, 1, 1, 2, 2, 1, 1, -1];
const slimeSplit = [8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, -1];
const smallSlime = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, -1];

const series8 = [0, 1, 2, 3, 4, 5, 6, 7, -1];
const series16 = [0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, -1];
const bomb1 = [
  0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 4, 5, 4, 5, 4, 5, 4, 5, 6, 7, 6, 7, 6, 7, 6, 7, 8, 9, 8, 9, 8, 9, 8, 9,
  10, 11, 10, 11, 10, 11, 10, 11, 12, 12, -1,
];
const explosion1 = [0, 1, 2, -1];
const cloudCycle = [0, 1, 2, 3, 2, 1, -1];
const markerCycle = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, -1];
const kni1 = [7, 6, 5, 4, 3, 2, 1, 0, -1];
const kni2 = [0, 1, 2, 3, 4, 5, 6, 7, -1];
const rock1 = [0, -1];
const grow1 = [4, 3, 2, 1, 0, -1];
const door1 = [0, -1];
const door2 = [1, -1];
const doorOpen1 = [0, 2, 3, 4, 1, -1];
const doorOpen2 = [1, 4, 3, 2, 0, -1];
const arrow = [[1, -1], [5, -1], [2, -1], [6, -1], [0, -1], [4, -1], [3, -1], [7, -1]];
const blob1 = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, -1];
const none1 = [0, -1];
const towerGlow1 = [1, 1, 1, 2, 2, 0, -1];
const tent1 = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 0, -1];
const blood1 = [3, 2, 1, 0, -1];
const glowGrow = [0, 1, 2, 3, -1];
const glowPulse = [4, 5, 6, 7, 8, 9, 8, 7, 6, 5, -1];
const food1 = [0, -1];

export const ANI = {
  man: [...bit, ...att],
  skel: [...bit, ...att, ...repeat(8, skelShrink), ...repeat(8, skelGrow)],
  mage: [
    bit[0], bitm2, bit[2], bitm4, bit[4], bitm6, bit[6], bitm8,
    ...mageatt,
    ...repeat(8, teleOut1),
    teleIn1, teleIn1, teleIn2, teleIn2, teleIn3, teleIn3, teleIn4, teleIn4,
  ],
  gs: repeat(8, [gsDown, gsUp]).flat(),
  slime: [...repeat(24, slimePulse), ...repeat(8, null), ...repeat(8, slimeSplit)],
  smallSlime: repeat(16, smallSlime),
  expand8: repeat(16, series8),
  ani16: repeat(16, series16),
  bomb1: repeat(16, bomb1),
  explosion1: repeat(16, explosion1),
  cloud: repeat(16, cloudCycle),
  marker: repeat(16, markerCycle),
  kni: [kni2, kni2, kni1, kni1, kni1, kni1, kni2, kni2, kni2, kni2, kni1, kni1, kni1, kni1, kni2, kni2],
  rock: repeat(16, rock1),
  tree: eightOf(rock1, grow1),
  door: [door1, door1, door2, door2, door1, door1, door2, door2, door1, door1, door2, door2, door1, door1, door2, door2],
  doorOpen: [
    door2, door2, door1, door1, door2, door2, door1, door1,
    doorOpen1, doorOpen1, doorOpen2, doorOpen2, doorOpen1, doorOpen1, doorOpen2, doorOpen2,
  ],
  arrow: [...arrow, ...arrow],
  blob1: repeat(16, blob1),
  none: repeat(16, none1),
  tower: eightOf(none1, towerGlow1),
  tent: eightOf(none1, tent1),
  blood: eightOf(rock1, blood1),
  glowGrow: eightOf(rock1, glowGrow, glowPulse),
  food: repeat(16, food1),
} satisfies Record<string, AnimationSet>;

/** ani[index][cycle], treating anything past the table like the -1 terminator. */
export function aniFrame(set: AnimationSet | null, index: number, cycle: number): number {
  return set?.[index]?.[cycle] ?? -1;
}
