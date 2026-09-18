CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);
