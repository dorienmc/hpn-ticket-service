CREATE TABLE IF NOT EXISTS admin_access_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    emails TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_access_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_email TEXT NOT NULL,
    emails TEXT NOT NULL,
    created_at TEXT NOT NULL
);
