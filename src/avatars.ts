// Profile photos: who has one (and which version), for everyone I share a trip with.
// The photo itself is at /api/avatar/<id>?v=<version>; a new photo gets a new address, so browsers may keep the old one.
import { api } from './account';

let versions: Record<string, number> = {};
const listeners = new Set<() => void>();

export async function loadAvatars() {
  try {
    const next = await api<Record<string, number>>('/avatars');
    const changed = JSON.stringify(next) !== JSON.stringify(versions);
    versions = next;
    if (changed) for (const fn of listeners) fn();
  } catch {}
}

/** refreshed now and then, so someone else's new photo shows up without reloading */
export function startAvatars() {
  loadAvatars();
  setInterval(loadAvatars, 3 * 60_000);
}

export const avatarUrl = (id: string) => (versions[id] ? `/api/avatar/${encodeURIComponent(id)}?v=${versions[id]}` : null);

/** called when photos changed (to redraw) */
export function onAvatars(fn: () => void) { listeners.add(fn); }

/** a photo as an image, for drawing it somewhere else (the skier's head) */
export function avatarImage(id: string): Promise<HTMLImageElement | null> {
  const url = avatarUrl(id);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
