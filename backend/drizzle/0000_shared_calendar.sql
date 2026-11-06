CREATE TABLE calendars (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE members (id TEXT PRIMARY KEY NOT NULL, calendar_id TEXT NOT NULL REFERENCES calendars(id), name TEXT NOT NULL, UNIQUE(calendar_id, name));
--> statement-breakpoint
CREATE TABLE entries (id TEXT NOT NULL, calendar_id TEXT NOT NULL REFERENCES calendars(id), date TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), member_id TEXT NOT NULL REFERENCES members(id), version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY(calendar_id, id));
--> statement-breakpoint
CREATE INDEX entries_calendar_date ON entries(calendar_id, date);
--> statement-breakpoint
CREATE TABLE creation_limits (id TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
