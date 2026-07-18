-- ISP Monitor — D1 schema (port dari db.js better-sqlite3)
CREATE TABLE IF NOT EXISTS isp_list (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  country      TEXT NOT NULL,
  region       TEXT,
  isp_ip       TEXT,
  http_url     TEXT,
  order_index  INTEGER DEFAULT 0,
  is_active    INTEGER DEFAULT 1,
  notes        TEXT,
  category     TEXT DEFAULT 'isp',
  asn          TEXT,
  real_ip      TEXT,
  status_url   TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS isp_status_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id       INTEGER NOT NULL,
  check_type   TEXT NOT NULL,
  status       INTEGER NOT NULL,
  latency_ms   INTEGER,
  probe        TEXT NOT NULL DEFAULT 'cf',
  recorded_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS isp_uptime_cache (
  isp_id         INTEGER NOT NULL,
  check_date     DATE NOT NULL,
  total_checks   INTEGER NOT NULL,
  successful     INTEGER NOT NULL,
  uptime_percent REAL NOT NULL,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (isp_id, check_date)
);

CREATE TABLE IF NOT EXISTS probes (
  probe     TEXT PRIMARY KEY,
  asn       TEXT,
  location  TEXT,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS isp_verify (
  isp_id    INTEGER PRIMARY KEY,
  target_ip TEXT,
  target_asn INTEGER,
  expected_asn INTEGER,
  match     INTEGER,
  note      TEXT,
  checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used   DATETIME,
  is_active   INTEGER DEFAULT 1,
  rate_limit  INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS ping_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp TEXT NOT NULL,
  city TEXT,
  ping INTEGER,
  server_ping INTEGER,
  saran TEXT,
  kategori TEXT DEFAULT 'global',
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_hist_isp ON isp_status_history(isp_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_hist_isp_type_time ON isp_status_history(isp_id, check_type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_hist_rt ON isp_status_history(recorded_at);
