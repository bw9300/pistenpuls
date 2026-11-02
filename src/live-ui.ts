// Live in the dashboard: who's watching (top bar), the group panel with messages, and toasts for news.
// Everyone who opens Pistenpuls is in the same group.
import { RECENT_MS, ROOM, type ChatMessage, type Member, type OnlineMember } from '../shared/live';
import { AREAS } from './areas';
import { connectLive, type Live, type LiveEvent } from './live';
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
  return `${Math.round(s / 60)} min geleden`;
}

function day(ts: number) {
  const d = new Date(ts), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Vandaag';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function startLiveUI(opts: { apiBase: string; naam: string; trip: string | null }) {
  const btn = $('chatBtn'), panel = $('chat'), who = $('who');
  let trip = opts.trip, unread = 0, open = false;

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

  // ---------- connection: everyone in the same room ----------
  const live: Live = connectLive({ apiBase: opts.apiBase, room: ROOM, naam: opts.naam, trip, onEvent });

  function onEvent(e: LiveEvent) {
    if (e.t === 'msg') {
      if (e.msg.from !== live.me && !open) {
        unread++;
        renderBadge();
        toast(`${avatar(e.msg.from, e.msg.naam)}<span><b>${esc(e.msg.naam)}</b> ${esc(e.msg.text)}</span>`, 9000);
      }
      if (open) { appendMessage(e.msg); scrollDown(); }
      return;
    }
    if (e.t === 'presence') for (const j of e.joined) toast(`${avatar(j.id, j.naam)}<span><b>${esc(j.naam)}</b> kijkt nu mee</span>`, 5000);
    render();
  }

  // ---------- rendering ----------
  /** left within the last hour and not online now */
  const recent = (): Member[] => {
    const onlineIds = new Set(live.state.online.map((o) => o.id));
    return live.state.members.filter((m) => !onlineIds.has(m.id) && Date.now() - m.lastSeen < RECENT_MS);
  };

  function renderWho() {
    const s = live.state;
    if (s.status !== 'online') { who.hidden = true; return; }
    const others = s.online.filter((o) => o.id !== live.me);
    const list = [s.online.find((o) => o.id === live.me), ...others].filter(Boolean) as OnlineMember[];
    const rec = recent();
    who.hidden = false;
    who.title = list.map((o) => o.naam + (o.viewing.trip ? ` · ${tripName(o.viewing.trip)}` : '')).join('\n')
      + (rec.length ? `\n\nLaatste uur: ${rec.map((m) => m.naam).join(', ')}` : '');
    who.innerHTML = `<span class="avs">${list.slice(0, 3).map((o) => avatar(o.id, o.naam, !o.viewing.visible)).join('')}</span>`
      + (list.length > 3 ? `<em>+${list.length - 3}</em>` : '')
      + `<span class="wlbl">${others.length ? `${others.length + 1} kijken mee` : 'alleen jij'}</span>`;
  }

  function renderBadge() {
    btn.classList.toggle('unread', unread > 0);
    $('chatBadge').textContent = unread > 9 ? '9+' : String(unread);
    btn.setAttribute('aria-label', unread ? `Groep openen, ${unread} ${unread === 1 ? 'nieuw bericht' : 'nieuwe berichten'}` : 'Groep openen');
  }

  const msgHTML = (m: ChatMessage, prev?: ChatMessage) => {
    const mine = m.from === live.me, sameDay = prev && day(prev.ts) === day(m.ts);
    const grouped = sameDay && prev!.from === m.from && m.ts - prev!.ts < 5 * 60_000;
    return (sameDay ? '' : `<li class="day">${day(m.ts)}</li>`)
      + `<li class="m${mine ? ' mine' : ''}${grouped ? ' cont' : ''}">${grouped || mine ? '' : avatar(m.from, m.naam)}<div>${grouped || mine ? '' : `<b>${esc(m.naam)}</b>`}<p>${esc(m.text)}</p><time>${time(m.ts)}</time></div></li>`;
  };
  function appendMessage(m: ChatMessage) {
    const list = panel.querySelector('#chatMsgs');
    if (!list) return;
    list.querySelector('.empty')?.remove();
    const msgs = live.state.messages;
    list.insertAdjacentHTML('beforeend', msgHTML(m, msgs[msgs.length - 2]));
  }
  const scrollDown = () => { const l = panel.querySelector('#chatMsgs'); if (l) l.scrollTop = l.scrollHeight; };

  function render() {
    renderWho();
    if (!open) return;
    // keep what's being typed across re-renders
    const prevInput = panel.querySelector('#chatText') as HTMLInputElement | null, typed = prevInput?.value || '', focused = document.activeElement === prevInput;
    const s = live.state;
    const status = s.status === 'online' ? '' : s.status === 'connecting' ? 'Verbinden…' : 'Geen verbinding, opnieuw proberen…';
    const people = s.online.map((o) => `<li>${avatar(o.id, o.naam, !o.viewing.visible)}<span><b>${esc(o.naam)}${o.id === live.me ? ' (jij)' : ''}</b><small>${o.viewing.visible ? (o.viewing.trip ? 'kijkt naar ' + esc(tripName(o.viewing.trip)) : 'online') : 'op de achtergrond'}</small></span></li>`).join('');
    const rec = recent().map((m) => `<li>${avatar(m.id, m.naam, true)}<span><b>${esc(m.naam)}</b><small>${ago(m.lastSeen)}</small></span></li>`).join('');
    panel.innerHTML = `
      <div class="chead"><h4>Nu online</h4>${status ? `<span class="cstatus">${status}</span>` : ''}</div>
      <ul class="people">${people}</ul>
      ${rec ? `<h4>Laatste uur online</h4><ul class="people">${rec}</ul>` : ''}
      <ul class="msgs" id="chatMsgs">${s.messages.map((m, i) => msgHTML(m, s.messages[i - 1])).join('') || '<li class="empty">Nog geen berichten. Zeg eens hallo!</li>'}</ul>
      <form class="csend" id="chatForm"><label class="vh" for="chatText">Bericht</label><input id="chatText" maxlength="500" autocomplete="off" placeholder="Bericht aan iedereen"><button type="submit" class="primary">Stuur</button></form>`;
    ($('chatForm') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const inp = $('chatText') as HTMLInputElement, text = inp.value.trim();
      if (!text || live.state.status !== 'online') return;
      live.say(text);
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
  setInterval(render, 60_000);

  render();
  return {
    setTrip(t: string | null) { trip = t; live.setTrip(t); },
  };
}
