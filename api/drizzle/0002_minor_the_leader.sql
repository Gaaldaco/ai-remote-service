-- Console sessions table
CREATE TABLE IF NOT EXISTS "console_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "summary" text,
  "token_estimate" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_active_at" timestamp DEFAULT now() NOT NULL
);

-- Add session_id and token_estimate to console_messages
ALTER TABLE "console_messages"
  ADD COLUMN IF NOT EXISTS "session_id" uuid REFERENCES "console_sessions"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "token_estimate" integer DEFAULT 0;
