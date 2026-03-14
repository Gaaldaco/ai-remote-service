import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle, Bell, CheckCheck, Trash2, Play, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export default function Alerts() {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['alerts', filter, severityFilter],
    queryFn: () =>
      api.alerts.list({
        resolved: filter === 'all' ? undefined : filter === 'resolved' ? 'true' : 'false',
        severity: severityFilter || undefined,
        limit: 100,
      }),
  });
  const { data: summary } = useQuery({
    queryKey: ['alertSummary'],
    queryFn: api.alerts.summary,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
    queryClient.invalidateQueries({ queryKey: ['alertSummary'] });
  };

  const handleResolve = async (alertId: string) => {
    await api.alerts.resolve(alertId);
    invalidateAll();
  };

  const handleBulkResolve = async () => {
    setBulkLoading(true);
    await api.alerts.bulkResolve({
      severity: severityFilter || undefined,
    });
    invalidateAll();
    setBulkLoading(false);
  };

  const handleBulkDelete = async (target: 'resolved' | 'all') => {
    setBulkLoading(true);
    if (target === 'all') {
      await api.alerts.bulkDelete({ all: 'true' });
    } else {
      await api.alerts.bulkDelete({ resolved: 'true' });
    }
    invalidateAll();
    setBulkLoading(false);
    setConfirmDelete(false);
  };

  const critCount = summary?.bySeverity.find((s) => s.severity === 'critical')?.unresolved ?? 0;
  const warnCount = summary?.bySeverity.find((s) => s.severity === 'warning')?.unresolved ?? 0;
  const infoCount = summary?.bySeverity.find((s) => s.severity === 'info')?.unresolved ?? 0;
  const totalUnresolved = summary?.totalUnresolved ?? 0;
  const unresolvedInView = (alertsData ?? []).filter((a) => !a.alert.resolved).length;
  const resolvedInView = (alertsData ?? []).filter((a) => a.alert.resolved).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">Alerts</h1>
          <div className="flex items-center gap-3 text-xs">
            {critCount > 0 && (
              <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded-md font-medium">
                {critCount} Critical
              </span>
            )}
            {warnCount > 0 && (
              <span className="bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded-md font-medium">
                {warnCount} Warning
              </span>
            )}
            {infoCount > 0 && (
              <span className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded-md font-medium">
                {infoCount} Info
              </span>
            )}
            {critCount === 0 && warnCount === 0 && infoCount === 0 && (
              <span className="text-gray-500">All clear</span>
            )}
          </div>
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-2">
          {totalUnresolved > 0 && (
            <button
              onClick={handleBulkResolve}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Resolve All{severityFilter ? ` ${severityFilter}` : ''}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setConfirmDelete(!confirmDelete)}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
            {confirmDelete && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setConfirmDelete(false)} />
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[180px]">
                  <button
                    onClick={() => handleBulkDelete('resolved')}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 w-full text-left"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    Delete resolved
                  </button>
                  <button
                    onClick={() => handleBulkDelete('all')}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 w-full text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete all alerts
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'unresolved', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-medium',
              filter === f ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-300 ml-auto"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* Alert list */}
      {isLoading ? (
        <div className="text-gray-500 text-center py-20 text-sm">Loading...</div>
      ) : (alertsData ?? []).length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 w-8"></th>
                <th className="text-left px-4 py-3">Alert</th>
                <th className="text-left px-4 py-3">Device</th>
                <th className="text-left px-4 py-3">Severity</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {(alertsData ?? []).map(({ alert, agentName, agentHostname }) => {
                const suggestedCmd = (alert.details as any)?.suggestedCommand;
                return (
                  <tr
                    key={alert.id}
                    className={clsx(
                      'border-b border-gray-800/50',
                      alert.resolved ? 'opacity-40' : 'hover:bg-gray-800/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      {alert.resolved ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className={clsx(
                          'w-4 h-4',
                          alert.severity === 'critical' && 'text-red-400',
                          alert.severity === 'warning' && 'text-yellow-400',
                          alert.severity === 'info' && 'text-blue-400',
                        )} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white text-xs font-medium block">
                        {alert.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-400 text-xs">{alert.message}</span>
                      {suggestedCmd && !alert.resolved && (
                        <AlertRunCommand agentId={alert.agentId} alertId={alert.id} command={suggestedCmd} onDone={invalidateAll} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/agents/${alert.agentId}`}
                        className="text-gray-300 text-xs hover:text-emerald-400 no-underline"
                      >
                        {agentName ?? 'Unknown'}
                      </Link>
                      <span className="text-gray-600 text-xs block">{agentHostname}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        alert.severity === 'critical' && 'bg-red-500/10 text-red-400',
                        alert.severity === 'warning' && 'bg-yellow-500/10 text-yellow-400',
                        alert.severity === 'info' && 'bg-blue-500/10 text-blue-400',
                      )}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(alert.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!alert.resolved && (
                        <button
                          onClick={() => handleResolve(alert.id)}
                          className="text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded hover:bg-gray-700"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-lg">
          <Bell className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No alerts match your filters</p>
        </div>
      )}
    </div>
  );
}

function AlertRunCommand({ agentId, alertId, command, onDone }: { agentId: string; alertId: string; command: string; onDone: () => void }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'polling' | 'success' | 'failed'>('idle');
  const [result, setResult] = useState<string | null>(null);

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
            onDone();
          }
        } catch { /* keep polling */ }
        if (attempts > 60) { clearInterval(poll); setStatus('failed'); setResult('Timed out'); }
      }, 2000);
    } catch (err: any) { setStatus('failed'); setResult(err.message); }
  };

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400 font-mono">{command}</code>
      {status === 'idle' && (
        <button onClick={run} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">
          <Play className="w-3 h-3" /> Run
        </button>
      )}
      {(status === 'pending' || status === 'polling') && (
        <span className="flex items-center gap-1 text-xs text-yellow-400"><Loader2 className="w-3 h-3 animate-spin" /> {status === 'pending' ? 'Sending...' : 'Waiting...'}</span>
      )}
      {status === 'success' && <span className="text-xs text-emerald-400">Success</span>}
      {status === 'failed' && (
        <>
          <span className="text-xs text-red-400">Failed</span>
          <button onClick={() => { setStatus('idle'); setResult(null); }} className="text-xs text-gray-500 hover:text-white">Retry</button>
        </>
      )}
      {result && <span className="text-xs text-gray-500 truncate max-w-[200px]" title={result}>{result}</span>}
    </div>
  );
}
