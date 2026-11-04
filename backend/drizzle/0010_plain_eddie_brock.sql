ALTER TABLE "document_messages" ADD COLUMN "sender_read_at" timestamp with time zone;

-- Los resultados anteriores a esta función se consideran ya vistos.
UPDATE "document_messages"
SET "sender_read_at" = COALESCE("approved_at", "updated_at")
WHERE "status" IN ('sent', 'rejected');
