-- ─────────────────────────────────────────────────────────────────────────────
-- 013 — Valutakurser för bokföringen
--
-- Bokföringen görs i kronor men appen räknar i euro. Underlaget behöver
-- därför Riksbankens dagskurs för den dag varje köp och sälj skedde — det är
-- den svenska redovisningsstandarden.
--
-- Kurserna sparas här i stället för att hämtas om varje gång. Två skäl:
-- en omexport ger då samma siffror som redovisaren redan bokfört, och en
-- månad med fyrtio försäljningar kostar ett anrop i stället för fyrtio.
--
-- Tabellen är tät: varje kalenderdag får en rad. Riksbanken publicerar inga
-- kurser på helger och röda dagar, så de dagarna bär senast publicerade kurs
-- (source = 'carry'), vilket också är regeln vid bokföring.
--
-- Kör hela filen i Supabase → SQL Editor. Den kan köras om utan skada.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fx_rates (
  day         DATE        NOT NULL,
  currency    TEXT        NOT NULL DEFAULT 'EUR',
  rate        NUMERIC     NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'riksbank',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, currency)
);

-- En kurs måste vara positiv. En nolla här skulle göra hela underlaget noll.
ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_positive;
ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_positive CHECK (rate > 0);

-- Exporten hämtar alltid ett datumspann.
CREATE INDEX IF NOT EXISTS fx_rates_day_idx ON fx_rates (currency, day);

-- Kontroll — tabellen ska finnas och vara tom första gången.
SELECT count(*) AS sparade_kurser,
       min(day) AS fran,
       max(day) AS till
FROM fx_rates;
