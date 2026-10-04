-- AlterTable
ALTER TABLE "user_skills" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill deterministic positions per user (created_at, then skill name).
WITH ordered AS (
  SELECT
    "user_id",
    "skill",
    (ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "created_at" ASC, "skill" ASC
    ) - 1)::INTEGER AS "pos"
  FROM "user_skills"
)
UPDATE "user_skills" AS us
SET "position" = ordered."pos"
FROM ordered
WHERE us."user_id" = ordered."user_id"
  AND us."skill" = ordered."skill";

-- CreateIndex
CREATE INDEX "user_skills_user_id_position_idx" ON "user_skills"("user_id", "position");
