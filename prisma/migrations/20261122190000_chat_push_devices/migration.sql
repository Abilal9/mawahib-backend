-- Chat push registrations and one delivery attempt per unread episode.
-- Tokens stay on the API. These tables are not readable through the public data API.

CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');
CREATE TYPE "PushEpisodeStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PushDeliveryState" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'RECEIPT_OK',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'UNKNOWN'
);

CREATE TABLE "push_devices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "installation_id" UUID NOT NULL,
  "expo_push_token" TEXT NOT NULL,
  "platform" "PushPlatform" NOT NULL,
  "viewing_conversation_id" UUID,
  "viewing_expires_at" TIMESTAMP(3),
  "invalidated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_devices_installation_id_key" ON "push_devices"("installation_id");
CREATE UNIQUE INDEX "push_devices_expo_push_token_key" ON "push_devices"("expo_push_token");
CREATE INDEX "push_devices_user_id_invalidated_at_idx" ON "push_devices"("user_id", "invalidated_at");

CREATE TABLE "push_episodes" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "opening_message_id" UUID NOT NULL,
  "opening_sequence" INTEGER NOT NULL,
  "status" "PushEpisodeStatus" NOT NULL DEFAULT 'OPEN',
  "open_key" TEXT,
  "closed_at" TIMESTAMP(3),
  "close_reason" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_episodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_episodes_open_key_key" ON "push_episodes"("open_key");
CREATE INDEX "push_episodes_recipient_user_id_conversation_id_status_idx"
  ON "push_episodes"("recipient_user_id", "conversation_id", "status");

CREATE TABLE "push_deliveries" (
  "id" UUID NOT NULL,
  "episode_id" UUID NOT NULL,
  "state" "PushDeliveryState" NOT NULL DEFAULT 'PENDING',
  "claim_token" UUID,
  "claimed_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "ticket_id" TEXT,
  "receipt_check_at" TIMESTAMP(3),
  "last_error" VARCHAR(80),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_deliveries_episode_id_key" ON "push_deliveries"("episode_id");
CREATE INDEX "push_deliveries_state_next_attempt_at_idx" ON "push_deliveries"("state", "next_attempt_at");
CREATE INDEX "push_deliveries_state_receipt_check_at_idx" ON "push_deliveries"("state", "receipt_check_at");

ALTER TABLE "push_devices"
  ADD CONSTRAINT "push_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_episodes"
  ADD CONSTRAINT "push_episodes_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_episodes"
  ADD CONSTRAINT "push_episodes_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_episodes"
  ADD CONSTRAINT "push_episodes_opening_message_id_fkey"
  FOREIGN KEY ("opening_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_deliveries"
  ADD CONSTRAINT "push_deliveries_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "push_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_episodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "push_devices" FROM anon, authenticated;
REVOKE ALL ON TABLE "push_episodes" FROM anon, authenticated;
REVOKE ALL ON TABLE "push_deliveries" FROM anon, authenticated;
