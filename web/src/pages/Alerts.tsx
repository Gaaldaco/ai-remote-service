import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle } from 'lucide-react';
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-gray-400 text-sm mt-1">
            {summary?.totalUnresolved ?? 0} unresolved alert{(summary?.totalUnresolved ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Severity summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {summary.bySeverity.map((s) => (
            <div key={s.severity} className={clsx(
              'rounded-xl border p-4',
              s.severity === 'critical' && 'bg-red-500/5 border-red-500/20',
              s.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20',
              s.severity === 'info' && 'bg-blue-500/5 border-blue-500/20',
            )}>
              <div className="text-sm text-gray-400 capitalize">{s.severity}</div>
              <div className="text-2xl font-bold text-white">{s.unresolved}</div>
              <div className="text-xs text-gray-500">{s.total} total</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(['all', 'unresolved', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-sm',
              filter === f ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 ml-auto"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* Alert list */}
      {isLoading ? (
        <div className="text-gray-400 text-center py-20">Loading...</div>
      ) : (
        <div className="space-y-2">
          {(alertsData ?? []).map(({ alert, agentName, agentHostname }) => (
            <div
              key={alert.id}
              className={clsx(
                'p-4 rounded-lg border text-sm flex items-start gap-3',
                alert.resolved && 'opacity-50',
                alert.severity === 'critical' && 'bg-red-500/5 border-red-500/20',
                alert.severity === 'warning' && 'bg-yellow-500/5 border-yellow-500/20',
                alert.severity === 'info' && 'bg-blue-500/5 border-blue-500/20',
              )}
            >
              {alert.resolved ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className={clsx(
                  'w-5 h-5 shrink-0 mt-0.5',
                  alert.severity === 'critical' && 'text-red-400',
                  alert.severity === 'warning' && 'text-yellow-400',
                  alert.severity === 'info' && 'text-blue-400',
                )} />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-medium">{alert.type.replace(/_/g, ' ')}</span>
                  <span className="text-gray-500 text-xs">
                    {agentName ?? 'Unknown'} ({agentHostname ?? ''})
                  </span>
                </div>
                <p className="text-gray-300">{alert.message}</p>
                <span className="text-gray-500 text-xs mt-1 block">
                  {new Date(alert.createdAt).toLocaleString()}
                  {alert.resolvedAt && ` — Resolved ${new Date(alert.resolvedAt).toLocaleString()} by ${alert.resolvedBy}`}
                </span>
              </div>

              {!alert.resolved && (
                <button
                  onClick={() => handleResolve(alert.id)}
                  className="text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-700 shrink-0"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
          {(!alertsData || alertsData.length === 0) && (
            <p className="text-gray-500 text-center py-10">No alerts match your filters</p>
          )}
        </div>
      )}
    </div>
  );
}
