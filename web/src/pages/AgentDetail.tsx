import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Snapshot, type MonitoredService } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import HealthScore from '@/components/HealthScore';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Cpu, HardDrive, MemoryStick, Activity, Pin, PinOff,
  Terminal, Shield, Clock, AlertTriangle, ArrowLeft, Trash2, Play, BookPlus, Loader2,
} from 'lucide-react';
import clsx from 'clsx';

type Tab = 'overview' | 'services' | 'alerts' | 'snapshots' | 'remediation';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [cmdInput, setCmdInput] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [uninstallStatus, setUninstallStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [uninstallOutput, setUninstallOutput] = useState<string | null>(null);
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

  const deleteMutation = useMutation({
    mutationFn: () => api.agents.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/');
    },
  });

  if (!agent) return <div className="p-6 text-gray-400">Loading...</div>;

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

  const unresolvedAlerts = agentAlerts?.filter((a) => !a.alert.resolved).length ?? 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'services', label: 'Services' },
    { key: 'alerts', label: `Alerts${unresolvedAlerts > 0 ? ` (${unresolvedAlerts})` : ''}` },
    { key: 'snapshots', label: 'Snapshots' },
    { key: 'remediation', label: 'Remediation' },
  ];

  const uninstallCmd = `systemctl stop ai-remote-agent && systemctl disable ai-remote-agent && rm -f /usr/local/bin/ai-remote-agent /etc/systemd/system/ai-remote-agent.service && rm -rf /etc/ai-remote-agent && systemctl daemon-reload`;

  return (
    <div className="p-6">
      {/* Breadcrumb + Header */}
      <div className="mb-6">
        <Link to="/" className="text-gray-500 text-xs hover:text-gray-300 no-underline flex items-center gap-1 mb-3">
          <ArrowLeft className="w-3 h-3" />
          Back to Devices
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <p className="text-gray-500 text-sm mt-1">
              {agent.hostname} &middot; {agent.os} {agent.arch}
              {agent.lastSeen && (
                <span> &middot; Last seen {getTimeAgo(new Date(agent.lastSeen))}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/agents/${id}/console`}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 flex items-center gap-1.5 no-underline"
            >
              <Terminal className="w-4 h-4" />
              Console
            </Link>
            <button
              onClick={() => toggleAutoRemediate.mutate()}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                agent.autoRemediate
                  ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              )}
            >
              <Shield className="w-4 h-4" />
              Auto-Fix {agent.autoRemediate ? 'On' : 'Off'}
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className="p-1.5 text-gray-500 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors"
              title="Delete device"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      {latestSnapshot && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard
            icon={<Activity className="w-4 h-4 text-blue-400" />}
            label="Health"
            value={<HealthScore score={latestSnapshot.healthScore} size="sm" />}
          />
          <StatCard
            icon={<Cpu className="w-4 h-4 text-purple-400" />}
            label="CPU"
            value={`${((latestSnapshot.cpu as any)?.usagePercent ?? 0).toFixed(1)}%`}
          />
          <StatCard
            icon={<MemoryStick className="w-4 h-4 text-cyan-400" />}
            label="Memory"
            value={`${((latestSnapshot.memory as any)?.usagePercent ?? 0).toFixed(1)}%`}
          />
          <StatCard
            icon={<HardDrive className="w-4 h-4 text-orange-400" />}
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
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.key
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && chartData.length > 0 && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <h3 className="text-white text-sm font-semibold mb-4">CPU & Memory Trend</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: '#fff' }}
                />
                <Line type="monotone" dataKey="cpu" stroke="#a78bfa" name="CPU %" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="mem" stroke="#22d3ee" name="Memory %" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {latestSnapshot?.aiAnalysis && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
              <h3 className="text-white text-sm font-semibold mb-3">Analysis</h3>
              <p className="text-gray-400 text-sm mb-3">{(latestSnapshot.aiAnalysis as any).summary}</p>
              {(latestSnapshot.aiAnalysis as any).issues?.length > 0 && (
                <div className="space-y-2">
                  {(latestSnapshot.aiAnalysis as any).issues.map((issue: any, i: number) => (
                    <div
                      key={i}
                      className={clsx(
                        'p-3 rounded-md border text-sm',
                        issue.severity === 'critical' && 'bg-red-500/5 border-red-500/20 text-red-300',
                        issue.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20 text-yellow-300',
                        issue.severity === 'info' && 'bg-blue-500/5 border-blue-500/20 text-blue-300'
                      )}
                    >
                      <span className="font-medium text-xs uppercase">[{issue.category}]</span>{' '}
                      {issue.description}
                      {issue.suggestedCommand ? (
                        <RunCommandButton
                          agentId={id!}
                          command={issue.suggestedCommand}
                          issueCategory={issue.category}
                          issueDescription={issue.description}
                        />
                      ) : issue.severity === 'critical' && (
                        <div className="mt-1.5">
                          <Link
                            to={`/agents/${id}/console?autopilot=true&issue=${encodeURIComponent(issue.description)}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 no-underline"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            Start Live Troubleshooting
                          </Link>
                        </div>
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
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Service</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Enabled</th>
                <th className="text-left px-4 py-3">Monitored</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(allServices ?? []).map((svc) => {
                const mon = monitored?.find((m) => m.serviceName === svc.name);
                return (
                  <tr key={svc.name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-white font-mono text-xs">{svc.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx(
                        'px-2 py-0.5 rounded text-xs',
                        svc.status === 'running' && 'bg-emerald-500/10 text-emerald-400',
                        svc.status === 'stopped' && 'bg-gray-500/10 text-gray-400',
                        svc.status === 'failed' && 'bg-red-500/10 text-red-400',
                      )}>
                        {svc.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{svc.enabled ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-2.5">
                      {mon ? (
                        <Pin className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="text-gray-700">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
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
                          <Pin className="w-3 h-3" /> Monitor
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(!allServices || allServices.length === 0) && (
            <p className="text-gray-500 text-center py-8 text-sm">No services detected</p>
          )}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="space-y-2">
          {(agentAlerts ?? []).map(({ alert }) => {
            const suggestedCmd = (alert.details as any)?.suggestedCommand;
            return (
              <div
                key={alert.id}
                className={clsx(
                  'p-3 rounded-md border text-sm',
                  alert.resolved && 'opacity-40',
                  alert.severity === 'critical' && 'bg-red-500/5 border-red-500/20',
                  alert.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20',
                  alert.severity === 'info' && 'bg-blue-500/5 border-blue-500/20',
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={clsx(
                        'w-3.5 h-3.5',
                        alert.severity === 'critical' && 'text-red-400',
                        alert.severity === 'warning' && 'text-yellow-400',
                        alert.severity === 'info' && 'text-blue-400',
                      )} />
                      <span className="text-white font-medium text-xs">{alert.type.replace(/_/g, ' ')}</span>
                      <span className="text-gray-600 text-xs">{new Date(alert.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-gray-300 text-sm">{alert.message}</p>
                  </div>
                  {!alert.resolved && (
                    <button
                      onClick={() => api.alerts.resolve(alert.id).then(() => queryClient.invalidateQueries({ queryKey: ['alerts', id] }))}
                      className="text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded hover:bg-gray-700 shrink-0"
                    >
                      Resolve
                    </button>
                  )}
                </div>
                {suggestedCmd && !alert.resolved && (
                  <RunCommandButton
                    agentId={id!}
                    command={suggestedCmd}
                    alertId={alert.id}
                    issueCategory={alert.type}
                    issueDescription={alert.message}
                    onDone={() => queryClient.invalidateQueries({ queryKey: ['alerts', id] })}
                  />
                )}
              </div>
            );
          })}
          {(!agentAlerts || agentAlerts.length === 0) && (
            <p className="text-gray-500 text-center py-10 text-sm">No alerts</p>
          )}
        </div>
      )}

      {tab === 'snapshots' && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Timestamp</th>
                <th className="text-left px-4 py-3">Health</th>
                <th className="text-left px-4 py-3">CPU</th>
                <th className="text-left px-4 py-3">Memory</th>
                <th className="text-left px-4 py-3">Disk</th>
                <th className="text-left px-4 py-3">Processes</th>
              </tr>
            </thead>
            <tbody>
              {(snapshots ?? []).map((snap) => (
                <tr key={snap.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-300 text-xs">{new Date(snap.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-2.5"><HealthScore score={snap.healthScore} /></td>
                  <td className="px-4 py-2.5 text-gray-300 text-xs">{((snap.cpu as any)?.usagePercent ?? 0).toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-gray-300 text-xs">{((snap.memory as any)?.usagePercent ?? 0).toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-gray-300 text-xs">{((snap.disk as any)?.[0]?.usagePercent ?? 0).toFixed(0)}%</td>
                  <td className="px-4 py-2.5 text-gray-300 text-xs">{(snap.processes as any[])?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'remediation' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex gap-2">
              <input
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                placeholder="Run a command on this device..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 font-mono"
                onKeyDown={(e) => e.key === 'Enter' && cmdInput && runCommand.mutate(cmdInput)}
              />
              <button
                onClick={() => cmdInput && runCommand.mutate(cmdInput)}
                disabled={!cmdInput || runCommand.isPending}
                className="bg-emerald-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
              >
                Execute
              </button>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Command</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {(remLog ?? []).map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-800/50">
                    <td className="px-4 py-2.5">
                      <code className="text-emerald-400 text-xs">{entry.command}</code>
                      {entry.result && (
                        <pre className="bg-gray-800 p-2 rounded text-xs text-gray-400 mt-1.5 overflow-auto max-h-24">
                          {entry.result}
                        </pre>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx(
                        'px-2 py-0.5 rounded text-xs',
                        entry.success === true && 'bg-emerald-500/10 text-emerald-400',
                        entry.success === false && 'bg-red-500/10 text-red-400',
                        entry.success === null && 'bg-yellow-500/10 text-yellow-400',
                      )}>
                        {entry.success === true ? 'Success' : entry.success === false ? 'Failed' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {new Date(entry.executedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!remLog || remLog.length === 0) && (
              <p className="text-gray-500 text-center py-8 text-sm">No commands executed yet</p>
            )}
          </div>
        </div>
      )}

      {/* Delete / Uninstall modal */}
      {showDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowDelete(false); setUninstallStatus('idle'); setUninstallOutput(null); }}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold text-lg mb-4">Remove Device</h3>

            {/* Step 1: Uninstall agent from machine */}
            <div className="bg-gray-800 rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-white text-sm font-medium">1. Uninstall Agent</h4>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Remotely stops, disables, and removes the agent from <span className="text-gray-300">{agent.hostname}</span>
                  </p>
                </div>
              </div>

              {uninstallStatus === 'idle' && (
                <button
                  onClick={async () => {
                    setUninstallStatus('running');
                    setUninstallOutput(null);
                    try {
                      const { id: remId } = await api.console.execute(agent.id, uninstallCmd);
                      // Poll for result
                      const poll = async () => {
                        for (let i = 0; i < 30; i++) {
                          await new Promise((r) => setTimeout(r, 2000));
                          const res = await api.console.result(agent.id, remId);
                          if (res.status === 'complete') {
                            setUninstallOutput(res.output ?? 'No output');
                            setUninstallStatus(res.success ? 'success' : 'failed');
                            return;
                          }
                        }
                        setUninstallStatus('failed');
                        setUninstallOutput('Timed out waiting for agent response');
                      };
                      poll();
                    } catch {
                      setUninstallStatus('failed');
                      setUninstallOutput('Failed to send command — agent may be offline');
                    }
                  }}
                  className="w-full px-3 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Uninstall Agent from Machine
                </button>
              )}

              {uninstallStatus === 'running' && (
                <div className="flex items-center gap-2 text-yellow-400 text-sm py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uninstalling agent...
                </div>
              )}

              {uninstallStatus === 'success' && (
                <div className="text-sm">
                  <p className="text-emerald-400 font-medium mb-1">Agent uninstalled successfully</p>
                  {uninstallOutput && (
                    <pre className="text-gray-500 text-xs bg-gray-900 rounded p-2 max-h-20 overflow-auto">{uninstallOutput}</pre>
                  )}
                </div>
              )}

              {uninstallStatus === 'failed' && (
                <div className="text-sm">
                  <p className="text-red-400 font-medium mb-1">Uninstall failed or agent offline</p>
                  {uninstallOutput && (
                    <pre className="text-gray-500 text-xs bg-gray-900 rounded p-2 max-h-20 overflow-auto">{uninstallOutput}</pre>
                  )}
                  <p className="text-gray-500 text-xs mt-2">
                    You can manually uninstall by running on the machine:
                  </p>
                  <code className="text-red-300 text-[11px] break-all leading-relaxed block mt-1">{uninstallCmd}</code>
                </div>
              )}
            </div>

            {/* Step 2: Delete from dashboard */}
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h4 className="text-white text-sm font-medium mb-1">2. Delete from Dashboard</h4>
              <p className="text-gray-500 text-xs mb-3">
                Removes <span className="text-gray-300">{agent.name}</span> and all its data (snapshots, alerts, history) from the dashboard. This cannot be undone.
              </p>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="w-full px-3 py-2 bg-red-500 text-white text-sm font-medium rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Device from Dashboard'}
              </button>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => { setShowDelete(false); setUninstallStatus('idle'); setUninstallOutput(null); }}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-gray-500 text-xs">{label}</span>
      </div>
      <div className="text-white text-lg font-semibold">{value}</div>
    </div>
  );
}

function RunCommandButton({
  agentId,
  command,
  alertId,
  issueCategory,
  issueDescription,
  onDone,
}: {
  agentId: string;
  command: string;
  alertId?: string;
  issueCategory?: string;
  issueDescription?: string;
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'pending' | 'polling' | 'success' | 'failed'>('idle');
  const [result, setResult] = useState<string | null>(null);
  const [showKB, setShowKB] = useState(false);
  const queryClient = useQueryClient();

  const run = async () => {
    setStatus('pending');
    try {
      const entry = await api.remediation.manual(agentId, command, alertId);
      setStatus('polling');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const res = await api.console.result(agentId, entry.id);
          if (res.success !== undefined && res.success !== null) {
            clearInterval(poll);
            setStatus(res.success ? 'success' : 'failed');
            setResult(res.output ?? null);
            queryClient.invalidateQueries({ queryKey: ['remediation', agentId] });
            queryClient.invalidateQueries({ queryKey: ['alerts', agentId] });
            onDone?.();
          }
        } catch { /* keep polling */ }
        if (attempts > 60) {
          clearInterval(poll);
          setStatus('failed');
          setResult('Timed out waiting for result');
        }
      }, 2000);
    } catch (err: any) {
      setStatus('failed');
      setResult(err.message);
    }
  };

  const startTroubleshooting = () => {
    const params = new URLSearchParams({
      autopilot: 'true',
      alertId: alertId ?? '',
      issue: issueDescription ?? '',
      failedCmd: command,
      failedOutput: result ?? 'Command failed',
    });
    navigate(`/agents/${agentId}/console?${params}`);
  };

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-800 p-2 rounded font-mono text-gray-300">{command}</code>
        {status === 'idle' && (
          <button
            onClick={run}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
          >
            <Play className="w-3 h-3" /> Run
          </button>
        )}
        {(status === 'pending' || status === 'polling') && (
          <span className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs text-yellow-400">
            <Loader2 className="w-3 h-3 animate-spin" /> {status === 'pending' ? 'Sending...' : 'Waiting...'}
          </span>
        )}
        {status === 'success' && (
          <div className="shrink-0 flex items-center gap-1">
            <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400">Success</span>
            <button
              onClick={() => setShowKB(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
              title="Save to Knowledge Base"
            >
              <BookPlus className="w-3 h-3" /> Save to KB
            </button>
          </div>
        )}
        {status === 'failed' && (
          <div className="shrink-0 flex items-center gap-1">
            <span className="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-400">Failed</span>
            <button onClick={() => { setStatus('idle'); setResult(null); }} className="text-xs text-gray-500 hover:text-white">Retry</button>
          </div>
        )}
      </div>
      {result && (
        <pre className="mt-1.5 bg-gray-800 p-2 rounded text-xs text-gray-400 overflow-auto max-h-32">{result}</pre>
      )}
      {status === 'failed' && (
        <div className="mt-2 bg-blue-500/5 border border-blue-500/20 rounded-md p-3">
          <p className="text-blue-300 text-xs mb-2">This will need a live session to troubleshoot. Want to start live troubleshooting?</p>
          <button
            onClick={startTroubleshooting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
          >
            <Terminal className="w-3.5 h-3.5" />
            Start Live Troubleshooting
          </button>
        </div>
      )}
      {showKB && (
        <SaveToKBModal
          command={command}
          category={issueCategory ?? 'custom'}
          description={issueDescription ?? ''}
          onClose={() => setShowKB(false)}
        />
      )}
    </div>
  );
}

function SaveToKBModal({
  command,
  category,
  description,
  onClose,
}: {
  command: string;
  category: string;
  description: string;
  onClose: () => void;
}) {
  const [pattern, setPattern] = useState(description);
  const [solution, setSolution] = useState(command);
  const [platform, setPlatform] = useState('linux');
  const [autoApply, setAutoApply] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const save = async () => {
    setSaving(true);
    await api.knowledgeBase.create({
      issuePattern: pattern,
      issueCategory: category,
      platform,
      solution,
      description: `Auto-saved from successful remediation`,
      autoApply,
    });
    queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white font-semibold text-lg mb-4">Save to Knowledge Base</h3>
        <div className="space-y-3">
          <div>
            <label className="text-gray-400 text-xs block mb-1">Issue Pattern (what to match)</label>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">Solution Command</label>
            <input value={solution} onChange={(e) => setSolution(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white font-mono" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-gray-400 text-xs block mb-1">Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white">
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
                <option value="macos">macOS</option>
              </select>
            </div>
            <div className="flex-1 flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} className="rounded" />
                Auto-apply in future
              </label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !pattern || !solution} className="px-4 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save to KB'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
