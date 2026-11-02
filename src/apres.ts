// Après-ski on the map (scene 'Sfeer nu'): a pin for every bar, pub, club and hut from OpenStreetMap
// (tools/add-area.ts puts them in map.json). Names that would overlap are hidden; tap a pin for its details.
import { esc } from './settings';

/** as stored in map.json: [kind, name, lon×1e5, lat×1e5, opening hours, website] */
export type StoredPlace = [string, string, number, number, string, string];
interface Place { kind: string; naam: string; lon: number; lat: number; hours: string; web: string; x: number; y: number; z: number; el: HTMLButtonElement; w: number }
interface World { proj(lon: number, lat: number): [number, number]; hAt(x: number, z: number): number; inside(x: number, z: number): boolean }
export type Project = (x: number, y: number, z: number) => { x: number; y: number; ok: boolean };

const KIND: Record<string, string> = { bar: 'Bar', pub: 'Kroeg', club: 'Club', biergarten: 'Biergarten', hut: 'Skihut' };
const ICON: Record<string, string> = {
  // a beer mug, a cocktail glass, a hut
  bar: '<path d="M7 5h8v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM15 8h2a2 2 0 0 1 0 4h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h6" stroke="currentColor" stroke-width="2"/>',
  club: '<path d="M5 5h14l-7 8zM12 13v6M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  hut: '<path d="M3 12 12 4l9 8M6 10v9h12v-9M10 19v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
};
const icon = (k: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k === 'club' ? 'club' : k === 'hut' ? 'hut' : 'bar']}</svg>`;

// OSM opening hours in Dutch, as far as it's simple ('Mo-Su 10:00-18:00' → 'ma–zo 10:00–18:00')
const DAYS: Record<string, string> = { Mo: 'ma', Tu: 'di', We: 'wo', Th: 'do', Fr: 'vr', Sa: 'za', Su: 'zo', PH: 'feestdagen' };
const hoursNl = (h: string) => h.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d]).replace(/\boff\b/g, 'dicht').replace(/(\d)-(\d)/g, '$1–$2').replace(/([a-z])-([a-z])/g, '$1–$2').replace(/;\s*/g, ' · ');

/** onOpen: a place was opened (fly there) or closed (null: back to the overview) */
export function createApres(layer: HTMLElement, onOpen: (place: { x: number; y: number; z: number } | null) => void) {
  let places: Place[] = [], sel: Place | null = null, shown = false, n = 0;
  const card = document.createElement('div');
  card.className = 'apcard tile';
  card.hidden = true;
  layer.after(card);

  function set(world: World | null, list: StoredPlace[] | undefined) {
    close();
    layer.innerHTML = '';
    places = [];
    if (!world || !list) return;
    for (const [kind, naam, lo, la, hours, web] of list) {
      const lon = lo / 1e5, lat = la / 1e5, [x, z] = world.proj(lon, lat);
      if (!world.inside(x, z)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ap ' + kind;
      el.innerHTML = `${icon(kind)}<span>${esc(naam)}</span>`;
      el.setAttribute('aria-label', `${KIND[kind] || 'Après-ski'}: ${naam}`);
      layer.append(el);
      const p: Place = { kind, naam, lon, lat, hours, web, x, y: world.hAt(x, z), z, el, w: 0 };
      el.onclick = (e) => { e.stopPropagation(); open(p); };
      places.push(p);
    }
    for (const p of places) p.w = p.el.offsetWidth || 120;
  }

  function open(p: Place) {
    sel = p;
    const osm = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lon.toFixed(5)}#map=18/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`;
    const web = /^https?:\/\//i.test(p.web) ? p.web : p.web ? 'https://' + p.web : '';
    // OpenStreetMap often has no (or old) opening hours: Google Maps, searched around the spot, usually does
    const gmaps = `https://www.google.com/maps/search/${encodeURIComponent(p.naam)}/@${p.lat.toFixed(5)},${p.lon.toFixed(5)},16z`;
    card.innerHTML = `<button type="button" class="apx" aria-label="Sluiten">✕</button>
      <div class="aphead">${icon(p.kind)}<div><b>${esc(p.naam)}</b><small>${KIND[p.kind] || 'Après-ski'}</small></div></div>
      ${p.hours ? `<p><span class="lbl">Open volgens OpenStreetMap</span>${esc(hoursNl(p.hours))}</p>` : '<p class="quiet">Openingstijden staan niet in OpenStreetMap.</p>'}
      <a class="apgm" href="${gmaps}" target="_blank" rel="noopener">Openingstijden en foto's op Google Maps</a>
      <p class="aplinks">${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">Website</a>` : ''}<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap</a></p>`;
    card.querySelector<HTMLButtonElement>('.apx')!.onclick = close;
    card.hidden = false;
    for (const q of places) q.el.classList.toggle('on', q === p);
    onOpen(p);
  }
  function close() {
    if (!sel) return;
    sel = null;
    card.hidden = true;
    for (const q of places) q.el.classList.remove('on');
    onOpen(null);
  }
  addEventListener('pointerdown', (e) => { if (sel && !card.contains(e.target as Node) && !(e.target as Element).closest?.('.ap')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  /** every frame: put the pins where their place is on screen; names only where there's room */
  function update(show: boolean, project: Project, W: number, H: number) {
    if (show !== shown) { shown = show; layer.classList.toggle('show', show); if (!show) close(); }
    if (!show || !places.length) return;
    const doLabels = n++ % 6 === 0, taken: number[][] = [];
    const vis: { p: Place; x: number; y: number }[] = [];
    for (const p of places) {
      const s = project(p.x, p.y, p.z);
      const ok = s.ok && s.x > 10 && s.x < W - 10 && s.y > 60 && s.y < H - 40;
      p.el.style.visibility = ok ? '' : 'hidden';
      if (!ok) continue;
      p.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      vis.push({ p, x: s.x, y: s.y });
    }
    if (doLabels) {
      // front to back (lower on screen = closer), the selected one always
      vis.sort((a, b) => (b.p === sel ? 1 : 0) - (a.p === sel ? 1 : 0) || b.y - a.y);
      for (const { p, x, y } of vis) {
        const r = [x - 16, y - 17, x - 14 + p.w + 4, y + 17];
        const free = !taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
        p.el.classList.toggle('dot', !free);
        if (free) taken.push(r);
      }
    }
    if (sel) {
      const s = project(sel.x, sel.y, sel.z);
      card.style.transform = `translate(${Math.min(W - 170, Math.max(170, s.x))}px, ${Math.max(220, s.y) - 44}px)`;
    }
  }

  return { set, update, count: () => places.length };
}
