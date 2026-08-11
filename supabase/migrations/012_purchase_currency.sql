-- ─────────────────────────────────────────────────────────────────────────────
-- 012 — Fakturans egen valuta på inköpen
--
-- Inköpsfakturorna från Kering kommer i kronor, men lagret räknas i euro.
-- Vid inskanningen räknades beloppet om med den överenskomna kursen och
-- originalet kastades bort. Kursen är en intern uppgörelse för vinstdelningen,
-- inte den kurs banken faktiskt tog, så inköpen i bokföringsunderlaget kunde
-- aldrig stämmas av mot fakturan de kom ifrån.
--
-- Nu sparas raden som fakturan faktiskt säger, tillsammans med kursen som
-- användes. Euro-priset ligger kvar orört — appen räknar marginal mot
-- försäljningar i euro och ska fortsätta göra det.
--
-- Kör hela filen i Supabase → SQL Editor. Den kan köras om utan skada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Vad fakturan sa, per styck, i sin egen valuta.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS buy_price_original NUMERIC;

-- 2. Vilken valuta det var. NULL betyder att inköpet lades in innan det här
--    började sparas — då är euro-priset det enda som finns.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS buy_currency TEXT;

-- 3. Kursen som användes vid omräkningen, uttryckt som antal av valutan per
--    euro (11 = 11 kr per euro). Sparas så att omräkningen går att granska
--    i efterhand även om kursen ändras.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;

-- 4. Ett belopp utan valuta går inte att tolka, och en kurs måste vara positiv.
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_currency_sane;
ALTER TABLE purchases ADD CONSTRAINT purchases_currency_sane CHECK (
  (buy_price_original IS NULL OR buy_currency IS NOT NULL)
  AND (fx_rate IS NULL OR fx_rate > 0)
);

-- 5. Kontroll — kolumnerna ska finnas och inga befintliga inköp ha ändrats.
SELECT count(*)                                            AS totalt_inkop,
       count(*) FILTER (WHERE buy_currency IS NOT NULL)     AS med_valuta,
       count(*) FILTER (WHERE buy_price_original IS NULL)   AS utan_original
FROM purchases;
