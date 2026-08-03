-- Vision Palace — Avräkning (provisionskonto mellan säljande admin och bolagsägaren)
-- Kör i Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Modellen: saldot RÄKNAS FRAM ur försäljningarna varje gång sidan öppnas.
-- Det enda som lagras här är utbetalningar och ett eventuellt ingående saldo.
-- Rättas ett pris i efterhand rättar sig saldot av sig självt.

-- 1. Utbetalningar och ingående saldo. OBS: amount är alltid i SVENSKA KRONOR
--    (försäljningarna är i euro och räknas om med kursen i konfigurationen).
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  -- 'payout'  = utbetalning till säljarna (minskar skulden)
  -- 'opening' = ingående saldo / justering (ökar skulden)
  type TEXT NOT NULL DEFAULT 'payout',
  amount NUMERIC NOT NULL,          -- i kr
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlements_seller_idx
  ON settlements (seller_admin_id, occurred_at DESC);

-- 2. Provisionssatsen kan frysas per försäljning.
--    Är den NULL används satsen från konfigurationen nedan.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission_pct NUMERIC;

-- 3. Konfiguration — ⚠️ FYLL I ERA TVÅ ANVÄNDARNAMN PÅ RADERNA NEDAN
--    seller = kontot du och din bror delar (tjänar provisionen)
--    payer  = bolagsägarens konto (betalar ut den)
-- (Skriver om raden om den redan finns — fungerar oavsett hur app_settings
--  är indexerad, till skillnad från ON CONFLICT.)
DELETE FROM app_settings WHERE key = 'settlement_config';

INSERT INTO app_settings (key, value, updated_at)
SELECT 'settlement_config',
       json_build_object(
         'seller_admin_id', (SELECT id FROM admins WHERE lower(username) = lower('DITT_ANVANDARNAMN')),
         'payer_admin_id',  (SELECT id FROM admins WHERE lower(username) = lower('HANS_ANVANDARNAMN')),
         'commission_pct',  70,
         'eur_sek_rate',    11      -- överenskommen kurs: 1 € = 11 kr
       )::text,
       now();

-- 4. Verifiera att båda kontona hittades — BÅDA kolumnerna måste visa ett namn.
--    Står det NULL är användarnamnet felstavat: rätta och kör steg 3 igen.
SELECT
  (SELECT username FROM admins WHERE id = (value::json->>'seller_admin_id')::uuid) AS saljare,
  (SELECT username FROM admins WHERE id = (value::json->>'payer_admin_id')::uuid)  AS betalare,
  value::json->>'commission_pct' AS procentsats,
  value::json->>'eur_sek_rate'   AS eurokurs
FROM app_settings WHERE key = 'settlement_config';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vill ni ändra eurokursen senare räcker det att köra:
--
--   UPDATE app_settings
--   SET value = jsonb_set(value::jsonb, '{eur_sek_rate}', '11.5'::jsonb)::text,
--       updated_at = now()
--   WHERE key = 'settlement_config';
--
-- OBS: redan registrerade utbetalningar ligger kvar i kr och rörs inte, men
-- INTJÄNAT räknas om med den nya kursen — även för gamla försäljningar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- OBS — om ni någon gång ändrar procentsatsen (t.ex. 70 → 60):
-- kör FÖRST detta, annars räknas ALL historik om med den nya satsen:
--
--   UPDATE sales SET commission_pct = 70 WHERE commission_pct IS NULL;
--
-- Ändra därefter 'commission_pct' i settlement_config. Gamla försäljningar
-- behåller då sin gamla sats och bara nya sälj får den nya.
-- ─────────────────────────────────────────────────────────────────────────────
