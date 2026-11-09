-- Authoritative per-conversation message order for read markers.
-- Historical ties use created_at, then id, only to assign a stable sequence.
-- That id tie-break is not insertion order.

LOCK TABLE messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE conversations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE conversation_participants IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "conversations"
  ADD COLUMN "last_message_sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "messages"
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "conversation_participants"
  ADD COLUMN "last_read_sequence" INTEGER;

UPDATE "messages" AS m
SET "sequence" = ranked.rn
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM "messages"
) AS ranked
WHERE m.id = ranked.id;

UPDATE "conversations" AS c
SET "last_message_sequence" = COALESCE(
  (SELECT MAX(sequence) FROM "messages" WHERE conversation_id = c.id),
  0
);

-- Preserve the previous rule: a message was read when created_at <= last_read_at.
UPDATE "conversation_participants" AS cp
SET "last_read_sequence" = (
  SELECT MAX(m.sequence)
  FROM "messages" AS m
  WHERE m.conversation_id = cp.conversation_id
    AND m.created_at <= cp.last_read_at
)
WHERE cp.last_read_at IS NOT NULL;

CREATE UNIQUE INDEX "messages_conversation_id_sequence_key"
  ON "messages"("conversation_id", "sequence");

CREATE FUNCTION messages_assign_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE conversations
     SET last_message_sequence = last_message_sequence + 1
   WHERE id = NEW.conversation_id
   RETURNING last_message_sequence INTO NEW.sequence;
  IF NEW.sequence IS NULL THEN
    RAISE EXCEPTION 'conversation % not found', NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_assign_sequence
  BEFORE INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_assign_sequence();
