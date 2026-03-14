ALTER TABLE "knowledge_base" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "scope" text DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;