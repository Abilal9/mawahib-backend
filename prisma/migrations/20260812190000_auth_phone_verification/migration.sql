-- Add phone + independent verification flags on profiles (auth enhancement)
ALTER TABLE "profiles" ADD COLUMN "phone_e164" TEXT;
ALTER TABLE "profiles" ADD COLUMN "phone_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profiles" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "profiles_phone_e164_key" ON "profiles"("phone_e164");
