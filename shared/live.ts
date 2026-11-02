// Messages between the browser (src/live.ts) and a group's room (server/room.ts), as JSON over a WebSocket.

/** what someone is looking at right now */
export interface Viewing {
  /** area id of the trip on screen */
  trip: string | null;
  /** false when the tab is in the background */
  visible: boolean;
}

export interface Member {
  id: string;
  naam: string;
  /** ms since epoch; for online members the moment they came online */
  lastSeen: number;
}

export interface OnlineMember {
  id: string;
  naam: string;
  viewing: Viewing;
}

export interface ChatMessage {
  id: number;
  from: string;
  naam: string;
  text: string;
  ts: number;
}

export type ClientMsg =
  | { t: 'hello'; id: string; naam: string; viewing: Viewing }
  | { t: 'view'; viewing: Viewing }
  | { t: 'msg'; text: string };

export type ServerMsg =
  | { t: 'state'; online: OnlineMember[]; members: Member[]; messages: ChatMessage[] }
  | { t: 'presence'; online: OnlineMember[]; members: Member[] }
  | { t: 'msg'; msg: ChatMessage }
  | { t: 'error'; error: string };

/** group codes: lowercase letters, digits and dashes; also the room name */
export const GROUP_RE = /^[a-z0-9-]{6,40}$/;
export const MAX_TEXT = 500;
export const MAX_NAME = 30;
export const HISTORY = 100;
