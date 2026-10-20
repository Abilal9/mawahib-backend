-- Phase B: optional canonical skill link on profile skills.
-- skill text and position stay. Custom rows keep skill_id null.
-- Does not change services, jobs, or the taxonomy catalog.

ALTER TABLE "user_skills" ADD COLUMN "skill_id" UUID;

CREATE INDEX "user_skills_skill_id_idx" ON "user_skills"("skill_id");

-- NULLs are distinct, so many custom rows are allowed for one user.
CREATE UNIQUE INDEX "user_skills_user_id_skill_id_key" ON "user_skills"("user_id", "skill_id");

ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
