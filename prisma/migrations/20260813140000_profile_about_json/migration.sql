-- Optional structured about sections for profile completeness / demo seed
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "about_json" JSONB;
