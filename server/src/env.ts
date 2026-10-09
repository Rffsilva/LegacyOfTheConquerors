import type { CampaignRoom } from './campaignRoom.ts';
import type { Gate } from './gate.ts';

export interface Env {
  GATE: DurableObjectNamespace<Gate>;
  ROOMS: DurableObjectNamespace<CampaignRoom>;
  /** The password friends need to play online (a Worker secret). */
  ACCESS_PASSWORD?: string;
  /** Comma-separated origins the game is served from. */
  ALLOWED_ORIGINS: string;
}
