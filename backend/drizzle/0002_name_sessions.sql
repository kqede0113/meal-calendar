CREATE TABLE name_sessions (calendar_id TEXT NOT NULL REFERENCES calendars(id), device_hash TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES members(id), PRIMARY KEY(calendar_id, device_hash));
