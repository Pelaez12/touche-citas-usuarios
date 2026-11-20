CREATE TABLE IF NOT EXISTS client_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE REFERENCES clients(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS client_accounts_email_idx ON client_accounts(lower(email));

CREATE TABLE IF NOT EXISTS client_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES client_accounts(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS client_sessions_expiry_idx ON client_sessions(expires_at);

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0013_client_portal_accounts');
