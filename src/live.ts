// Connection to the group's room: who is online, who was here, messages. Reconnects by itself.
import { GROUP_RE, type ChatMessage, type ClientMsg, type Member, type OnlineMember, type ServerMsg, type Viewing } from '../shared/live';

export type LiveStatus = 'connecting' | 'online' | 'offline';

export interface LiveState {
  status: LiveStatus;
  online: OnlineMember[];
  members: Member[];
  messages: ChatMessage[];
}

export type LiveEvent =
  | { t: 'status' }
  | { t: 'state' }
  | { t: 'presence'; joined: OnlineMember[] }
  | { t: 'msg'; msg: ChatMessage };

export interface Live {
  state: LiveState;
  me: string;
  say(text: string): void;
  setTrip(trip: string | null): void;
  close(): void;
}

// ---------- identity and group (this browser) ----------
export function deviceId(): string {
  try {
    let id = localStorage.getItem('pp-id');
    if (!id) localStorage.setItem('pp-id', (id = crypto.randomUUID()));
    return id;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 10);
  }
}

export function getGroup(): string | null {
  try {
    const g = localStorage.getItem('pp-groep');
    return g && GROUP_RE.test(g) ? g : null;
  } catch {
    return null;
  }
}

export function setGroup(g: string | null) {
  try {
    if (g) localStorage.setItem('pp-groep', g);
    else localStorage.removeItem('pp-groep');
  } catch {}
}

export function newGroupCode(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'sneeuw-' + [...a].map((b) => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
}

/** an invite link (…#groep=code) opened in this browser: remember the group, tidy the address bar */
export function takeGroupFromLink() {
  const m = location.hash.match(/groep=([a-z0-9-]+)/);
  if (m && GROUP_RE.test(m[1])) {
    setGroup(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
}

export const inviteLink = (g: string) => `${location.origin}${location.pathname}#groep=${g}`;

// ---------- connection ----------
export function connectLive(opts: { apiBase: string; group: string; naam: string; trip: string | null; onEvent: (e: LiveEvent) => void }): Live {
  const me = deviceId();
  const state: LiveState = { status: 'connecting', online: [], members: [], messages: [] };
  let trip = opts.trip, ws: WebSocket | null = null, retry = 0, closed = false, pingT = 0, retryT = 0;

  const base = opts.apiBase || location.origin;
  const url = base.replace(/^http/, 'ws') + '/api/live/' + opts.group;
  const viewing = (): Viewing => ({ trip, visible: !document.hidden });
  const send = (m: ClientMsg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const setStatus = (s: LiveStatus) => { if (state.status !== s) { state.status = s; opts.onEvent({ t: 'status' }); } };

  function open() {
    setStatus('connecting');
    const sock = (ws = new WebSocket(url));
    sock.onopen = () => {
      retry = 0;
      send({ t: 'hello', id: me, naam: opts.naam, viewing: viewing() });
      clearInterval(pingT);
      pingT = window.setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('ping'), 25_000);
    };
    sock.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'state') {
        Object.assign(state, { online: m.online, members: m.members, messages: m.messages });
        setStatus('online');
        opts.onEvent({ t: 'state' });
      } else if (m.t === 'presence') {
        const before = new Set(state.online.map((o) => o.id));
        const joined = m.online.filter((o) => !before.has(o.id) && o.id !== me);
        Object.assign(state, { online: m.online, members: m.members });
        opts.onEvent({ t: 'presence', joined });
      } else if (m.t === 'msg') {
        state.messages.push(m.msg);
        if (state.messages.length > 200) state.messages.shift();
        opts.onEvent({ t: 'msg', msg: m.msg });
      } else if (m.t === 'error') console.warn('live', m.error);
    };
    sock.onclose = () => {
      clearInterval(pingT);
      if (ws !== sock || closed) return;
      setStatus('offline');
      retryT = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
  }

  const onVis = () => {
    send({ t: 'view', viewing: viewing() });
    // back from the background (e.g. phone unlocked) with a dead connection: reconnect now
    if (!document.hidden && state.status === 'offline') { clearTimeout(retryT); retry = 0; open(); }
  };
  document.addEventListener('visibilitychange', onVis);
  open();

  return {
    state,
    me,
    say: (text) => send({ t: 'msg', text }),
    setTrip: (t) => { trip = t; send({ t: 'view', viewing: viewing() }); },
    close: () => { closed = true; clearTimeout(retryT); clearInterval(pingT); document.removeEventListener('visibilitychange', onVis); ws?.close(); },
  };
}
