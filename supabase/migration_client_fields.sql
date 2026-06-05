-- Add full_name, address, phone to clients table
-- Run this in Supabase SQL Editor (project kjmewtltinaqpfkwgnpb)

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;
