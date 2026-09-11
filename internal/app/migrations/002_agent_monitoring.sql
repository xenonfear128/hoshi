CREATE TABLE agent_bindings (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id text NOT NULL UNIQUE REFERENCES hosts(id) ON DELETE CASCADE,
 agent_id text NOT NULL DEFAULT '', version text NOT NULL DEFAULT '',
 report_digest text NOT NULL DEFAULT '', pending_digest text NOT NULL DEFAULT '', pending_secret text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending', config text NOT NULL, latest text NOT NULL DEFAULT '',
 last_seen timestamptz, last_current timestamptz, last_sampled_at timestamptz,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_bindings_owner ON agent_bindings(user_id);
CREATE UNIQUE INDEX agent_report_digest ON agent_bindings(report_digest) WHERE report_digest<>'';
CREATE UNIQUE INDEX agent_pending_digest ON agent_bindings(pending_digest) WHERE pending_digest<>'';
CREATE TABLE agent_registration_tokens (
 digest text PRIMARY KEY, binding_id text NOT NULL REFERENCES agent_bindings(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE agent_install_jobs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, kind text NOT NULL,
 status text NOT NULL DEFAULT 'pending', message text NOT NULL DEFAULT '', credential text NOT NULL DEFAULT '',
 expected_version text NOT NULL DEFAULT '', previous_session text NOT NULL DEFAULT '', report_after timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_install_jobs_host ON agent_install_jobs(host_id, updated_at DESC);
CREATE UNIQUE INDEX agent_install_one_active ON agent_install_jobs(host_id) WHERE status IN ('pending','running','waiting');
CREATE TABLE metric_samples (
 binding_id text NOT NULL REFERENCES agent_bindings(id) ON DELETE CASCADE,
 session_id text NOT NULL, sequence bigint NOT NULL, sample_second bigint NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(binding_id,session_id,sequence), UNIQUE(binding_id,sample_second)
);
CREATE INDEX metric_samples_expiry ON metric_samples(received_at);
CREATE TABLE metric_rollups (
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
 step integer NOT NULL CHECK(step IN (10,60,3600)), bucket timestamptz NOT NULL, data text NOT NULL,
 PRIMARY KEY(host_id,step,bucket)
);
CREATE TABLE monitor_traffic (
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
 period text NOT NULL, start_at timestamptz NOT NULL, data text NOT NULL,
 PRIMARY KEY(host_id,period,start_at)
);
CREATE TABLE monitor_events (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, kind text NOT NULL,
 severity text NOT NULL DEFAULT 'info', data text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitor_events_host_time ON monitor_events(host_id, created_at DESC);
CREATE TABLE alert_rules (
 host_id text PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 config text NOT NULL, state text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE alert_deliveries (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES monitor_events(id) ON DELETE CASCADE,
 host_id text NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(), last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_deliveries_pending ON alert_deliveries(next_attempt) WHERE status='pending';
