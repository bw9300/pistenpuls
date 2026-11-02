// Live in the dashboard, per trip: who's watching (top bar), the panel with messages, toasts for news.
// Connected to all my trips at once: the trip on screen gets the panel and toasts, the others count unread messages
// (badge on their trip pill).
import { RECENT_MS, SYSTEM, type ChatMessage, type Member, type OnlineMember } from '../shared/live';
import { connectLive, type Live, type LiveEvent } from './live';
import { esc } from './settings';
import { createGames } from './games';
import { SNOWBALL } from './snowball';
import type { Stage } from './ski';

const $ = (id: string) => document.getElementById(id)!;
const COLORS = ['#E0533D', '#F0B45A', '#5B9BD5', '#7FB77E', '#B08BD9', '#E58FB1', '#4FB3B0'];
const color = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
const initial = (naam: string) => esc((naam.trim()[0] || '?').toUpperCase());
const avatar = (id: string, naam: string, dim = false) => `<i class="av${dim ? ' dim' : ''}" style="--c:${color(id)}" aria-hidden="true">${initial(naam)}</i>`;
const time = (ts: number) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'net';
  return `${Math.round(s / 60)} min geleden`;
}

function day(ts: number) {
  const d = new Date(ts), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Vandaag';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// what I've read per trip (highest message id), kept in this browser
const readKey = (trip: string) => 'pp-read-' + trip;
const getRead = (trip: string) => { try { const v = localStorage.getItem(readKey(trip)); return v === null ? null : Number(v); } catch { return null; } };
const setRead = (trip: string, id: number) => { try { localStorage.setItem(readKey(trip), String(id)); } catch {} };

export function startLiveUI(opts: {
  apiBase: string;
  trips: { id: string; naam: string }[];
  active: string | null;
  /** unread messages of a trip changed (for the badge on its pill) */
  onUnread: (trip: string, n: number) => void;
  /** the 3D map, for games played on it */
  stage?: Stage;
}) {
  const btn = $('chatBtn'), panel = $('chat'), who = $('who');
  const tripName = (id: string | null) => opts.trips.find((t) => t.id === id)?.naam || '';
  let active = opts.active, open = false;

  // ---------- panel open/close (same behaviour as the menu) ----------
  function setOpen(o: boolean) {
    open = o;
    panel.hidden = !o;
    btn.setAttribute('aria-expanded', String(o));
    document.body.classList.toggle('chatopen', o);
    if (o) { markRead(); render(); scrollDown(); setTimeout(() => (panel.querySelector('#chatText') as HTMLInputElement | null)?.focus(), 30); }
  }
  btn.onclick = () => setOpen(!open);
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ch]');
    if (!b) return;
    setOpen(false);
    games.pick(cur(), b.dataset.ch!, b.dataset.naam!);
  });
  who.onclick = () => setOpen(true);
  addEventListener('pointerdown', (e) => { if (open && !panel.contains(e.target as Node) && !btn.contains(e.target as Node) && !who.contains(e.target as Node)) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { setOpen(false); btn.focus(); } });

  // ---------- one connection per trip ----------
  const lives = new Map<string, Live>();
  for (const t of opts.trips) lives.set(t.id, connectLive({ apiBase: opts.apiBase, trip: t.id, active, onEvent: (e) => onEvent(t.id, e) }));
  const cur = () => (active ? lives.get(active) : undefined);
  const games = createGames({ toast, stage: opts.stage });

  function unread(trip: string) {
    const l = lives.get(trip);
    if (!l || l.state.status === 'connecting' && !l.state.messages.length) return 0;
    const r = getRead(trip) ?? 0;
    return l.state.messages.filter((m) => m.id > r && m.from !== l.state.me).length;
  }
  function markRead() {
    const l = cur();
    if (!l) return;
    const last = l.state.messages[l.state.messages.length - 1];
    if (last) setRead(l.trip, last.id);
    renderBadges();
  }
  function renderBadges() {
    for (const t of opts.trips) opts.onUnread(t.id, t.id === active ? 0 : unread(t.id));
    const n = active && !open ? unread(active) : 0;
    btn.classList.toggle('unread', n > 0);
    $('chatBadge').textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Groep openen, ${n} ${n === 1 ? 'nieuw bericht' : 'nieuwe berichten'}` : 'Groep openen');
  }

  function onEvent(trip: string, e: LiveEvent) {
    const l = lives.get(trip)!;
    if (e.t === 'state' && getRead(trip) === null) {
      // first time on this device: the history so far doesn't count as new
      const last = l.state.messages[l.state.messages.length - 1];
      setRead(trip, last ? last.id : 0);
    }
    const isActive = trip === active;
    if (e.t === 'game') return games.onGame(l, e.game, e.ev);
    if (e.t === 'error') return games.onError(e.error);
    if (e.t === 'msg') {
      if (isActive && open) { appendMessage(e.msg); scrollDown(); markRead(); }
      else if (isActive && e.msg.from === SYSTEM) { if (!games.busy()) toast(`${SNOWBALL}<span>${esc(e.msg.text)}</span>`, 7000); }
      else if (isActive && e.msg.from !== l.state.me) toast(`${avatar(e.msg.from, e.msg.naam)}<span><b>${esc(e.msg.naam)}</b> ${esc(e.msg.text)}</span>`, 9000);
      if (e.msg.from === l.state.me && isActive) markRead();
      renderBadges();
      return;
    }
    if (e.t === 'presence' && isActive) for (const j of e.joined) toast(`${avatar(j.id, j.naam)}<span><b>${esc(j.naam)}</b> kijkt nu mee</span>`, 5000);
    renderBadges();
    if (isActive) render();
  }

  // ---------- rendering (the trip on screen) ----------
  /** left within the last hour and not online now */
  const recent = (l: Live): Member[] => {
    const onlineIds = new Set(l.state.online.map((o) => o.id));
    return l.state.members.filter((m) => !onlineIds.has(m.id) && Date.now() - m.lastSeen < RECENT_MS);
  };
  const viewingText = (o: OnlineMember) => (o.viewing.visible ? 'kijkt mee' : 'op de achtergrond');

  function renderWho() {
    const l = cur();
    if (!l || l.state.status !== 'online') { who.hidden = true; return; }
    const s = l.state, others = s.online.filter((o) => o.id !== s.me);
    const list = [s.online.find((o) => o.id === s.me), ...others].filter(Boolean) as OnlineMember[];
    const rec = recent(l);
    who.hidden = false;
    who.title = list.map((o) => o.naam + (o.viewing.visible ? '' : ` (${viewingText(o)})`)).join('\n') + (rec.length ? `\n\nLaatste uur: ${rec.map((m) => m.naam).join(', ')}` : '');
    who.innerHTML = `<span class="avs">${list.slice(0, 3).map((o) => avatar(o.id, o.naam, !o.viewing.visible)).join('')}</span>`
      + (list.length > 3 ? `<em>+${list.length - 3}</em>` : '')
      + `<span class="wlbl">${others.length ? `${others.length + 1} online` : 'alleen jij'}</span>`;
  }

  /** the snowball after someone's name: challenge them (only when they're online) */
  const challengeBtn = (l: Live, id: string, naam: string) =>
    id !== l.state.me && id !== SYSTEM && l.state.online.some((o) => o.id === id)
      ? `<button type="button" class="sbch" data-ch="${esc(id)}" data-naam="${esc(naam)}" title="Daag ${esc(naam)} uit voor een spelletje" aria-label="Daag ${esc(naam)} uit voor een spelletje">${SNOWBALL}</button>`
      : '';
  const msgHTML = (l: Live, m: ChatMessage, prev?: ChatMessage) => {
    const mine = m.from === l.state.me, sameDay = prev && day(prev.ts) === day(m.ts);
    const head = sameDay ? '' : `<li class="day">${day(m.ts)}</li>`;
    if (m.from === SYSTEM) return head + `<li class="sys"><p>${esc(m.text)}</p><time>${time(m.ts)}</time></li>`;
    const grouped = sameDay && prev!.from === m.from && m.ts - prev!.ts < 5 * 60_000;
    return head
      + `<li class="m${mine ? ' mine' : ''}${grouped ? ' cont' : ''}">${grouped || mine ? '' : avatar(m.from, m.naam)}<div>${grouped || mine ? '' : `<b>${esc(m.naam)}${challengeBtn(l, m.from, m.naam)}</b>`}<p>${esc(m.text)}</p><time>${time(m.ts)}</time></div></li>`;
  };
  function appendMessage(m: ChatMessage) {
    const list = panel.querySelector('#chatMsgs'), l = cur();
    if (!list || !l) return;
    list.querySelector('.empty')?.remove();
    const msgs = l.state.messages;
    list.insertAdjacentHTML('beforeend', msgHTML(l, m, msgs[msgs.length - 2]));
  }
  const scrollDown = () => { const l = panel.querySelector('#chatMsgs'); if (l) l.scrollTop = l.scrollHeight; };

  function render() {
    renderWho();
    if (!open) return;
    const l = cur();
    if (!l) { panel.innerHTML = '<p class="msrc">Geen reis gekozen.</p>'; return; }
    // keep what's being typed across re-renders
    const prevInput = panel.querySelector('#chatText') as HTMLInputElement | null, typed = prevInput?.value || '', focused = document.activeElement === prevInput;
    const s = l.state;
    const status = s.status === 'online' ? '' : s.status === 'connecting' ? 'Verbinden…' : 'Geen verbinding, opnieuw proberen…';
    const people = s.online.map((o) => `<li>${avatar(o.id, o.naam, !o.viewing.visible)}<span><b>${esc(o.naam)}${o.id === s.me ? ' (jij)' : ''}</b><small>${viewingText(o)}</small></span>${challengeBtn(l, o.id, o.naam)}</li>`).join('');
    const rec = recent(l).map((m) => `<li>${avatar(m.id, m.naam, true)}<span><b>${esc(m.naam)}</b><small>${ago(m.lastSeen)}</small></span></li>`).join('');
    panel.innerHTML = `
      <div class="chead"><h4>${esc(tripName(active))} · nu online</h4>${status ? `<span class="cstatus">${status}</span>` : ''}</div>
      <ul class="people">${people}</ul>
      ${rec ? `<h4>Laatste uur online</h4><ul class="people">${rec}</ul>` : ''}
      <ul class="msgs" id="chatMsgs">${s.messages.map((m, i) => msgHTML(l, m, s.messages[i - 1])).join('') || '<li class="empty">Nog geen berichten. Zeg eens hallo!</li>'}</ul>
      <form class="csend" id="chatForm"><label class="vh" for="chatText">Bericht</label><input id="chatText" maxlength="500" autocomplete="off" placeholder="Bericht aan ${esc(tripName(active))}"><button type="submit" class="primary">Stuur</button></form>`;
    ($('chatForm') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const inp = $('chatText') as HTMLInputElement, text = inp.value.trim();
      if (!text || l.state.status !== 'online') return;
      l.say(text);
      inp.value = '';
    };
    const inp = $('chatText') as HTMLInputElement;
    inp.value = typed;
    if (focused) inp.focus();
    scrollDown();
  }

  // ---------- toasts ----------
  function toast(html: string, ms: number) {
    const box = $('toasts'), el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    el.onclick = () => setOpen(true);
    box.append(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
  }

  // 'x min geleden' and the one-hour window move on with time
  setInterval(() => { if (open) render(); else renderWho(); }, 60_000);

  render();
  return {
    /** the trip on screen changed */
    setTrip(t: string | null) {
      active = t;
      for (const l of lives.values()) l.setActive(t);
      if (open) markRead();
      renderBadges();
      render();
    },
  };
}
