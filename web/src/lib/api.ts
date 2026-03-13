const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Agents
export const api = {
  agents: {
    list: () => request<Agent[]>('/api/agents'),
    get: (id: string) => request<Agent>(`/api/agents/${id}`),
    update: (id: string, data: Partial<Agent>) =>
      request<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  },
  snapshots: {
    listByAgent: (agentId: string, limit = 20) =>
      request<Snapshot[]>(`/api/snapshots/agent/${agentId}?limit=${limit}`),
    get: (id: string) => request<Snapshot>(`/api/snapshots/${id}`),
  },
  alerts: {
    list: (params?: { agentId?: string; severity?: string; resolved?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.agentId) qs.set('agentId', params.agentId);
      if (params?.severity) qs.set('severity', params.severity);
      if (params?.resolved) qs.set('resolved', params.resolved);
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<AlertWithAgent[]>(`/api/alerts?${qs}`);
    },
    summary: () => request<AlertSummary>('/api/alerts/summary'),
    resolve: (id: string) =>
      request<Alert>(`/api/alerts/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'user' }) }),
  },
  services: {
    allForAgent: (agentId: string) =>
      request<ServiceSnapshot[]>(`/api/services/${agentId}/all`),
    monitored: (agentId: string) =>
      request<MonitoredService[]>(`/api/services/${agentId}/monitored`),
    monitor: (agentId: string, serviceName: string) =>
      request<MonitoredService>(`/api/services/${agentId}/monitor`, {
        method: 'POST', body: JSON.stringify({ serviceName }),
      }),
    unmonitor: (agentId: string, serviceId: string) =>
      request<{ deleted: boolean }>(`/api/services/${agentId}/monitor/${serviceId}`, { method: 'DELETE' }),
  },
  knowledgeBase: {
    list: () => request<KBEntry[]>('/api/knowledge-base'),
    create: (data: Partial<KBEntry>) =>
      request<KBEntry>('/api/knowledge-base', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<KBEntry>) =>
      request<KBEntry>(`/api/knowledge-base/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/knowledge-base/${id}`, { method: 'DELETE' }),
  },
  remediation: {
    log: (params?: { agentId?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.agentId) qs.set('agentId', params.agentId);
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<RemediationEntry[]>(`/api/remediation/log?${qs}`);
    },
    manual: (agentId: string, command: string, alertId?: string) =>
      request<RemediationEntry>('/api/remediation/manual', {
        method: 'POST', body: JSON.stringify({ agentId, command, alertId }),
      }),
  },
};

// Types
export interface Agent {
  id: string;
  name: string;
  hostname: string;
  os: string;
  arch: string;
  platform: string;
  status: 'online' | 'offline' | 'degraded';
  lastSeen: string | null;
  autoRemediate: boolean;
  snapshotInterval: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Snapshot {
  id: string;
  agentId: string;
  timestamp: string;
  cpu: { usagePercent: number; cores: number; loadAvg?: number[] };
  memory: { totalMB: number; usedMB: number; usagePercent: number };
  disk: { mountpoint: string; totalGB: number; usedGB: number; usagePercent: number }[];
  network: { interface: string; bytesSent: number; bytesRecv: number }[];
  processes: { pid: number; name: string; cpu: number; mem: number; user: string }[];
  openPorts: { port: number; protocol: string; process?: string; address: string }[];
  users: { username: string; terminal?: string; loginTime?: string }[];
  authLogs: { timestamp: string; type: string; user?: string; source?: string; success: boolean }[];
  pendingUpdates: { package: string; currentVersion?: string; newVersion?: string }[];
  services: ServiceSnapshot[];
  healthScore: number | null;
  aiAnalysis: AIAnalysis | null;
}

export interface ServiceSnapshot {
  name: string;
  status: string;
  enabled?: boolean;
  cpu?: number;
  mem?: number;
}

export interface AIAnalysis {
  healthScore: number;
  summary: string;
  issues: {
    category: string;
    severity: string;
    description: string;
    suggestedCommand: string | null;
    matchesKnownPattern: string | null;
  }[];
}

export interface Alert {
  id: string;
  agentId: string;
  snapshotId: string | null;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface AlertWithAgent {
  alert: Alert;
  agentName: string | null;
  agentHostname: string | null;
}

export interface AlertSummary {
  bySeverity: { severity: string; total: number; unresolved: number }[];
  totalUnresolved: number;
}

export interface MonitoredService {
  id: string;
  agentId: string;
  serviceName: string;
  enabled: boolean;
  alertOnDown: boolean;
  alertOnHighCpu: boolean;
  cpuThreshold: number;
  createdAt: string;
}

export interface KBEntry {
  id: string;
  issuePattern: string;
  issueCategory: string;
  platform: string;
  solution: string;
  description: string | null;
  successCount: number;
  failureCount: number;
  autoApply: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RemediationEntry {
  id: string;
  agentId: string;
  alertId: string | null;
  kbEntryId: string | null;
  command: string;
  result: string | null;
  success: boolean | null;
  executedAt: string;
}
