// Messages between the game and the online campaign server, shared by both sides.

import type { BattleReport, BattleSummary } from '../game/campaign.ts';

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
  /** This is the player receiving the message. */
  you: boolean;
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
  | { t: 'result'; id: string; scenario: number; par: number; squad: SquadEntry[]; summary: BattleSummary };

export type ServerMessage =
  | { t: 'state'; campaign: CampaignInfo; you: MemberCampaign }
  | { t: 'report'; id: string; report: BattleReport }
  /** A refused action. `id` names the battle result it was about; `fatal` means the connection is over. */
  | { t: 'error'; reason: string; id?: string; fatal?: boolean };

/** WebSocket close code for "not allowed in this campaign"; the client stops reconnecting. */
export const CLOSE_FORBIDDEN = 4003;
