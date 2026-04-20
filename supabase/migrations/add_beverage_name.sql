-- Add optional beverage name to price entries.
-- Run against both production and demo tables.
ALTER TABLE prices ADD COLUMN IF NOT EXISTS beverage_name text;
ALTER TABLE prices_demo ADD COLUMN IF NOT EXISTS beverage_name text;
