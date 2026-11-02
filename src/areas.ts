// Every folder in areas/ is a ski area: area.json is bundled, map.json becomes a separate file loaded on demand.
import type { Area } from './config';

const meta = import.meta.glob<Area>('../areas/*/area.json', { eager: true, import: 'default' });
const maps = import.meta.glob<string>('../areas/*/map.json', { query: '?url', eager: true, import: 'default' });

export const AREAS: Area[] = Object.entries(meta)
  .map(([path, a]) => ({ ...a, mapUrl: maps[path.replace('area.json', 'map.json')] }))
  .sort((a, b) => (a.van < b.van ? -1 : a.van > b.van ? 1 : 0));
