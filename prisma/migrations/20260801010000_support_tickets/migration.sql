CREATE TYPE "SupportTicketStatus" AS ENUM ('WAITING_FOR_SUPPORT', 'WAITING_FOR_USER', 'RESOLVED');
CREATE TYPE "SupportTicketCategory" AS ENUM ('FEED', 'BONDING_GRADUATION', 'TOKEN_DATA', 'IMAGES', 'SETTINGS_UI', 'PI_BOT', 'OTHER');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportMessageAuthor" AS ENUM ('USER', 'SUPPORT', 'SYSTEM');
CREATE TYPE "SupportMessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

CREATE TABLE "support_clients" (
  "id" TEXT NOT NULL,
  "public_id" TEXT NOT NULL,
  "session_token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_clients_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "ticket_number" BIGSERIAL NOT NULL,
  "client_id" TEXT NOT NULL,
  "category" "SupportTicketCategory" NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'WAITING_FOR_SUPPORT',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "summary" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "user_last_read_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "support_messages" (
  "id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "author" "SupportMessageAuthor" NOT NULL,
  "visibility" "SupportMessageVisibility" NOT NULL DEFAULT 'PUBLIC',
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "support_attachments" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "support_diagnostic_snapshots" (
  "id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "message_id" TEXT,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "frontend" JSONB,
  "backend" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_diagnostic_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_clients_public_id_key" ON "support_clients"("public_id");
CREATE UNIQUE INDEX "support_clients_session_token_hash_key" ON "support_clients"("session_token_hash");
CREATE INDEX "support_clients_expires_at_idx" ON "support_clients"("expires_at");
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");
CREATE INDEX "support_tickets_client_id_updated_at_idx" ON "support_tickets"("client_id", "updated_at");
CREATE INDEX "support_tickets_status_updated_at_idx" ON "support_tickets"("status", "updated_at");
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");
CREATE UNIQUE INDEX "support_attachments_storage_key_key" ON "support_attachments"("storage_key");
CREATE INDEX "support_attachments_message_id_idx" ON "support_attachments"("message_id");
CREATE INDEX "support_diagnostic_snapshots_ticket_id_created_at_idx" ON "support_diagnostic_snapshots"("ticket_id", "created_at");

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "support_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_diagnostic_snapshots" ADD CONSTRAINT "support_diagnostic_snapshots_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_diagnostic_snapshots" ADD CONSTRAINT "support_diagnostic_snapshots_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
