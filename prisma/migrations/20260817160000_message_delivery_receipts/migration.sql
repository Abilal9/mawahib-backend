-- Phase 4: delivery watermark for Sent → Delivered → Read receipts
ALTER TABLE "conversation_participants" ADD COLUMN "last_delivered_at" TIMESTAMP(3);
