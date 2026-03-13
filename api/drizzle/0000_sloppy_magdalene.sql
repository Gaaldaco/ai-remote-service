CREATE TYPE "public"."agent_status" AS ENUM('online', 'offline', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('service_down', 'high_cpu', 'high_memory', 'high_disk', 'security_issue', 'update_available', 'agent_offline', 'auth_failure', 'custom');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hostname" text NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"platform" text DEFAULT 'linux' NOT NULL,
	"status" "agent_status" DEFAULT 'offline' NOT NULL,
	"last_seen" timestamp,
	"auto_remediate" boolean DEFAULT false NOT NULL,
	"api_key_hash" text NOT NULL,
	"snapshot_interval" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"action" text NOT NULL,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_pattern" text NOT NULL,
	"issue_category" text NOT NULL,
	"platform" text DEFAULT 'linux' NOT NULL,
	"solution" text NOT NULL,
	"description" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"created_from_alert_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"cpu" jsonb,
	"memory" jsonb,
	"disk" jsonb,
	"network" jsonb,
	"processes" jsonb,
	"open_ports" jsonb,
	"users" jsonb,
	"auth_logs" jsonb,
	"pending_updates" jsonb,
	"services" jsonb,
	"health_score" integer,
	"ai_analysis" jsonb
);
--> statement-breakpoint
CREATE TABLE "monitored_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"alert_on_down" boolean DEFAULT true NOT NULL,
	"alert_on_high_cpu" boolean DEFAULT false NOT NULL,
	"cpu_threshold" real DEFAULT 90,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"alert_id" uuid,
	"kb_entry_id" uuid,
	"command" text NOT NULL,
	"result" text,
	"success" boolean,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_snapshot_id_machine_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."machine_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_created_from_alert_id_alerts_id_fk" FOREIGN KEY ("created_from_alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_snapshots" ADD CONSTRAINT "machine_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_services" ADD CONSTRAINT "monitored_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_log" ADD CONSTRAINT "remediation_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_log" ADD CONSTRAINT "remediation_log_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_log" ADD CONSTRAINT "remediation_log_kb_entry_id_knowledge_base_id_fk" FOREIGN KEY ("kb_entry_id") REFERENCES "public"."knowledge_base"("id") ON DELETE no action ON UPDATE no action;