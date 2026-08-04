-- Vision Palace — Inköpslogg + betalningsbevis
-- Kör i Supabase SQL Editor (Dashboard → SQL Editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INKÖPSLOGG
--    Idag raderas lagerraden när varan säljs, och inköpspriset lever bara kvar
--    som en kopia på säljraden. En vara som aldrig säljs lämnar inget spår alls.
--    Den här tabellen loggar inköpet NÄR det görs och rörs aldrig av försäljning.
--    Medvetet ingen foreign key på inventory_id: lagerraden försvinner, loggen består.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  inventory_id UUID,                 -- ingen FK, se ovan
  name TEXT NOT NULL,
  ref_code TEXT,
  buy_price NUMERIC,                 -- i euro, samma som lagret
  qty INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'order_import'
  document_url TEXT,                 -- orderpapper/faktura, fylls av AI-importen
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchases_date_idx ON purchases (purchased_at DESC);
CREATE INDEX IF NOT EXISTS purchases_ref_idx  ON purchases (ref_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BETALNINGSBEVIS
--    En rad per betalning så delbetalningar fungerar. amount får vara NULL
--    när man bara vill fästa ett kvitto utan att dela upp beloppet.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount NUMERIC,                    -- i euro, valfritt
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  image_url TEXT,                    -- bild på banköverföringen
  note TEXT,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON sale_payments (sale_id, paid_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BETALNINGSDATUM PÅ FÖRSÄLJNINGEN
--    För bokföringen är det datumet pengarna kom in som räknas, inte
--    orderdatumet. Sätts när ordern markeras betald.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Kontrollera att allt kom på plats — ska ge tre rader
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('purchases', 'sale_payments')
UNION ALL
SELECT 'sales.paid_at' FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'paid_at';
