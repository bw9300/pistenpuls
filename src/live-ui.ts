// Live in the dashboard: who's watching (top bar), the group panel with messages, and toasts for news.
import type { ChatMessage, Member, OnlineMember } from '../shared/live';
import { AREAS } from './areas';
import { connectLive, getGroup, inviteLink, newGroupCode, setGroup, takeGroupFromLink, type Live } from './live';
import { esc } from './settings';

const $ = (id: string) => document.getElementById(id)!;
const COLORS = ['#E0533D', '#F0B45A', '#5B9BD5', '#7FB77E', '#B08BD9', '#E58FB1', '#4FB3B0'];
const color = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
const initial = (naam: string) => esc((naam.trim()[0] || '?').toUpperCase());
const avatar = (id: string, naam: string, dim = false) => `<i class="av${dim ? ' dim' : ''}" style="--c:${color(id)}" aria-hidden="true">${initial(naam)}</i>`;
const tripName = (id: string | null) => (id && AREAS.find((a) => a.id === id)?.kort) || '';
const time = (ts: number) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'net';
  if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  if (s < 86400) return `${Math.round(s / 3600)} uur geleden`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
}

function day(ts: number) {
  const d = new Date(ts), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Vandaag';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function startLiveUI(opts: { apiBase: string; naam: string; trip: string | null }) {
  takeGroupFromLink();
  const btn = $('chatBtn'), panel = $('chat'), who = $('who');
  let live: Live | null = null, trip = opts.trip, unread = 0, open = false;

  // ---------- panel open/close (same behaviour as the menu) ----------
  function setOpen(o: boolean) {
    open = o;
    panel.hidden = !o;
    btn.setAttribute('aria-expanded', String(o));
    document.body.classList.toggle('chatopen', o);
    if (o) { unread = 0; renderBadge(); render(); scrollDown(); setTimeout(() => (panel.querySelector('#chatText') as HTMLInputElement | null)?.focus(), 30); }
  }
  btn.onclick = () => setOpen(!open);
  who.onclick = () => setOpen(true);
  addEventListener('pointerdown', (e) => { if (open && !panel.contains(e.target as Node) && !btn.contains(e.target as Node) && !who.contains(e.target as Node)) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { setOpen(false); btn.focus(); } });

  // ---------- connection ----------
  function connect() {
    live?.close();
    live = null;
    const group = getGroup();
    if (group) live = connectLive({ apiBase: opts.apiBase, group, naam: opts.naam, trip, onEvent });
    render();
  }

  function onEvent(e: Parameters<Parameters<typeof connectLive>[0]['onEvent']>[0]) {
    if (e.t === 'msg') {
      if (e.msg.from !== live?.me) {
        if (!open) { unread++; renderBadge(); toast(`${avatar(e.msg.from, e.msg.naam)}<span><b>${esc(e.msg.naam)}</b> ${esc(e.msg.text)}</span>`, 9000); }
      }
      if (open) { appendMessage(e.msg); scrollDown(); }
      return;
    }
    if (e.t === 'presence') for (const j of e.joined) toast(`${avatar(j.id, j.naam)}<span><b>${esc(j.naam)}</b> kijkt nu mee</span>`, 5000);
    render();
  }

  // ---------- rendering ----------
  function renderWho() {
    const s = live?.state;
    if (!s || s.status !== 'online') { who.hidden = true; return; }
    const others = s.online.filter((o) => o.id !== live!.me);
    const list = [s.online.find((o) => o.id === live!.me), ...others].filter(Boolean) as OnlineMember[];
    who.hidden = false;
    who.title = list.map((o) => o.naam + (o.viewing.trip ? ` · ${tripName(o.viewing.trip)}` : '')).join('\n');
    who.innerHTML = `<span class="avs">${list.slice(0, 5).map((o) => avatar(o.id, o.naam, !o.viewing.visible)).join('')}</span>`
      + (list.length > 5 ? `<em>+${list.length - 5}</em>` : '')
      + `<span>${others.length ? `${others.length + 1} kijken mee` : 'alleen jij'}</span>`;
  }

  function renderBadge() {
    btn.classList.toggle('unread', unread > 0);
    $('chatBadge').textContent = unread > 9 ? '9+' : String(unread);
    btn.setAttribute('aria-label', unread ? `Groep openen, ${unread} ${unread === 1 ? 'nieuw bericht' : 'nieuwe berichten'}` : 'Groep openen');
  }

  const msgHTML = (m: ChatMessage, prev?: ChatMessage) => {
    const mine = m.from === live?.me, sameDay = prev && day(prev.ts) === day(m.ts);
    const grouped = sameDay && prev!.from === m.from && m.ts - prev!.ts < 5 * 60_000;
    return (sameDay ? '' : `<li class="day">${day(m.ts)}</li>`)
      + `<li class="m${mine ? ' mine' : ''}${grouped ? ' cont' : ''}">${grouped || mine ? '' : avatar(m.from, m.naam)}<div>${grouped || mine ? '' : `<b>${esc(m.naam)}</b>`}<p>${esc(m.text)}</p><time>${time(m.ts)}</time></div></li>`;
  };
  function appendMessage(m: ChatMessage) {
    const list = panel.querySelector('#chatMsgs');
    if (!list || !live) return;
    list.querySelector('.empty')?.remove();
    const msgs = live.state.messages;
    list.insertAdjacentHTML('beforeend', msgHTML(m, msgs[msgs.length - 2]));
  }
  const scrollDown = () => { const l = panel.querySelector('#chatMsgs'); if (l) l.scrollTop = l.scrollHeight; };

  function render() {
    renderWho();
    if (!open) return;
    const group = getGroup();
    if (!group || !live) { renderJoin(); return; }
    // keep what's being typed and the open state of 'Leden' across re-renders
    const prevInput = panel.querySelector('#chatText') as HTMLInputElement | null, typed = prevInput?.value || '', focused = document.activeElement === prevInput;
    const moreOpen = (panel.querySelector('.cmore') as HTMLDetailsElement | null)?.open || false;
    const s = live.state, onlineIds = new Set(s.online.map((o) => o.id));
    const status = s.status === 'online' ? '' : s.status === 'connecting' ? 'Verbinden…' : 'Geen verbinding, opnieuw proberen…';
    const people = s.online.map((o) => `<li>${avatar(o.id, o.naam, !o.viewing.visible)}<span><b>${esc(o.naam)}${o.id === live!.me ? ' (jij)' : ''}</b><small>${o.viewing.visible ? (o.viewing.trip ? 'kijkt naar ' + esc(tripName(o.viewing.trip)) : 'online') : 'op de achtergrond'}</small></span></li>`).join('');
    const earlier = s.members.filter((m: Member) => !onlineIds.has(m.id)).map((m) => `<li>${avatar(m.id, m.naam, true)}<span><b>${esc(m.naam)}</b><small>${ago(m.lastSeen)}</small></span></li>`).join('');
    panel.innerHTML = `
      <div class="chead"><h4>Groep</h4>${status ? `<span class="cstatus">${status}</span>` : ''}</div>
      <ul class="people">${people}</ul>
      <ul class="msgs" id="chatMsgs">${s.messages.map((m, i) => msgHTML(m, s.messages[i - 1])).join('') || '<li class="empty">Nog geen berichten. Zeg eens hallo!</li>'}</ul>
      <form class="csend" id="chatForm"><label class="vh" for="chatText">Bericht</label><input id="chatText" maxlength="500" autocomplete="off" placeholder="Bericht aan de groep"><button type="submit" class="primary">Stuur</button></form>
      <details class="cmore"${moreOpen ? ' open' : ''}><summary>Leden en uitnodigen</summary>
        ${earlier ? `<h4>Eerder online</h4><ul class="people">${earlier}</ul>` : ''}
        <h4>Iemand uitnodigen</h4>
        <p class="msrc">Stuur deze link naar de groep. Wie hem opent, doet mee.</p>
        <div class="grp"><button type="button" id="chatCopy">Kopieer uitnodigingslink</button></div>
        <div class="grp"><button type="button" id="chatLeave">Groep verlaten</button></div>
      </details>`;
    ($('chatForm') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const inp = $('chatText') as HTMLInputElement, text = inp.value.trim();
      if (!text || !live || live.state.status !== 'online') return;
      live.say(text);
      inp.value = '';
    };
    $('chatCopy').onclick = async (e) => {
      const b = e.currentTarget as HTMLButtonElement, link = inviteLink(group);
      try { await navigator.clipboard.writeText(link); b.textContent = 'Gekopieerd!'; }
      catch { prompt('Kopieer deze link:', link); }
      setTimeout(() => (b.textContent = 'Kopieer uitnodigingslink'), 2500);
    };
    $('chatLeave').onclick = () => { if (confirm('Groep verlaten? Met de uitnodigingslink kun je later weer meedoen.')) { setGroup(null); connect(); } };
    const inp = $('chatText') as HTMLInputElement;
    inp.value = typed;
    if (focused) inp.focus();
    scrollDown();
  }

  function renderJoin() {
    panel.innerHTML = `
      <div class="chead"><h4>Samen aftellen</h4></div>
      <p class="cintro">Zie wie er meekijkt en stuur berichten naar je skimaten. Maak een groep en deel de link, of doe mee met een link die je kreeg.</p>
      <div class="grp"><button type="button" class="primary" id="chatNew">Maak een groep</button></div>
      <form class="cjoin" id="chatJoin" novalidate><label class="fld" for="chatCode"><span>Uitnodigingslink of code</span><input id="chatCode" autocomplete="off" placeholder="…#groep=sneeuw-…"></label><p class="werr" id="chatErr" role="alert"></p><div class="grp"><button type="submit">Doe mee</button></div></form>`;
    $('chatNew').onclick = () => { setGroup(newGroupCode()); connect(); };
    ($('chatJoin') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const v = ($('chatCode') as HTMLInputElement).value.trim().toLowerCase(), m = v.match(/([a-z0-9]+-[a-z0-9-]+)\s*$/);
      if (!m || !/^[a-z0-9-]{6,40}$/.test(m[1])) { $('chatErr').textContent = 'Dat lijkt geen geldige link of code.'; return; }
      setGroup(m[1]);
      connect();
    };
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

  // keep 'x min geleden' fresh while the panel is open
  setInterval(() => { if (open) render(); }, 60_000);

  connect();
  return {
    setTrip(t: string | null) { trip = t; live?.setTrip(t); },
  };
}
