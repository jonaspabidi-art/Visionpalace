-- Add message_type and metadata columns to messages table
-- Run this in Supabase SQL Editor (project kjmewtltinaqpfkwgnpb)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS metadata JSONB;
