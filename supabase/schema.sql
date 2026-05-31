-- Vision Palace schema
-- Run in Supabase SQL Editor. Does NOT drop or modify existing tables.

CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  admin_label TEXT,
  invite_token TEXT,
  session_token TEXT UNIQUE NOT NULL,
  onesignal_player_id TEXT,
  joined_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  is_inactive BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT,
  price TEXT,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcast_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE CASCADE,
  storage_url TEXT NOT NULL,
  thumbnail_url TEXT,
  type TEXT CHECK (type IN ('image', 'video')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcast_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  reaction TEXT CHECK (reaction IN ('interested', 'not_interested')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(broadcast_id, client_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT CHECK (sender IN ('admin', 'client')) NOT NULL,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS message_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  storage_url TEXT NOT NULL,
  thumbnail_url TEXT,
  type TEXT CHECK (type IN ('image', 'video')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_session ON clients(session_token);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_media_broadcast ON broadcast_media(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_reactions_broadcast ON broadcast_reactions(broadcast_id);

-- Supabase Storage bucket for media (run in SQL editor)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public reads from media bucket
CREATE POLICY "Public media read" ON storage.objects FOR SELECT USING (bucket_id = 'media');

-- Allow authenticated service role to upload
CREATE POLICY "Service role upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'media');

-- Allow service role to delete
CREATE POLICY "Service role delete" ON storage.objects FOR DELETE USING (bucket_id = 'media');
