// The admin panel: trips, people (who goes on which trip), personal links, who's online.
// Opens with 5 quick clicks on the logo, only for admins. The server checks every request too.
import type { AdminOnline, AdminState, AdminTrip, AdminUser, Me } from '../shared/api';
import { AREAS } from './areas';
import { api, inviteUrl, linkBox } from './account';
import { esc } from './settings';

let box: HTMLElement | null = null, tab: 'reizen' | 'personen' | 'online' = 'personen', data: AdminState | null = null, onlineT = 0;
const areaName = (id: string) => AREAS.find((a) => a.id === id)?.naam || id;
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
function seen(ts: number | null) {
  if (!ts) return 'nog nooit';
  const s = (Date.now() - ts) / 1000;
  if (s < 600) return 'net';
  if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  if (s < 86400) return `${Math.round(s / 3600)} uur geleden`;
  return new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

/** 5 quick clicks on the logo open the panel (admins only) */
export function initAdmin(me: Me) {
  if (!me.user.isAdmin) return;
  const logo = document.querySelector('.brand') as HTMLElement | null;
  if (!logo) return;
  logo.classList.add('adminable');
  // someone forgot their password: a dot on the logo until they have their new link
  if (me.resets) { logo.classList.add('adminping'); logo.title = `${me.resets === 1 ? 'Iemand vraagt' : me.resets + ' mensen vragen'} een nieuwe link (wachtwoord vergeten)`; }
  let clicks: number[] = [];
  logo.addEventListener('click', () => {
    const now = Date.now();
    clicks = [...clicks.filter((t) => now - t < 2000), now];
    if (clicks.length >= 5) { clicks = []; openAdmin(); }
  });
}

export async function openAdmin() {
  if (!box) {
    box = document.createElement('div');
    box.className = 'admin';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Beheer');
    document.body.append(box);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAdmin(); });
  }
  box.hidden = false;
  document.body.classList.add('adminopen');
  await reload();
}

function closeAdmin() {
  if (box) box.hidden = true;
  document.body.classList.remove('adminopen');
  clearInterval(onlineT);
}

async function reload() {
  try { data = await api<AdminState>('/admin/state'); render(); }
  catch (e) { box!.innerHTML = `<div class="acard"><p class="werr">${esc((e as Error).message)}</p><div class="grp"><button type="button" data-close>Sluiten</button></div></div>`; wire(); }
}

function render() {
  const d = data!;
  box!.innerHTML = `<div class="acard">
    <div class="ahead"><h2>Beheer</h2><button type="button" class="aclose" data-close aria-label="Sluiten">✕</button></div>
    <div class="mtabs" role="tablist">${(['personen', 'reizen', 'online'] as const).map((t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${tab === t}">${{ personen: `Personen (${d.users.length})`, reizen: `Reizen (${d.trips.length})`, online: 'Nu online' }[t]}</button>`).join('')}</div>
    <div class="abody">${tab === 'personen' ? people(d) : tab === 'reizen' ? trips(d) : '<p class="msrc">Laden…</p>'}</div>
  </div>`;
  wire();
  clearInterval(onlineT);
  if (tab === 'online') { loadOnline(); onlineT = window.setInterval(loadOnline, 10_000); }
}

// ---------- people ----------
function tripChecks(d: AdminState, chosen: string[], prefix: string) {
  if (!d.trips.length) return '<p class="msrc">Maak eerst een reis aan (tab Reizen).</p>';
  return `<div class="achecks">${d.trips.map((t) => `<label><input type="checkbox" name="trip" value="${t.id}" id="${prefix}-${t.id}"${chosen.includes(t.id) ? ' checked' : ''}> ${esc(t.naam)}</label>`).join('')}</div>`;
}

function personForm(d: AdminState, u: AdminUser | null) {
  return `<form class="aform" data-user-form="${u ? u.id : ''}" novalidate>
    <div class="arow"><label class="fld"><span>Naam</span><input name="naam" maxlength="30" value="${esc(u?.naam || '')}" required></label>
    <label class="fld"><span>E-mail</span><input name="email" type="email" value="${esc(u?.email || '')}" required></label></div>
    <div class="fld"><span>Reizen</span>${tripChecks(d, u?.trips || [], u ? 'e' + u.id : 'n')}</div>
    <p class="werr" data-err></p>
    <div class="grp"><button type="submit" class="primary">${u ? 'Opslaan' : 'Toevoegen en link maken'}</button>${u ? '<button type="button" data-cancel>Annuleren</button>' : ''}</div>
  </form>`;
}

function people(d: AdminState) {
  const tripName = (id: string) => d.trips.find((t) => t.id === id)?.naam || '?';
  const rows = [...d.users].sort((a, b) => +b.resetRequested - +a.resetRequested).map((u) => `<li class="aitem" data-user="${u.id}">
      <div class="amain"><b>${esc(u.naam)}${u.isAdmin ? ' <span class="atag">admin</span>' : ''}${u.resetRequested ? ' <span class="atag areset">wachtwoord vergeten: stuur een nieuwe link</span>' : ''}</b><small>${esc(u.email)}</small>
        <div class="achips">${u.trips.map((t) => `<span>${esc(tripName(t))}</span>`).join('') || '<em>geen reis</em>'}</div>
        <small>laatst gezien ${seen(u.lastSeen)} · ${u.sessions} ${u.sessions === 1 ? 'apparaat' : 'apparaten'}${u.invitePending ? ' · link verstuurd, nog niet geopend' : ''}</small></div>
      <div class="aacts"><button type="button" data-act="link">Link</button><button type="button" data-act="edit">Bewerk</button><button type="button" data-act="more" aria-label="Meer">⋯</button></div>
      <div class="aout"></div></li>`).join('');
  return `<details class="anew"${d.users.length ? '' : ' open'}><summary>+ Persoon toevoegen</summary>${personForm(d, null)}<div class="aout" data-new-out></div></details>
    <ul class="alist">${rows || '<li class="msrc">Nog niemand.</li>'}</ul>`;
}

// ---------- trips ----------
function tripForm(t: AdminTrip | null) {
  const area = t?.area || AREAS[0]?.id;
  return `<form class="aform" data-trip-form="${t ? t.id : ''}" novalidate>
    <div class="arow"><label class="fld"><span>Gebied</span><select name="area">${AREAS.map((a) => `<option value="${a.id}"${a.id === area ? ' selected' : ''}>${esc(a.naam)}</option>`).join('')}</select></label>
    <label class="fld"><span>Naam (op de reispil)</span><input name="naam" maxlength="30" value="${esc(t?.naam || AREAS.find((a) => a.id === area)?.kort || '')}" required></label></div>
    <label class="fld"><span>Voorgestelde aankomst (iedereen kiest zijn eigen datum)</span><input name="aankomst" type="date" value="${t?.aankomst || AREAS.find((a) => a.id === area)?.van || ''}" required></label>
    <p class="werr" data-err></p>
    <div class="grp"><button type="submit" class="primary">${t ? 'Opslaan' : 'Reis aanmaken'}</button>${t ? '<button type="button" data-cancel>Annuleren</button>' : ''}</div>
  </form>`;
}

function trips(d: AdminState) {
  const rows = d.trips.map((t) => `<li class="aitem" data-trip="${t.id}">
      <div class="amain"><b>${esc(t.naam)}</b><small>${esc(areaName(t.area))} · aankomst ${fmtDate(t.aankomst)} · ${t.members} ${t.members === 1 ? 'persoon' : 'personen'}</small></div>
      <div class="aacts"><button type="button" data-act="edit">Bewerk</button><button type="button" data-act="delete">Verwijder</button></div></li>`).join('');
  return `<details class="anew"${d.trips.length ? '' : ' open'}><summary>+ Reis aanmaken</summary>${tripForm(null)}</details>
    <ul class="alist">${rows || '<li class="msrc">Nog geen reizen.</li>'}</ul>
    <p class="msrc">Een nieuw skigebied toevoegen gaat met <code>npm run area:add</code>; daarna staat het hier in de lijst.</p>`;
}

// ---------- online ----------
async function loadOnline() {
  if (tab !== 'online' || !box || box.hidden) return;
  const body = box.querySelector('.abody');
  try {
    const on = await api<AdminOnline[]>('/admin/online');
    if (tab !== 'online' || !body) return;
    body.innerHTML = data!.trips.map((t) => {
      const o = on.find((x) => x.trip === t.id)?.online || [];
      return `<section class="aonline"><h4>${esc(t.naam)} · ${o.length} online</h4>${o.length ? `<ul class="people">${o.map((p) => `<li><span><b>${esc(p.naam)}</b><small>${p.visible ? 'kijkt mee' : 'op de achtergrond of andere reis'}</small></span></li>`).join('')}</ul>` : '<p class="msrc">Niemand.</p>'}</section>`;
    }).join('') || '<p class="msrc">Nog geen reizen.</p>';
  } catch (e) { if (body) body.innerHTML = `<p class="werr">${esc((e as Error).message)}</p>`; }
}

// ---------- events ----------
function formData(f: HTMLFormElement) {
  const fd = new FormData(f);
  return { naam: String(fd.get('naam') || ''), email: String(fd.get('email') || ''), area: String(fd.get('area') || ''), aankomst: String(fd.get('aankomst') || ''), trips: fd.getAll('trip').map(String) };
}

async function makeLink(userId: string, out: HTMLElement) {
  try {
    const { token } = await api<{ token: string }>(`/admin/users/${userId}/invite`, { method: 'POST' });
    linkBox(out, inviteUrl(token));
    out.insertAdjacentHTML('beforeend', '<p class="msrc">Persoonlijke link, 14 dagen geldig, werkt één keer. Stuur hem via WhatsApp of mail. Een eerdere, ongebruikte link werkt niet meer.</p>');
  } catch (e) { out.innerHTML = `<p class="werr">${esc((e as Error).message)}</p>`; }
}

/** connect buttons and forms inside root (only freshly rendered parts, so nothing gets two handlers) */
function wire(root: HTMLElement = box!) {
  const b = root;
  b.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', closeAdmin));
  b.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => x.addEventListener('click', () => { tab = x.dataset.tab as typeof tab; render(); }));

  // new / edit person
  b.querySelectorAll<HTMLFormElement>('[data-user-form]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = f.dataset.userForm, v = formData(f), err = f.querySelector('[data-err]')!;
    try {
      if (id) { await api(`/admin/users/${id}`, { method: 'PUT', body: v }); await reload(); }
      else {
        const { id: newId } = await api<{ id: string }>('/admin/users', { method: 'POST', body: v });
        await reload();
        const item = box!.querySelector<HTMLElement>(`[data-user="${newId}"] .aout`);
        if (item) await makeLink(newId, item);
      }
    } catch (x) { err.textContent = (x as Error).message; }
  }));
  // new / edit trip
  b.querySelectorAll<HTMLFormElement>('[data-trip-form]').forEach((f) => {
    const sel = f.querySelector('select')!, naam = f.querySelector<HTMLInputElement>('[name=naam]')!, date = f.querySelector<HTMLInputElement>('[name=aankomst]')!;
    sel.addEventListener('change', () => { if (!f.dataset.tripForm) { const a = AREAS.find((x) => x.id === sel.value); if (a) { naam.value = a.kort; date.value = a.van; } } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = f.dataset.tripForm, v = formData(f), err = f.querySelector('[data-err]')!;
      try { await api(id ? `/admin/trips/${id}` : '/admin/trips', { method: id ? 'PUT' : 'POST', body: v }); await reload(); }
      catch (x) { err.textContent = (x as Error).message; }
    });
  });
  b.querySelectorAll('[data-cancel]').forEach((x) => x.addEventListener('click', () => render()));

  // row actions
  b.querySelectorAll<HTMLElement>('[data-user] [data-act]').forEach((x) => x.addEventListener('click', async () => {
    const li = x.closest<HTMLElement>('[data-user]')!, id = li.dataset.user!, u = data!.users.find((y) => y.id === id)!, out = li.querySelector<HTMLElement>('.aout')!;
    if (x.dataset.act === 'link') return makeLink(id, out);
    if (x.dataset.act === 'edit') { out.innerHTML = personForm(data!, u); wire(out); return; }
    if (x.dataset.act === 'more') {
      out.innerHTML = `<div class="grp"><button type="button" data-more="logout">Overal uitloggen</button><button type="button" data-more="photo">Foto verwijderen</button><button type="button" data-more="delete"${u.isAdmin ? ' disabled' : ''}>Verwijderen</button></div>`;
      out.querySelectorAll<HTMLElement>('[data-more]').forEach((m) => m.addEventListener('click', async () => {
        try {
          if (m.dataset.more === 'logout' && confirm(`${u.naam} op alle apparaten uitloggen? Daarna is een nieuwe link nodig.`)) { await api(`/admin/users/${id}/logout`, { method: 'POST' }); await reload(); }
          if (m.dataset.more === 'photo' && confirm(`De foto van ${u.naam} verwijderen? Dan staat de voorletter er weer.`)) { await api(`/admin/users/${id}/avatar`, { method: 'DELETE' }); m.textContent = 'Foto verwijderd'; }
          if (m.dataset.more === 'delete' && confirm(`${u.naam} verwijderen? Berichten in de chat blijven staan.`)) { await api(`/admin/users/${id}`, { method: 'DELETE' }); await reload(); }
        } catch (e) { out.insertAdjacentHTML('beforeend', `<p class="werr">${esc((e as Error).message)}</p>`); }
      }));
    }
  }));
  b.querySelectorAll<HTMLElement>('[data-trip] [data-act]').forEach((x) => x.addEventListener('click', async () => {
    const li = x.closest<HTMLElement>('[data-trip]')!, id = li.dataset.trip!, t = data!.trips.find((y) => y.id === id)!;
    if (x.dataset.act === 'edit') { x.closest('.aacts')!.remove(); li.insertAdjacentHTML('beforeend', tripForm(t)); wire(li); return; }
    if (x.dataset.act === 'delete' && confirm(`Reis "${t.naam}" verwijderen? De ${t.members} deelnemers zien hem dan niet meer.`)) {
      try { await api(`/admin/trips/${id}`, { method: 'DELETE' }); await reload(); }
      catch (e) { alert((e as Error).message); }
    }
  }));
}
