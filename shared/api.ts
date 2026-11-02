// Shapes of the account and admin API (server/app.ts ↔ src/account.ts, src/admin.ts).

export interface MyTrip {
  id: string;
  /** area id (areas/<id>/) */
  area: string;
  naam: string;
  /** the trip's suggested arrival date (set by the admin), YYYY-MM-DD */
  aankomstReis: string;
  /** this person's own arrival date; null until they chose one */
  aankomst: string | null;
}

export interface Me {
  user: { id: string; email: string; naam: string; isAdmin: boolean; hasPassword: boolean;
    /** version of my photo (for its address), null without one */
    avatar: number | null };
  trips: MyTrip[];
  /** admins only: people waiting for a new link because they forgot their password */
  resets: number;
}

export interface AdminTrip {
  id: string;
  area: string;
  naam: string;
  aankomst: string;
  members: number;
}

export interface AdminUser {
  id: string;
  email: string;
  naam: string;
  isAdmin: boolean;
  trips: string[];
  lastSeen: number | null;
  sessions: number;
  /** an unused, unexpired invite exists */
  invitePending: boolean;
  /** asked for a new password ('wachtwoord vergeten') */
  resetRequested: boolean;
  /** version of their photo, null without one */
  avatar: number | null;
}

export interface AdminState {
  trips: AdminTrip[];
  users: AdminUser[];
}

export interface AdminOnline {
  trip: string;
  online: { id: string; naam: string; visible: boolean }[];
}

/** a profile photo as sent by the browser: a small JPEG */
export const AVATAR_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
export const AVATAR_MAX = 120_000;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
