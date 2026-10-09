// In-game help, condensed from the original's classes.txt, glad.hlp and README.

import { LivingFamily as L, TreasureFamily as T } from './objects.ts';

export interface SpecialHelp {
  name: string;
  text: string;
  /** What the special does with the alternate (shifter) key held, if anything. */
  alternate?: { name: string; text: string };
}

export interface UnitHelp {
  family: number;
  name: string;
  text: string;
  specials: SpecialHelp[];
  /** Enemy-only types you can't hire. */
  enemyOnly?: boolean;
}

/** Specials unlock at levels 1, 4, 7, 10 and 13. */
export const specialUnlockLevel = (slot: number) => (slot - 1) * 3 + 1;

export const UNITS: UnitHelp[] = [
  {
    family: L.SOLDIER,
    name: 'Soldier',
    text: 'The basic grunt: absorbs and deals damage and moves moderately fast. Throws a magical blade that flies back, so he must wait for it before throwing again.',
    specials: [
      { name: 'Charge', text: 'Rush forward at high speed, striking and knocking back anyone in the way.' },
      { name: 'Boomerang', text: 'A spiralling blade that cuts through several targets before falling.' },
      { name: 'Whirlwind', text: 'Lash out at every foe within reach, knocking them off balance.' },
      { name: 'Disarm', text: 'Leave the enemies right in front unable to fight for a while.' },
    ],
  },
  {
    family: L.BARBARIAN,
    name: 'Barbarian',
    text: 'More will than skill: strong and tough, fighting with a heavy hammer. Magic often fades off their skin, halving its damage.',
    specials: [
      { name: 'Hurl Boulder', text: 'Rip up a stone and throw it. Strength decides how far and how hard.' },
      { name: 'Exploding Boulder', text: 'Throw it so hard it explodes on impact, hurting everyone nearby.' },
      { name: 'Berserk', text: 'New: fly into a battle rage, moving and striking twice as fast for a while and shrugging off a quarter of your wounds.' },
    ],
  },
  {
    family: L.ELF,
    name: 'Elf',
    text: 'Small and weak but hard to pin down. Elves walk through dense forest (more easily with higher dexterity) and throw stones.',
    specials: [
      { name: 'Rocks', text: 'A small handful of rocks.' },
      { name: 'Bouncing Rocks', text: 'Rocks that bounce off walls and fly further.' },
      { name: 'Lots of Rocks', text: 'An even bigger load of bouncing rocks.' },
      { name: 'Mega Rocks', text: 'A huge, destructive barrage of bouncing rocks.' },
    ],
  },
  {
    family: L.ARCHER,
    name: 'Archer',
    text: 'Fleet of foot with long-range arrows. Not as strong as a soldier, but a fine squad backbone.',
    specials: [
      { name: 'Fire Arrows', text: 'Spin round loosing blazing arrows in every direction.' },
      { name: 'Barrage', text: 'Three arrows at one target at once.' },
      { name: 'Exploding Bolt', text: 'A single, buffed flaming bolt that explodes on impact, hurting friend and foe.' },
    ],
  },
  {
    family: L.MAGE,
    name: 'Mage',
    text: 'Slow, fragile and poor at close quarters, but their fireballs pack a big punch.',
    specials: [
      {
        name: 'Teleport',
        text: 'Vanish and reappear somewhere random on the field.',
        alternate: { name: 'Teleport Marker', text: 'Place a marker (needs 75 Int); later teleports return to it. Intelligence sets how many uses it has.' },
      },
      { name: 'Warp Space', text: 'Twist space around you with slow fireballs in every direction; stronger with more spare magic.' },
      { name: 'Freeze Time', text: 'Everything not on your team stands still for a while. No magic regenerates meanwhile.' },
      { name: 'Energy Wave', text: 'An expanding wave of energy that passes through walls and hits many enemies.' },
      { name: 'Heartburst', text: 'Every enemy nearby bursts into flame, sharing half your spare magic as damage.' },
    ],
  },
  {
    family: L.CLERIC,
    name: 'Cleric',
    text: 'Slow but sturdier than a mage. Heals, and deals with the dead. AI clerics on your team heal anyone who bumps into them.',
    specials: [
      {
        name: 'Heal',
        text: 'Heal every hurt ally gathered close by for the price of one spell.',
        alternate: { name: 'Mystic Mace', text: 'Conjure a spinning ethereal mace that blocks and strikes (needs 50 Int).' },
      },
      {
        name: 'Raise Undead',
        text: 'Raise a skeleton from a nearby bloodstain to fight for you for a while.',
        alternate: { name: 'Turn Undead', text: 'Destroy nearby skeletons and ghosts (needs 60 Int).' },
      },
      {
        name: 'Raise Ghost',
        text: 'Raise the spirit instead: an ethereal ghost that flies anywhere.',
        alternate: { name: 'Turn Undead', text: 'The stronger form, also laying ghosts to rest.' },
      },
      { name: 'Resurrect', text: 'Bring a fallen comrade back at half health (taxing: costs them experience). Fallen enemies rise as your ghosts.' },
    ],
  },
  {
    family: L.THIEF,
    name: 'Thief',
    text: 'Fast and tougher than spellcasters. Throws knives in quick succession from an endless supply.',
    specials: [
      { name: 'Drop Bomb', text: 'A small bomb that does not care whose side you are on.' },
      { name: 'Cloak', text: 'Hide in the shadows, unseen by enemies for a while.' },
      {
        name: 'Taunt',
        text: 'Lure nearby enemies away from their targets and after you.',
        alternate: { name: 'Charm', text: 'Win one nearby enemy over to your side for a while (or anger it).' },
      },
      { name: 'Poison Cloud', text: 'A drifting cloud that poisons enemies inside it.' },
    ],
  },
  {
    family: L.DRUID,
    name: 'Druid',
    text: 'Magician of nature. Throws fast, long-range lightning.',
    specials: [
      { name: 'Grow Tree', text: 'Plant a tree that blocks enemies and soaks up their attacks.' },
      { name: 'Summon Faerie', text: 'A faerie that hunts enemies, freezing them in their tracks.' },
      { name: 'Reveal', text: 'See gold, silver, potions and monster generators on the radar for a while.' },
      { name: 'Protection', text: 'Surround nearby allies with protective winds that absorb attacks.' },
    ],
  },
  {
    family: L.ORC,
    name: 'Orc',
    text: 'Strong and hard to hurt, with little else. No ranged attack, but terrible damage up close.',
    specials: [
      { name: 'Howl', text: 'A howl of rage that freezes nearby enemies in fear.' },
      { name: 'Eat Corpse', text: 'Eat a nearby body to regain health.' },
      { name: 'Bloodlust', text: 'New: a war cry that drives you and nearby allies into a frenzy, acting twice as fast for a while.' },
    ],
  },
  {
    family: L.SKELETON,
    name: 'Skeleton',
    text: 'Pathetic remains, but blindingly fast. Throws bones.',
    specials: [
      { name: 'Tunnel', text: 'Burrow underground and pop up nearby, even past walls.' },
      { name: 'Bone Storm', text: 'New: hurl bones in every direction at once.' },
      { name: 'Raise the Dead', text: 'New: skeletons rise from up to three bloodstains nearby to fight for you for a while.' },
    ],
  },
  {
    family: L.FIREELEMENTAL,
    name: 'Fire Elemental',
    text: 'Strong and quick, hurling flaming meteors. Explodes when it dies.',
    specials: [
      { name: 'Starburst', text: 'Flaming meteors in all directions.' },
      { name: 'Immolate', text: 'New: burst into flame, scorching every enemy right next to you.' },
      { name: 'Meteor Shower', text: 'New: meteors fall on several enemies all around.' },
    ],
  },
  {
    family: L.SMALL_SLIME,
    name: 'Slime',
    text: 'Starts as a small patch of ooze that grows into a big slime, which then splits in two. Weak against fire and magic.',
    specials: [
      { name: 'Grow / Split', text: 'Grow to the next size when there is room; big slimes split into two small ones.' },
      { name: 'Acid Spray', text: 'New: spit blobs of acid in every direction.' },
      { name: 'Acid Pool', text: 'New: leave a pool of acid fumes that poisons enemies in it.' },
    ],
  },
  {
    family: L.FAERIE,
    name: 'Faerie',
    text: 'A tiny, delicate flyer whose magic powder freezes enemies in place.',
    specials: [
      { name: 'Mend', text: 'New: heal the most hurt ally nearby.' },
      { name: 'Sleep Dust', text: 'New: enemies close by fall asleep for a while.' },
      { name: 'Glamour', text: 'New: you and nearby allies fade from sight for a while.' },
    ],
  },
  {
    family: L.GHOST,
    name: 'Ghost',
    text: 'Passes through walls and trees. No ranged attack, but a deadly chilling touch.',
    specials: [
      { name: 'Scare', text: 'A wail that sends nearby enemies fleeing.' },
      { name: 'Life Drain', text: 'New: steal life from the nearest enemy to heal yourself.' },
      { name: 'Banshee Wail', text: 'New: a scream that hurts and stuns every enemy around.' },
    ],
  },
  {
    family: L.ARCHMAGE,
    name: 'Archmage',
    enemyOnly: true,
    text: 'A specialised mage with extraordinary firepower, all hinging on intelligence.',
    specials: [
      { name: 'Teleport', text: 'As the mage, including the marker.' },
      {
        name: 'Heartburst',
        text: 'A stronger heartburst.',
        alternate: { name: 'Chain Lightning', text: 'A bolt that seeks an enemy, then splits to strike others.' },
      },
      {
        name: 'Summon Image',
        text: 'An illusory warrior that vanishes at the first hit.',
        alternate: { name: 'Summon Elemental', text: 'A real fire elemental (needs 150 Int).' },
      },
      { name: 'Mind Control', text: 'Bend nearby enemies to your will for a while.' },
    ],
  },
  { family: L.GOLEM, name: 'Golem', enemyOnly: true, text: 'A slow, enormous brute that hurls boulders.', specials: [] },
  { family: L.GIANT_SKELETON, name: 'Giant Skeleton', enemyOnly: true, text: 'A towering undead that hurls boulders.', specials: [] },
];

export interface ItemHelp {
  family: number;
  name: string;
  text: string;
}

export const ITEMS: ItemHelp[] = [
  { family: T.DRUMSTICK, name: 'Food', text: 'Restores health to whoever walks over it (if hurt).' },
  { family: T.GOLD_BAR, name: 'Gold bar', text: 'Adds 200 × its level to your score. Only your team picks it up.' },
  { family: T.SILVER_BAR, name: 'Silver bar', text: 'Adds 50 × its level to your score.' },
  { family: T.MAGIC_POTION, name: 'Mana potion', text: 'Refills magic, and then some.' },
  { family: T.INVIS_POTION, name: 'Invisibility potion', text: 'Enemies lose track of you for a while.' },
  { family: T.INVULNERABLE_POTION, name: 'Invulnerability potion', text: 'Nothing can hurt you for a while.' },
  { family: T.FLIGHT_POTION, name: 'Flight potion', text: 'Fly over water, trees and walls for a while.' },
  { family: T.SPEED_POTION, name: 'Speed potion', text: 'Move faster for a while.' },
  { family: T.KEY, name: 'Key', text: 'Opens doors of the same number.' },
  { family: T.TELEPORTER, name: 'Teleporter', text: 'Steps you to its matching teleporter elsewhere on the field.' },
  { family: T.LIFE_GEM, name: 'Life gem', text: 'Left by a fallen squad member; picking it up recovers part of their worth as score.' },
  { family: T.EXIT, name: 'Exit', text: 'Walk your character onto it to leave once every enemy is beaten. Exits to fields you already hold let you fall back early.' },
];

export const GENERATORS = [
  { name: 'Tent', text: 'Spawns skeletons.' },
  { name: 'Tower', text: 'Mages teleport in from it.' },
  { name: 'Bone pile', text: 'Raises ghosts.' },
  { name: 'Tree house', text: 'Elves come out of it.' },
];

export const TIPS = [
  'Destroy monster generators early: they keep spawning until destroyed, though they slow down as the field fills up.',
  'Bumping into an enemy attacks it automatically. Bumping into a friend nudges them out of the way.',
  'Units heal and regain magic slowly over time; higher levels regenerate faster.',
  'Standing in water without flight slowly drowns you.',
  'Experience earned in battle makes training cheaper. Every third level brings a new special.',
  'Anyone who falls in a won battle is gone for good, unless a cleric resurrects them on the field. A lost battle costs you nothing.',
  'Fields you already won can be revisited to reach their other exits; their enemies are gone.',
];
