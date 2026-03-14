import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  uuid,
  jsonb,
  real,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const agentStatusEnum = pgEnum("agent_status", [
  "online",
  "offline",
  "degraded",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const alertTypeEnum = pgEnum("alert_type", [
  "service_down",
  "high_cpu",
  "high_memory",
  "high_disk",
  "security_issue",
  "update_available",
  "agent_offline",
  "auth_failure",
  "custom",
]);

// ─── Agents ──────────────────────────────────────────────────────────────────

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  hostname: text("hostname").notNull(),
  os: text("os").notNull(),
  arch: text("arch").notNull(),
  platform: text("platform").notNull().default("linux"), // linux | windows
  status: agentStatusEnum("status").notNull().default("offline"),
  lastSeen: timestamp("last_seen"),
  autoRemediate: boolean("auto_remediate").notNull().default(false),
  autoUpdate: boolean("auto_update").notNull().default(true), // auto-install pending updates
  apiKeyHash: text("api_key_hash").notNull().unique(),
  snapshotInterval: integer("snapshot_interval").notNull().default(60), // seconds
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Machine Snapshots ───────────────────────────────────────────────────────

export const machineSnapshots = pgTable("machine_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  cpu: jsonb("cpu"), // { usagePercent, cores, loadAvg }
  memory: jsonb("memory"), // { totalMB, usedMB, usagePercent }
  disk: jsonb("disk"), // [{ mountpoint, totalGB, usedGB, usagePercent }]
  network: jsonb("network"), // [{ interface, bytesSent, bytesRecv }]
  processes: jsonb("processes"), // [{ pid, name, cpu, mem, user }] top 50
  openPorts: jsonb("open_ports"), // [{ port, protocol, process, address }]
  users: jsonb("users"), // [{ username, terminal, loginTime }]
  authLogs: jsonb("auth_logs"), // [{ timestamp, type, user, source, success }]
  pendingUpdates: jsonb("pending_updates"), // [{ package, currentVersion, newVersion }]
  services: jsonb("services"), // [{ name, status, enabled, cpu, mem }]
  healthScore: integer("health_score"), // 0-100, filled by AI
  aiAnalysis: jsonb("ai_analysis"), // filled by AI worker
});

// ─── Monitored Services ─────────────────────────────────────────────────────

export const monitoredServices = pgTable("monitored_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  serviceName: text("service_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  alertOnDown: boolean("alert_on_down").notNull().default(true),
  alertOnHighCpu: boolean("alert_on_high_cpu").notNull().default(false),
  cpuThreshold: real("cpu_threshold").default(90), // percent
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Alerts ──────────────────────────────────────────────────────────────────

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").references(() => machineSnapshots.id),
  type: alertTypeEnum("type").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"), // "auto" | "user" | agent name
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Knowledge Base ──────────────────────────────────────────────────────────

export const knowledgeBase = pgTable("knowledge_base", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }), // null = global
  scope: text("scope").notNull().default("device"), // "device" = specific machine, "global" = applies to all
  issuePattern: text("issue_pattern").notNull(),
  issueCategory: text("issue_category").notNull(),
  platform: text("platform").notNull().default("linux"), // linux | windows | all
  solution: text("solution").notNull(), // summary of fix approach OR static command
  solutionSteps: jsonb("solution_steps"), // diagnostic path: [{type, command, reason, output?}]
  description: text("description"), // human-readable explanation
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  autoApply: boolean("auto_apply").notNull().default(false),
  createdFromAlertId: uuid("created_from_alert_id").references(() => alerts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Remediation Log ─────────────────────────────────────────────────────────

export const remediationLog = pgTable("remediation_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  alertId: uuid("alert_id").references(() => alerts.id),
  kbEntryId: uuid("kb_entry_id").references(() => knowledgeBase.id),
  command: text("command").notNull(),
  result: text("result"),
  success: boolean("success"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
});

// ─── Console Sessions ───────────────────────────────────────────────────────

export const consoleSessions = pgTable("console_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  summary: text("summary"), // compressed context from older messages
  tokenEstimate: integer("token_estimate").notNull().default(0), // running token count
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
});

// ─── Console Messages ───────────────────────────────────────────────────────

export const consoleRoleEnum = pgEnum("console_role", [
  "user",
  "assistant",
  "command",
  "output",
]);

export const consoleMessages = pgTable("console_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .references(() => consoleSessions.id, { onDelete: "cascade" }),
  role: consoleRoleEnum("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  tokenEstimate: integer("token_estimate").default(0), // estimated tokens for this message
  remediationId: uuid("remediation_id").references(() => remediationLog.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Audit Log ───────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  action: text("action").notNull(),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
