import { deserialize, serialize, type Campaign } from './campaign.ts';

const KEY = 'lotc.campaign.v1';

/** The campaign is kept in this browser's local storage. It may be unavailable (private mode). */
export function loadCampaign(): Campaign | null {
  try {
    const json = localStorage.getItem(KEY);
    return json ? deserialize(json) : null;
  } catch {
    return null;
  }
}

export function saveCampaign(campaign: Campaign): boolean {
  try {
    localStorage.setItem(KEY, serialize(campaign));
    return true;
  } catch {
    return false;
  }
}

export function clearCampaign(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing saved to clear
  }
}
