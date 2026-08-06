-- ─────────────────────────────────────────────────────────────────────────────
-- 011 — Förbeställningar
--
-- Ibland säljs ett par innan det finns. Det beställs från Cartier och tar
-- 1–6 veckor. Varan passerar aldrig lagret i appen: den går från leverantören
-- rakt till kunden. Leverantörsfakturan hängs i stället på försäljningen, och
-- är det som ger inköpet spår i bokföringen.
--
-- Kör hela filen i Supabase → SQL Editor. Den kan köras om utan skada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Markering och beräknad leveranstid, angiven som ett spann i veckor räknat
--    från säljdatumet. Kunden ser spannet som två datum.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_preorder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS eta_weeks_min INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS eta_weeks_max INTEGER;

-- 2. När varan faktiskt kom in. Sätts en gång, av knappen i Historik.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

-- 3. Leverantörsfakturan för just den här ordern (Cartier). Laddas upp när den
--    kommer och är bokföringens underlag för inköpet.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS supplier_doc_url TEXT;

-- 4. Spannet ska vara rimligt och inte bakvänt.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_eta_sane;
ALTER TABLE sales ADD CONSTRAINT sales_eta_sane CHECK (
  (eta_weeks_min IS NULL AND eta_weeks_max IS NULL)
  OR (eta_weeks_min >= 0 AND eta_weeks_max >= eta_weeks_min AND eta_weeks_max <= 104)
);

-- 5. Inköpsloggen behöver kunna peka på försäljningen den hör till, så en
--    förbeställning inte råkar bokföras två gånger.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

-- 6. Kontroll — kolumnerna ska finnas och inga befintliga sälj vara påverkade.
SELECT count(*)                              AS totalt_salj,
       count(*) FILTER (WHERE is_preorder)   AS forbestallningar,
       count(*) FILTER (WHERE arrived_at IS NOT NULL) AS inkomna
FROM sales;
