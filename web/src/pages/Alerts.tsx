import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle, Bell } from 'lucide-react';
import clsx from 'clsx';

export default function Alerts() {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [severityFilter, setSeverityFilter] = useState<string>('');
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

  const handleResolve = async (alertId: string) => {
    await api.alerts.resolve(alertId);
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
    queryClient.invalidateQueries({ queryKey: ['alertSummary'] });
  };

  const critCount = summary?.bySeverity.find((s) => s.severity === 'critical')?.unresolved ?? 0;
  const warnCount = summary?.bySeverity.find((s) => s.severity === 'warning')?.unresolved ?? 0;
  const infoCount = summary?.bySeverity.find((s) => s.severity === 'info')?.unresolved ?? 0;

  return (
    <div className="p-6">
      {/* Header with inline stats */}
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
              {(alertsData ?? []).map(({ alert, agentName, agentHostname }) => (
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
              ))}
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
