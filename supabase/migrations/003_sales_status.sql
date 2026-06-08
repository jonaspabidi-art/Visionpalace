-- Sale status + shipping tracking fields
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS shipping_carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
