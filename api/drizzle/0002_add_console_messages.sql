CREATE TYPE "public"."console_role" AS ENUM('user', 'assistant', 'command', 'output');

CREATE TABLE IF NOT EXISTS "console_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "role" "console_role" NOT NULL,
  "content" text NOT NULL,
  "model" text,
  "remediation_id" uuid REFERENCES "remediation_log"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
