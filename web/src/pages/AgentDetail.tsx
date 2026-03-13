import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Snapshot, type MonitoredService } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import HealthScore from '@/components/HealthScore';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Cpu, HardDrive, MemoryStick, Activity, Pin, PinOff,
  Terminal, Shield, Clock, AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';

type Tab = 'overview' | 'services' | 'alerts' | 'snapshots' | 'remediation';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [cmdInput, setCmdInput] = useState('');
  const queryClient = useQueryClient();

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
  });
  const { data: snapshots } = useQuery({
    queryKey: ['snapshots', id],
    queryFn: () => api.snapshots.listByAgent(id!, 50),
    enabled: !!id,
  });
  const { data: allServices } = useQuery({
    queryKey: ['services', id],
    queryFn: () => api.services.allForAgent(id!),
    enabled: !!id,
  });
  const { data: monitored } = useQuery({
    queryKey: ['monitored', id],
    queryFn: () => api.services.monitored(id!),
    enabled: !!id,
  });
  const { data: agentAlerts } = useQuery({
    queryKey: ['alerts', id],
    queryFn: () => api.alerts.list({ agentId: id, limit: 50 }),
    enabled: !!id,
  });
  const { data: remLog } = useQuery({
    queryKey: ['remediation', id],
    queryFn: () => api.remediation.log({ agentId: id, limit: 50 }),
    enabled: !!id,
  });

  const pinMutation = useMutation({
    mutationFn: (serviceName: string) => api.services.monitor(id!, serviceName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitored', id] }),
  });

  const unpinMutation = useMutation({
    mutationFn: (serviceId: string) => api.services.unmonitor(id!, serviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitored', id] }),
  });

  const toggleAutoRemediate = useMutation({
    mutationFn: () => api.agents.update(id!, { autoRemediate: !agent?.autoRemediate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const runCommand = useMutation({
    mutationFn: (command: string) => api.remediation.manual(id!, command),
    onSuccess: () => {
      setCmdInput('');
      queryClient.invalidateQueries({ queryKey: ['remediation', id] });
    },
  });

  if (!agent) return <div className="text-gray-400">Loading...</div>;

  const latestSnapshot = snapshots?.[0];
  const chartData = (snapshots ?? [])
    .slice()
    .reverse()
    .map((s) => ({
      time: new Date(s.timestamp).toLocaleTimeString(),
      cpu: (s.cpu as any)?.usagePercent ?? 0,
      mem: (s.memory as any)?.usagePercent ?? 0,
      health: s.healthScore ?? 0,
    }));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'services', label: 'Services' },
    { key: 'alerts', label: `Alerts (${agentAlerts?.filter((a) => !a.alert.resolved).length ?? 0})` },
    { key: 'snapshots', label: 'Snapshots' },
    { key: 'remediation', label: 'Remediation' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {agent.hostname} &middot; {agent.os} &middot; {agent.arch}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleAutoRemediate.mutate()}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              agent.autoRemediate
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            )}
          >
            <Shield className="w-4 h-4 inline mr-1" />
            Auto-Remediate: {agent.autoRemediate ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Quick stats */}
      {latestSnapshot && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={<Activity className="w-5 h-5 text-blue-400" />}
            label="Health"
            value={<HealthScore score={latestSnapshot.healthScore} size="sm" />}
          />
          <StatCard
            icon={<Cpu className="w-5 h-5 text-purple-400" />}
            label="CPU"
            value={`${((latestSnapshot.cpu as any)?.usagePercent ?? 0).toFixed(1)}%`}
          />
          <StatCard
            icon={<MemoryStick className="w-5 h-5 text-cyan-400" />}
            label="Memory"
            value={`${((latestSnapshot.memory as any)?.usagePercent ?? 0).toFixed(1)}%`}
          />
          <StatCard
            icon={<HardDrive className="w-5 h-5 text-orange-400" />}
            label="Disk"
            value={`${((latestSnapshot.disk as any)?.[0]?.usagePercent ?? 0).toFixed(0)}%`}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.key
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && chartData.length > 0 && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">CPU & Memory Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#fff' }}
                />
                <Line type="monotone" dataKey="cpu" stroke="#a78bfa" name="CPU %" dot={false} />
                <Line type="monotone" dataKey="mem" stroke="#22d3ee" name="Memory %" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {latestSnapshot?.aiAnalysis && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-3">AI Analysis</h3>
              <p className="text-gray-300 text-sm mb-4">{(latestSnapshot.aiAnalysis as any).summary}</p>
              {(latestSnapshot.aiAnalysis as any).issues?.length > 0 && (
                <div className="space-y-2">
                  {(latestSnapshot.aiAnalysis as any).issues.map((issue: any, i: number) => (
                    <div
                      key={i}
                      className={clsx(
                        'p-3 rounded-lg border text-sm',
                        issue.severity === 'critical' && 'bg-red-500/5 border-red-500/20 text-red-300',
                        issue.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20 text-yellow-300',
                        issue.severity === 'info' && 'bg-blue-500/5 border-blue-500/20 text-blue-300'
                      )}
                    >
                      <span className="font-medium">[{issue.category}]</span> {issue.description}
                      {issue.suggestedCommand && (
                        <code className="block mt-1 text-xs bg-gray-800 p-2 rounded">{issue.suggestedCommand}</code>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'services' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="p-4">Service</th>
                <th className="p-4">Status</th>
                <th className="p-4">Enabled</th>
                <th className="p-4">Monitored</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(allServices ?? []).map((svc) => {
                const mon = monitored?.find((m) => m.serviceName === svc.name);
                return (
                  <tr key={svc.name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-4 text-white font-mono text-xs">{svc.name}</td>
                    <td className="p-4">
                      <span className={clsx(
                        'px-2 py-1 rounded text-xs',
                        svc.status === 'running' && 'bg-emerald-500/10 text-emerald-400',
                        svc.status === 'stopped' && 'bg-gray-500/10 text-gray-400',
                        svc.status === 'failed' && 'bg-red-500/10 text-red-400',
                      )}>
                        {svc.status}
                      </span>
                    </td>
                    <td className="p-4 text-gray-400">{svc.enabled ? 'Yes' : 'No'}</td>
                    <td className="p-4">
                      {mon ? (
                        <Pin className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      {mon ? (
                        <button
                          onClick={() => unpinMutation.mutate(mon.id)}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <PinOff className="w-3 h-3" /> Unpin
                        </button>
                      ) : (
                        <button
                          onClick={() => pinMutation.mutate(svc.name)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                        >
                          <Pin className="w-3 h-3" /> Pin
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'alerts' && (
        <div className="space-y-2">
          {(agentAlerts ?? []).map(({ alert }) => (
            <div
              key={alert.id}
              className={clsx(
                'p-4 rounded-lg border text-sm flex items-start justify-between',
                alert.resolved && 'opacity-50',
                alert.severity === 'critical' && 'bg-red-500/5 border-red-500/20',
                alert.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20',
                alert.severity === 'info' && 'bg-blue-500/5 border-blue-500/20',
              )}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className={clsx(
                    'w-4 h-4',
                    alert.severity === 'critical' && 'text-red-400',
                    alert.severity === 'warning' && 'text-yellow-400',
                    alert.severity === 'info' && 'text-blue-400',
                  )} />
                  <span className="text-white font-medium">{alert.type.replace(/_/g, ' ')}</span>
                  <span className="text-gray-500 text-xs">{new Date(alert.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-gray-300">{alert.message}</p>
              </div>
              {!alert.resolved && (
                <button
                  onClick={() => api.alerts.resolve(alert.id).then(() => queryClient.invalidateQueries({ queryKey: ['alerts', id] }))}
                  className="text-xs bg-gray-800 text-gray-300 px-3 py-1 rounded hover:bg-gray-700 shrink-0"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
          {(!agentAlerts || agentAlerts.length === 0) && (
            <p className="text-gray-500 text-center py-10">No alerts for this agent</p>
          )}
        </div>
      )}

      {tab === 'snapshots' && (
        <div className="space-y-2">
          {(snapshots ?? []).map((snap) => (
            <div key={snap.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  {new Date(snap.timestamp).toLocaleString()}
                </span>
                <HealthScore score={snap.healthScore} />
              </div>
              <div className="flex gap-6 text-xs text-gray-400">
                <span>CPU: {((snap.cpu as any)?.usagePercent ?? 0).toFixed(1)}%</span>
                <span>Mem: {((snap.memory as any)?.usagePercent ?? 0).toFixed(1)}%</span>
                <span>Processes: {(snap.processes as any[])?.length ?? 0}</span>
                <span>Services: {(snap.services as any[])?.length ?? 0}</span>
                <span>Ports: {(snap.openPorts as any[])?.length ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'remediation' && (
        <div className="space-y-4">
          {/* Manual command input */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <Terminal className="w-5 h-5 text-emerald-400" />
              Run Command
            </h3>
            <div className="flex gap-2">
              <input
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                placeholder="e.g., systemctl restart nginx"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
                onKeyDown={(e) => e.key === 'Enter' && cmdInput && runCommand.mutate(cmdInput)}
              />
              <button
                onClick={() => cmdInput && runCommand.mutate(cmdInput)}
                disabled={!cmdInput || runCommand.isPending}
                className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
              >
                Execute
              </button>
            </div>
          </div>

          {/* Log */}
          <div className="space-y-2">
            {(remLog ?? []).map((entry) => (
              <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <code className="text-emerald-400 text-xs">{entry.command}</code>
                  <span className={clsx(
                    'px-2 py-0.5 rounded text-xs',
                    entry.success === true && 'bg-emerald-500/10 text-emerald-400',
                    entry.success === false && 'bg-red-500/10 text-red-400',
                    entry.success === null && 'bg-yellow-500/10 text-yellow-400',
                  )}>
                    {entry.success === true ? 'Success' : entry.success === false ? 'Failed' : 'Pending'}
                  </span>
                </div>
                {entry.result && (
                  <pre className="bg-gray-800 p-3 rounded text-xs text-gray-300 overflow-auto max-h-40">
                    {entry.result}
                  </pre>
                )}
                <span className="text-gray-500 text-xs mt-1 block">
                  {new Date(entry.executedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-gray-400 text-xs">{label}</span>
      </div>
      <div className="text-white text-lg font-semibold">{value}</div>
    </div>
  );
}
