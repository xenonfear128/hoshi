CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS hosts (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 data text NOT NULL, credential text NOT NULL DEFAULT '', fingerprint text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hosts_owner ON hosts(user_id);
CREATE TABLE IF NOT EXISTS ai_settings (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data text NOT NULL, secret text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ai_usage (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source text NOT NULL, model text NOT NULL, input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0,
 reserved bigint NOT NULL DEFAULT 0, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credits (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0)
);
CREATE TABLE IF NOT EXISTS credit_events (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), amount bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_tasks (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, data text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';
CREATE TABLE IF NOT EXISTS billing_customers (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 customer_id text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS billing_events (
 event_id text PRIMARY KEY, invoice_id text UNIQUE, user_id text NOT NULL REFERENCES users(id),
 amount bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_checkouts (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 url text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_metadata (
 id integer PRIMARY KEY CHECK(id=1), key_check text NOT NULL
);
