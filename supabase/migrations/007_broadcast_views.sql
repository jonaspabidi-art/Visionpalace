CREATE TABLE IF NOT EXISTS broadcast_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(broadcast_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_views_broadcast ON broadcast_views(broadcast_id);
