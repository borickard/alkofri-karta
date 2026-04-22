-- Add structured beverage category to price entries so the map marker can
-- reflect the cheapest *NA beer* specifically, while the detail panel can
-- still group and display soda / NA wine / other entries.
-- Existing rows backfill to 'na_beer', matching the site's scope before
-- multi-beverage submissions landed.
ALTER TABLE prices      ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'na_beer';
ALTER TABLE prices_demo ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'na_beer';

ALTER TABLE prices
  DROP CONSTRAINT IF EXISTS prices_category_check,
  ADD  CONSTRAINT prices_category_check
    CHECK (category IN ('na_beer', 'soda', 'na_wine', 'other'));

ALTER TABLE prices_demo
  DROP CONSTRAINT IF EXISTS prices_demo_category_check,
  ADD  CONSTRAINT prices_demo_category_check
    CHECK (category IN ('na_beer', 'soda', 'na_wine', 'other'));
