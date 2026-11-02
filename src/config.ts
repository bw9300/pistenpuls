/* ============================================================
   SKIGEBIEDEN staan in areas/<id>/area.json ('van' is de voorgestelde aankomstdatum).
   Een nieuw gebied toevoegen: npm run area:add (zie README).
   Je naam, je reizen en de aankomstdata stel je in via de wizard of het menu › Instellingen.
   ============================================================ */

export interface Area {
  id: string;
  naam: string;
  kort: string;
  regio: string;
  hallo?: string;
  groet: string;
  groetSub: string;
  van: string;
  /** [west, zuid, oost, noord] in graden */
  bbox: [number, number, number, number];
  /** meetstations van avalanche.report; leeg = automatisch de hoogste en laagste in de buurt */
  meetstations?: { berg?: string; dal?: string };
  treeline?: number;
  /** URL of the stored map data (areas/<id>/map.json); absent = fetched live */
  mapUrl?: string;
}

export const CONFIG = {
  detail: 'midden' as 'laag' | 'midden' | 'hoog', // 'laag' (grove facetten), 'midden' of 'hoog'
  exaggeration: 1.15, // bergen iets hoger maken voor de sfeer
  sceneSeconds: 20,
  idleSeconds: 4, // zelf rondkijken: na zoveel seconden niets doen terug naar de rondvlucht
  terrainZoom: 12,
  terrainUrls: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
  overpassUrls: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
  maxBuildings: 10000,
  treeline: 1700, // boomgrens in meters
};

/** Per deployment, read from /config.json at startup (so one build works on any host). */
export interface RuntimeConfig {
  /** where the API lives; '' = same origin */
  apiBase: string;
  /** webcams via /api/webcams (needs the server with WINDY_KEY); false = 3D view instead */
  webcams: boolean;
  /** live (who's watching, messages) via /api/live (needs the server); false = hidden */
  live: boolean;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const fallback: RuntimeConfig = { apiBase: '', webcams: false, live: false };
  try {
    const r = await fetch(import.meta.env.BASE_URL + 'config.json', { cache: 'no-cache' });
    if (r.ok) return { ...fallback, ...(await r.json()) };
  } catch (e) {}
  return fallback;
}
