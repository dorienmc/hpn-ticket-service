CREATE TABLE IF NOT EXISTS admin_session_revocations (
    session_value TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
