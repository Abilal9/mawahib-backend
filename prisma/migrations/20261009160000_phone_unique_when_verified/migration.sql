-- An unverified phone must not reserve the canonical number.
-- Only a verified phone is unique. Existing unverified rows, including
-- dev seeds, stay as they are.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_phone_e164_key;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_e164_verified_key
  ON public.profiles (phone_e164)
  WHERE phone_verified = true AND phone_e164 IS NOT NULL;
