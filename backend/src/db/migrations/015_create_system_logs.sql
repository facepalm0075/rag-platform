CREATE TABLE system_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level VARCHAR(10) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  category VARCHAR(50) NOT NULL DEFAULT 'app',
  message TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(100),
  meta JSONB DEFAULT '{}'
);

CREATE INDEX idx_system_logs_timestamp ON system_logs (timestamp DESC);
CREATE INDEX idx_system_logs_level ON system_logs (level);
CREATE INDEX idx_system_logs_category ON system_logs (category);
