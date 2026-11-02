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
  user: { id: string; email: string; naam: string; isAdmin: boolean };
  trips: MyTrip[];
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
}

export interface AdminState {
  trips: AdminTrip[];
  users: AdminUser[];
}

export interface AdminOnline {
  trip: string;
  online: { id: string; naam: string; visible: boolean }[];
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
