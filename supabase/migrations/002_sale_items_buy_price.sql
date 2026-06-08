-- Add buy_price to sale_items so we can calculate profit per item
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS buy_price NUMERIC;
