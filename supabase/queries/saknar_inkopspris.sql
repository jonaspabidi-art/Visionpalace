-- Vilka försäljningar påverkas av att en rad saknar inköpspris?
-- Läser bara, ändrar ingenting. Kör i Supabase → SQL Editor.
--
-- En rad utan inköpspris räknas som genomgång: den höjer omsättningen men ger
-- noll i vinst. Frakt och rabatt ska vara sådana. Varor ska inte.

-- 1. Raderna det gäller, en rad per vara
SELECT
  s.invoice_number,
  s.created_at::date            AS datum,
  s.status,
  s.is_preorder                 AS forbestallning,
  i.name                        AS vara,
  i.ref_code,
  i.qty                         AS antal,
  i.sell_price                  AS saljpris,
  (i.sell_price * i.qty)        AS omsattning_utan_vinst
FROM sale_items i
JOIN sales s ON s.id = i.sale_id
WHERE i.buy_price IS NULL
  AND s.status <> 'cancelled'
  -- frakt och rabatt ska sakna inköpspris
  AND i.name <> 'Shipping'
  AND i.name NOT LIKE 'Discount%'
  AND i.sell_price > 0
ORDER BY s.created_at DESC;


-- 2. Summan: hur mycket omsättning som i dag ger noll i vinst
SELECT
  count(*)                          AS antal_rader,
  count(DISTINCT s.id)              AS antal_ordrar,
  sum(i.sell_price * i.qty)         AS omsattning_utan_vinst
FROM sale_items i
JOIN sales s ON s.id = i.sale_id
WHERE i.buy_price IS NULL
  AND s.status <> 'cancelled'
  AND i.name <> 'Shipping'
  AND i.name NOT LIKE 'Discount%'
  AND i.sell_price > 0;
