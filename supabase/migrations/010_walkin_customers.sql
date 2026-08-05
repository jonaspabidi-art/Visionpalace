-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — Försäljning till kund utanför appen
--
-- Ibland säljs det till någon som inte är inbjuden som klient. Tidigare gick
-- det inte alls: sales.client_id var obligatorisk. Nu får ett sälj i stället
-- bära ett namn.
--
-- Kör hela filen i Supabase → SQL Editor. Den kan köras om utan skada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Namnet på köparen när det inte finns någon klient i appen.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- 2. Klienten blir valfri. Befintliga sälj rörs inte — de har redan en klient.
ALTER TABLE sales ALTER COLUMN client_id DROP NOT NULL;

-- 3. Ett sälj måste peka på ANTINGEN en klient ELLER ett namn, aldrig ingetdera.
--    Det skyddar mot ett sälj utan köpare om appen någon gång skickar fel.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_has_buyer;
ALTER TABLE sales ADD CONSTRAINT sales_has_buyer
  CHECK (client_id IS NOT NULL OR nullif(btrim(customer_name), '') IS NOT NULL);

-- 4. Kontroll — inga rader ska sakna köpare, och kolumnen ska finnas.
SELECT count(*) FILTER (WHERE client_id IS NOT NULL)     AS salj_till_klient,
       count(*) FILTER (WHERE customer_name IS NOT NULL) AS salj_till_namn,
       count(*) FILTER (WHERE client_id IS NULL
                          AND nullif(btrim(customer_name), '') IS NULL) AS utan_kopare
FROM sales;
