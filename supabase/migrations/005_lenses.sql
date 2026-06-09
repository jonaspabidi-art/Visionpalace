-- Lenses inventory with color variants
CREATE TABLE IF NOT EXISTS lenses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  ref_code   TEXT,
  sell_price NUMERIC,
  buy_price  NUMERIC,
  notes      TEXT,
  image      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lens_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lens_id     UUID NOT NULL REFERENCES lenses(id) ON DELETE CASCADE,
  color_name  TEXT NOT NULL,
  stock_count INTEGER NOT NULL DEFAULT 0
);

-- Allow sale_items to reference lenses
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS lens_id         UUID REFERENCES lenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lens_variant_id UUID REFERENCES lens_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lens_color      TEXT;
