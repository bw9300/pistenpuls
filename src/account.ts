// Accounts in the browser: sign in with a personal link (…/#invite=…), the screens before the dashboard
// (no access / no trips / your arrival dates) and the settings tab.
import { DATE_RE, type Me, type MyTrip } from '../shared/api';
import { AREAS } from './areas';
import { esc } from './settings';

const $ = (id: string) => document.getElementById(id)!;
const LOGO = '<svg width="34" height="34" viewBox="0 0 44 44" aria-hidden="true"><path d="M4 36 L16 14 L23 24 L29 16 L40 36 Z" fill="none" stroke="#F4EDE1" stroke-width="2.5" stroke-linejoin="round"/><path d="M22 6 C 18 2, 12 5, 16 10 L22 15 L28 10 C 32 5, 26 2, 22 6 Z" fill="#E0533D"/></svg>';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch('/api' + path, {
    method: init.method || 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || `Fout ${r.status}`);
  return j as T;
}

export const inviteUrl = (token: string) => `${location.origin}/#invite=${token}`;

/** opened a personal link? swap it for a session (and tidy the address bar). Returns an error text when the link didn't work. */
export async function redeemFromLink(): Promise<string | null> {
  const m = location.hash.match(/invite=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try { await api('/auth/redeem', { method: 'POST', body: { token: m[1] } }); return null; }
  catch (e) { return (e as Error).message; }
}

/** null = not signed in */
export async function loadMe(): Promise<Me | null> {
  try { return await api<Me>('/me'); }
  catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
}

export const needsDates = (me: Me) => me.trips.some((t) => !t.aankomst);
const areaOf = (t: MyTrip) => AREAS.find((a) => a.id === t.area);

// ---------- full-screen cards before the dashboard (same look as the wizard) ----------
function card(html: string) {
  document.body.classList.add('wizard');
  const w = $('wizard');
  w.hidden = false;
  w.innerHTML = `<div class="wizcard">${html}</div>`;
  return w.firstElementChild as HTMLElement;
}

export function showGate(error: string | null) {
  const c = card(`<form id="gForm" novalidate>
    <div class="wizhead">${LOGO}<b>PISTENPULS</b></div>
    <section><h1>Servus! Log even in.</h1>
    <p>Pistenpuls is alleen voor de mensen die mee op reis gaan. Open je persoonlijke link, of log in met je e-mailadres en wachtwoord als je dat in Instellingen hebt ingesteld.</p></section>
    <section>
      <label class="fld" for="gEmail"><span>E-mailadres</span><input id="gEmail" type="email" autocomplete="username" required></label>
      <label class="fld" for="gPw"><span>Wachtwoord</span><input id="gPw" type="password" autocomplete="current-password" required></label>
    </section>
    <p class="werr" id="gErr" role="alert">${error ? esc(error) : ''}</p>
    <div class="wnav"><button type="submit" class="primary">Inloggen</button></div></form>`);
  const f = c.querySelector('#gForm') as HTMLFormElement;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = (c.querySelector('#gEmail') as HTMLInputElement).value.trim();
    const password = (c.querySelector('#gPw') as HTMLInputElement).value;
    const err = c.querySelector('#gErr')!, b = f.querySelector('button')!;
    if (!email || !password) { err.textContent = 'Vul je e-mailadres en wachtwoord in.'; return; }
    b.disabled = true;
    try { await api('/auth/login', { method: 'POST', body: { email, password } }); location.reload(); }
    catch (e) { err.textContent = (e as Error).message; b.disabled = false; }
  };
}

export function showNoTrips(me: Me, openAdmin: (() => void) | null) {
  const c = card(`<div class="wizhead">${LOGO}<b>PISTENPULS</b></div>
    <section><h1>Hoi ${esc(me.user.naam)}!</h1>
    <p>Je bent ingelogd als ${esc(me.user.email)}, maar je bent nog niet aan een reis toegevoegd. Zodra dat gebeurd is, staat hij hier.</p></section>
    <div class="wnav">${openAdmin ? '<button type="button" class="primary" id="gAdmin">Beheer openen</button>' : ''}<button type="button" id="gReload">Opnieuw kijken</button></div>`);
  c.querySelector('#gReload')!.addEventListener('click', () => location.reload());
  c.querySelector('#gAdmin')?.addEventListener('click', () => openAdmin!());
}

/** first sign-in (or a new trip): your name and your own arrival date per trip */
export function askDates(me: Me): Promise<Me> {
  return new Promise((resolve) => {
    const c = card(`<form id="obForm" novalidate>
      <div class="wizhead">${LOGO}<b>PISTENPULS</b></div>
      <section><h1>Servus, ${esc(me.user.naam)}!</h1><p>Klopt je naam, en wanneer kom je aan? Daar telt het dashboard naartoe af.</p>
        <label class="fld" for="obName"><span>Je naam</span><input id="obName" maxlength="30" autocomplete="given-name" value="${esc(me.user.naam)}"></label>
      </section>
      <section><div class="picks">${me.trips.map((t) => `<label class="wdate" for="ob-${t.id}"><span><b>${esc(t.naam)}</b><small>${esc(areaOf(t)?.regio || '')}</small></span><input type="date" id="ob-${t.id}" data-trip="${t.id}" value="${t.aankomst || t.aankomstReis}" required></label>`).join('')}</div></section>
      <p class="werr" id="obErr" role="alert"></p>
      <div class="wnav"><button type="submit" class="primary">Start het aftellen</button></div></form>`);
    const f = c.querySelector('#obForm') as HTMLFormElement;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const naam = (c.querySelector('#obName') as HTMLInputElement).value.trim();
      const trips = [...c.querySelectorAll<HTMLInputElement>('[data-trip]')].map((i) => ({ id: i.dataset.trip!, aankomst: i.value }));
      const err = c.querySelector('#obErr')!;
      if (!naam) { err.textContent = 'Vul je naam in.'; return; }
      if (trips.some((t) => !DATE_RE.test(t.aankomst))) { err.textContent = 'Vul bij elke reis een aankomstdatum in.'; return; }
      try { resolve(await api<Me>('/me', { method: 'PATCH', body: { naam, trips } })); }
      catch (e) { err.textContent = (e as Error).message; }
    };
  });
}

export function hideCards() {
  document.body.classList.remove('wizard');
  $('wizard').hidden = true;
}

// ---------- settings tab in the menu ----------
export function renderSettings(me: Me) {
  const f = $('panSet') as HTMLFormElement;
  f.innerHTML = `
    <section><h4>Jouw naam</h4><label class="fld" for="sName"><span class="vh">Naam</span><input id="sName" autocomplete="given-name" maxlength="30" value="${esc(me.user.naam)}"></label>
      <p class="msrc">Ingelogd als ${esc(me.user.email)}</p></section>
    <section><h4>Jouw aankomst</h4><div class="picks">${me.trips.map((t) => `<label class="wdate" for="sd-${t.id}"><span><b>${esc(t.naam)}</b></span><input type="date" id="sd-${t.id}" data-trip="${t.id}" value="${t.aankomst || t.aankomstReis}"></label>`).join('')}</div></section>
    <p class="werr" id="sErr" role="alert"></p>
    <div class="grp"><button type="submit" class="primary">Opslaan</button></div>
    <section><h4>Wachtwoord</h4>
      <p class="msrc">${me.user.hasPassword ? 'Je hebt een wachtwoord: daarmee log je overal in met je e-mailadres.' : 'Stel een wachtwoord in, dan kun je overal inloggen met je e-mailadres, zonder link.'}</p>
      <input type="email" autocomplete="username" value="${esc(me.user.email)}" hidden>
      <label class="fld" for="sPw"><span class="vh">Nieuw wachtwoord</span><input id="sPw" type="password" autocomplete="new-password" minlength="8" placeholder="Nieuw wachtwoord (min. 8 tekens)"></label>
      <div class="grp"><button type="button" id="sPwSave">${me.user.hasPassword ? 'Wachtwoord wijzigen' : 'Wachtwoord instellen'}</button></div><p class="werr" id="sPwMsg" role="status"></p></section>
    <section><h4>Ander apparaat</h4>
      <p class="msrc">Open deze link op je telefoon, tablet of tv om daar ook ingelogd te zijn. Hij werkt één keer en 15 minuten lang.</p>
      <div class="grp"><button type="button" id="sDevice">Maak een link</button></div><div id="sDeviceOut"></div></section>
    <div class="grp"><button type="button" id="sLogout">Uitloggen op dit apparaat</button></div>`;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const naam = ($('sName') as HTMLInputElement).value.trim();
    const trips = [...f.querySelectorAll<HTMLInputElement>('[data-trip]')].map((i) => ({ id: i.dataset.trip!, aankomst: i.value }));
    if (!naam) { $('sErr').textContent = 'Vul je naam in.'; return; }
    if (trips.some((t) => !DATE_RE.test(t.aankomst))) { $('sErr').textContent = 'Vul bij elke reis een aankomstdatum in.'; return; }
    try { await api('/me', { method: 'PATCH', body: { naam, trips } }); location.reload(); }
    catch (e) { $('sErr').textContent = (e as Error).message; }
  };
  // Enter in the password field saves the password, not the whole settings form
  $('sPw').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('sPwSave').click(); } };
  $('sPwSave').onclick = async () => {
    const pw = $('sPw') as HTMLInputElement, msg = $('sPwMsg');
    try {
      await api('/me/password', { method: 'PUT', body: { password: pw.value } });
      pw.value = ''; msg.className = 'msrc'; msg.textContent = 'Opgeslagen. Je kunt nu inloggen met je e-mailadres en dit wachtwoord.';
      me.user.hasPassword = true; ($('sPwSave') as HTMLButtonElement).textContent = 'Wachtwoord wijzigen';
    } catch (e) { msg.className = 'werr'; msg.textContent = (e as Error).message; }
  };
  $('sDevice').onclick = async () => {
    try { const { token } = await api<{ token: string }>('/me/device-link', { method: 'POST' }); linkBox($('sDeviceOut'), inviteUrl(token)); }
    catch (e) { $('sDeviceOut').textContent = (e as Error).message; }
  };
  $('sLogout').onclick = async () => {
    if (!confirm(me.user.hasPassword ? 'Uitloggen op dit apparaat?' : 'Uitloggen op dit apparaat? Je hebt daarna een nieuwe link nodig (of stel eerst een wachtwoord in).')) return;
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  };
}

/** a link with a copy button (also used by the admin panel) */
export function linkBox(el: HTMLElement, url: string) {
  el.innerHTML = `<div class="linkbox"><input readonly value="${esc(url)}" aria-label="Link"><button type="button">Kopieer</button></div>`;
  const inp = el.querySelector('input')!, b = el.querySelector('button')!;
  inp.onfocus = () => inp.select();
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(url); b.textContent = 'Gekopieerd!'; }
    catch { inp.focus(); inp.select(); b.textContent = 'Selecteer en kopieer'; }
    setTimeout(() => (b.textContent = 'Kopieer'), 2500);
  };
}
