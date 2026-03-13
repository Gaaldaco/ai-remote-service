import { z } from "zod";

export const cpuSchema = z.object({
  usagePercent: z.number(),
  cores: z.number(),
  loadAvg: z.array(z.number()).optional(),
});

export const memorySchema = z.object({
  totalMB: z.number(),
  usedMB: z.number(),
  usagePercent: z.number(),
});

export const diskEntrySchema = z.object({
  mountpoint: z.string(),
  totalGB: z.number(),
  usedGB: z.number(),
  usagePercent: z.number(),
});

export const networkEntrySchema = z.object({
  interface: z.string(),
  bytesSent: z.number(),
  bytesRecv: z.number(),
});

export const processEntrySchema = z.object({
  pid: z.number(),
  name: z.string(),
  cpu: z.number(),
  mem: z.number(),
  user: z.string(),
});

export const openPortSchema = z.object({
  port: z.number(),
  protocol: z.string(),
  process: z.string().optional(),
  address: z.string(),
});

export const userSchema = z.object({
  username: z.string(),
  terminal: z.string().optional(),
  loginTime: z.string().optional(),
});

export const authLogSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  user: z.string().optional(),
  source: z.string().optional(),
  success: z.boolean(),
});

export const updateSchema = z.object({
  package: z.string(),
  currentVersion: z.string().optional(),
  newVersion: z.string().optional(),
});

export const serviceSchema = z.object({
  name: z.string(),
  status: z.string(), // running | stopped | failed | inactive
  enabled: z.boolean().optional(),
  cpu: z.number().optional(),
  mem: z.number().optional(),
});

export const snapshotPayloadSchema = z.object({
  hostname: z.string(),
  os: z.string(),
  arch: z.string(),
  platform: z.string().default("linux"),
  cpu: cpuSchema,
  memory: memorySchema,
  disk: z.array(diskEntrySchema),
  network: z.array(networkEntrySchema).nullable().optional(),
  processes: z.array(processEntrySchema),
  openPorts: z.array(openPortSchema).nullable().optional(),
  users: z.array(userSchema).nullable().optional(),
  authLogs: z.array(authLogSchema).nullable().optional(),
  pendingUpdates: z.array(updateSchema).nullable().optional(),
  services: z.array(serviceSchema),
});

export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

// Agent registration payload
export const registerAgentSchema = z.object({
  name: z.string().min(1).max(255),
  hostname: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  platform: z.string().default("linux"),
});

export type RegisterAgentPayload = z.infer<typeof registerAgentSchema>;

// Command that the agent polls for
export const commandSchema = z.object({
  id: z.string().uuid(),
  command: z.string(),
  timeout: z.number().default(120),
});

export const commandResultSchema = z.object({
  output: z.string(),
  exitCode: z.number(),
  success: z.boolean(),
});
