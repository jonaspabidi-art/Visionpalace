-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — Eurokursen fryses per försäljning
--
-- Bakgrund: kursen låg som EN siffra i konfigurationen och användes på ALLA
-- försäljningar. Ändrade man den räknades hela historiken om — ett sälj från
-- mars fick plötsligt augusti månads kurs. Euron rör sig under året, så det
-- gav fel belopp att betala ut.
--
-- Efter den här migrationen bär varje försäljning sin egen kurs, precis som
-- den redan bär sin egen provisionssats. Att ändra kursen påverkar då bara
-- nya sälj.
--
-- Kör hela filen i Supabase → SQL Editor. Den kan köras om utan skada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Kursen som gällde när försäljningen gjordes. NULL = använd kursen i
--    konfigurationen (så gamla rader fungerar även innan steg 2 körts).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS eur_sek_rate NUMERIC;

-- 2. Frys det som redan finns vid dagens värden, så inga siffror ändras idag.
--    Först efter det här är historiken skyddad mot framtida kursändringar.
UPDATE sales
SET eur_sek_rate = COALESCE(
      (SELECT (value::json->>'eur_sek_rate')::numeric
       FROM app_settings WHERE key = 'settlement_config'), 11)
WHERE eur_sek_rate IS NULL;

UPDATE sales
SET commission_pct = COALESCE(
      (SELECT (value::json->>'commission_pct')::numeric
       FROM app_settings WHERE key = 'settlement_config'), 70)
WHERE commission_pct IS NULL;

-- 3. Kontroll — alla rader ska ha både kurs och sats, och min/max visar
--    vilka värden historiken frusits vid.
SELECT count(*)                        AS antal_salj,
       count(eur_sek_rate)             AS med_kurs,
       count(commission_pct)           AS med_sats,
       min(eur_sek_rate) || ' – ' || max(eur_sek_rate)   AS kursspann,
       min(commission_pct) || ' – ' || max(commission_pct) AS satsspann
FROM sales;

-- ─────────────────────────────────────────────────────────────────────────────
-- Att ändra kursen görs numera i appen: Historik → avräkningskortet →
-- Registrera → Växelkurs. Den gäller framåt; gamla sälj behåller sin egen.
--
-- Har ett enskilt gammalt sälj fel kurs rättas det så här:
--   UPDATE sales SET eur_sek_rate = 10.58 WHERE invoice_number = 'VP07-010';
-- ─────────────────────────────────────────────────────────────────────────────
