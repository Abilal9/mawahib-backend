-- Canonical profile geo codes (SoT) + listing currency snapshot for Payments.
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "country_code" CHAR(2),
  ADD COLUMN IF NOT EXISTS "location_code" TEXT;

ALTER TABLE "job_listings"
  ADD COLUMN IF NOT EXISTS "currency" CHAR(3) NOT NULL DEFAULT 'SAR';

-- Dev/test backfill from free-text location fields.
UPDATE "profiles"
SET
  "country_code" = CASE
    WHEN lower(coalesce("location_country", '')) LIKE '%emirates%'
      OR lower(coalesce("location_country", '')) LIKE '%uae%'
      OR lower(coalesce("location_city", '')) LIKE '%dubai%'
      OR lower(coalesce("location_city", '')) LIKE '%abu dhabi%'
      OR lower(coalesce("location_city", '')) LIKE '%sharjah%'
      OR lower(coalesce("location_city", '')) LIKE '%ajman%'
      OR lower(coalesce("location_city", '')) LIKE '%fujairah%'
      OR lower(coalesce("location_city", '')) LIKE '%ras al%'
      OR lower(coalesce("location_city", '')) LIKE '%umm al%'
      THEN 'AE'
    ELSE 'SA'
  END
WHERE "country_code" IS NULL;

UPDATE "profiles"
SET
  "location_code" = CASE
    WHEN "country_code" = 'AE' THEN
      CASE
        WHEN lower(coalesce("location_city", '')) LIKE '%abu dhabi%' THEN 'abu_dhabi'
        WHEN lower(coalesce("location_city", '')) LIKE '%sharjah%' THEN 'sharjah'
        WHEN lower(coalesce("location_city", '')) LIKE '%ajman%' THEN 'ajman'
        WHEN lower(coalesce("location_city", '')) LIKE '%fujairah%' THEN 'fujairah'
        WHEN lower(coalesce("location_city", '')) LIKE '%ras al%' THEN 'ras_al_khaimah'
        WHEN lower(coalesce("location_city", '')) LIKE '%umm al%' THEN 'umm_al_quwain'
        ELSE 'dubai'
      END
    ELSE
      CASE
        WHEN lower(coalesce("location_city", '')) LIKE '%jeddah%' THEN 'jeddah'
        WHEN lower(coalesce("location_city", '')) LIKE '%makkah%'
          OR lower(coalesce("location_city", '')) LIKE '%mecca%' THEN 'makkah'
        WHEN lower(coalesce("location_city", '')) LIKE '%madinah%'
          OR lower(coalesce("location_city", '')) LIKE '%medina%' THEN 'madinah'
        WHEN lower(coalesce("location_city", '')) LIKE '%dammam%' THEN 'dammam'
        WHEN lower(coalesce("location_city", '')) LIKE '%khobar%' THEN 'khobar'
        WHEN lower(coalesce("location_city", '')) LIKE '%dhahran%' THEN 'dhahran'
        WHEN lower(coalesce("location_city", '')) LIKE '%taif%' THEN 'taif'
        WHEN lower(coalesce("location_city", '')) LIKE '%abha%' THEN 'abha'
        WHEN lower(coalesce("location_city", '')) LIKE '%tabuk%' THEN 'tabuk'
        ELSE 'riyadh'
      END
  END
WHERE "location_code" IS NULL;

UPDATE "profiles"
SET
  "location_country" = CASE
    WHEN "country_code" = 'AE' THEN 'United Arab Emirates'
    ELSE 'Saudi Arabia'
  END,
  "location_city" = CASE
    WHEN "location_code" = 'riyadh' THEN 'Riyadh'
    WHEN "location_code" = 'jeddah' THEN 'Jeddah'
    WHEN "location_code" = 'makkah' THEN 'Makkah'
    WHEN "location_code" = 'madinah' THEN 'Madinah'
    WHEN "location_code" = 'dammam' THEN 'Dammam'
    WHEN "location_code" = 'khobar' THEN 'Khobar'
    WHEN "location_code" = 'dhahran' THEN 'Dhahran'
    WHEN "location_code" = 'taif' THEN 'Taif'
    WHEN "location_code" = 'abha' THEN 'Abha'
    WHEN "location_code" = 'tabuk' THEN 'Tabuk'
    WHEN "location_code" = 'abu_dhabi' THEN 'Abu Dhabi'
    WHEN "location_code" = 'dubai' THEN 'Dubai'
    WHEN "location_code" = 'sharjah' THEN 'Sharjah'
    WHEN "location_code" = 'ajman' THEN 'Ajman'
    WHEN "location_code" = 'umm_al_quwain' THEN 'Umm Al Quwain'
    WHEN "location_code" = 'ras_al_khaimah' THEN 'Ras Al Khaimah'
    WHEN "location_code" = 'fujairah' THEN 'Fujairah'
    ELSE coalesce("location_city", 'Riyadh')
  END
WHERE "country_code" IS NOT NULL AND "location_code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "profiles_country_code_idx" ON "profiles"("country_code");
