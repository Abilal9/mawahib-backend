-- Push intent committed with the message, and a rotatable detach secret per registration.

ALTER TABLE "push_devices"
  ADD COLUMN "registration_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "detach_secret_hash" TEXT;

CREATE TYPE "PushOutboxStatus" AS ENUM ('pending', 'done', 'skipped');

CREATE TABLE "push_outbox" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sender_id" UUID NOT NULL,
  "message_created_at" TIMESTAMP(3) NOT NULL,
  "status" "PushOutboxStatus" NOT NULL DEFAULT 'pending',
  "claim_token" UUID,
  "claimed_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "last_error" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_outbox_message_id_key" ON "push_outbox"("message_id");
CREATE INDEX "push_outbox_status_next_attempt_at_idx" ON "push_outbox"("status", "next_attempt_at");

ALTER TABLE "push_outbox"
  ADD CONSTRAINT "push_outbox_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_outbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "push_outbox" FROM anon, authenticated;
