// Messages between the game and the online campaign server, shared by both sides.

import type { BattleReport, BattleSummary } from '../game/campaign.ts';
import type { BattleSetup, Frame } from './lockstep.ts';

/** A squad member's data as sent over the wire (a Guy's own fields). */
export interface GuyData {
  name: string;
  family: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  armor: number;
  level: number;
  exp: number;
  kills: number;
  levelKills: number;
  totalDamage: number;
  totalHits: number;
  totalShots: number;
  teamnum: number;
  leader: boolean;
}

/** One player's side of an online campaign: their own barracks, cash and progress. */
export interface MemberCampaign {
  money: number;
  score: number;
  team: GuyData[];
  /** The field they fight next, and the fields they have won. */
  scenario: number;
  completed: number[];
  /** Hires per family, for default names like SOLDIER3. */
  hired: Record<number, number>;
}

/** Where a player is: in the barracks, or fighting on a field. */
export type Whereabouts = { at: 'barracks' } | { at: 'battle'; scenario: number };

/** What every player can see about the others. */
export interface PublicMember {
  name: string;
  online: boolean;
  where: Whereabouts | null;
  teamSize: number;
  topLevel: number;
  score: number;
  /** Ready for the next battle. */
  ready: boolean;
  /** Their squad is in the battle being fought. */
  inBattle: boolean;
  /** This is the player receiving the message. */
  you: boolean;
}

/** The battle being fought, if any, as everyone in the campaign sees it. */
export interface BattleInfo {
  id: string;
  scenario: number;
  /** Who is playing it right now (not away). */
  playing: string[];
}

export interface CampaignInfo {
  id: string;
  name: string;
  difficulty: number;
  /** Lets another authorised player join (part of the invite link). */
  invite: string;
  /** Fields opened up by anyone in the campaign. */
  open: number[];
  members: PublicMember[];
  /** The field everyone is getting ready for. */
  field: number;
  battle: BattleInfo | null;
}

/** A squad member's identity, so the server can tell the team didn't change during a battle. */
export interface SquadEntry {
  name: string;
  family: number;
}

export type ClientMessage =
  | { t: 'hire'; guy: GuyData }
  | { t: 'train'; index: number; guy: GuyData }
  | { t: 'dismiss'; index: number }
  | { t: 'leader'; index: number }
  | { t: 'where'; where: Whereabouts }
  /** A battle fought on this device. `id` is unique per battle, so a resend is applied once. */
  | { t: 'result'; id: string; scenario: number; par: number; squad: SquadEntry[]; summary: BattleSummary }
  /** The lobby: pick the next field (for everyone), say you're ready. */
  | { t: 'field'; scenario: number }
  | { t: 'ready'; ready: boolean }
  /** Into the battle being fought (first time, or back after leaving), or out of it. */
  | { t: 'battle-join' }
  | { t: 'battle-leave' }
  /** Buttons held now, plus any pressed since the last message (see lockstep.ts). */
  | { t: 'input'; code: number }
  /** The battle is over on this device: every player's summary, by player number. */
  | { t: 'battle-result'; id: string; par: number; summaries: (BattleSummary | null)[] };

export type ServerMessage =
  | { t: 'state'; campaign: CampaignInfo; you: MemberCampaign }
  | { t: 'report'; id: string; report: BattleReport }
  /** You're in a battle: replay `frames` (non-empty ones, up to tick `now`), then follow the ticks. */
  | { t: 'battle'; setup: BattleSetup; frames: Frame[]; now: number; you: number }
  /** The next ticks of the battle you're in. */
  | { t: 'ticks'; frames: Frame[] }
  /** The battle is over (results saved, or given up when everyone left). */
  | { t: 'battle-end'; id: string; reason: string }
  /** A refused action. `id` names the battle result it was about; `fatal` means the connection is over. */
  | { t: 'error'; reason: string; id?: string; fatal?: boolean };

/**
 * Players' devices must run the same battle code, or their battles drift apart. Bump this with
 * any change to the simulation or these messages; older games are asked to reload.
 */
export const PROTOCOL_VERSION = 3;

/** WebSocket close code for "not allowed in this campaign"; the client stops reconnecting. */
export const CLOSE_FORBIDDEN = 4003;
