import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import HealthScore from '@/components/HealthScore';
import {
  Monitor, AlertTriangle, Search, Terminal, Trash2,
  ChevronUp, ChevronDown, MoreVertical, Plus, RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';

type SortField = 'name' | 'status' | 'os' | 'lastSeen';
type SortDir = 'asc' | 'desc';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [deleteConfirm, setDeleteConfirm] = useState<Agent | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents.list,
  });
  const { data: alertSummary } = useQuery({
    queryKey: ['alertSummary'],
    queryFn: api.alerts.summary,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['alertSummary'] });
      setDeleteConfirm(null);
    },
  });

  // Filter and sort
  const filtered = (agents ?? [])
    .filter((a) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !a.name.toLowerCase().includes(q) &&
          !a.hostname.toLowerCase().includes(q) &&
          !a.os.toLowerCase().includes(q)
        )
          return false;
      }
      if (statusFilter && a.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'os':
          cmp = a.os.localeCompare(b.os);
          break;
        case 'lastSeen':
          cmp = (a.lastSeen ?? '').localeCompare(b.lastSeen ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const onlineCount = agents?.filter((a) => a.status === 'online').length ?? 0;
  const offlineCount = agents?.filter((a) => a.status === 'offline').length ?? 0;
  const degradedCount = agents?.filter((a) => a.status === 'degraded').length ?? 0;
  const totalCount = agents?.length ?? 0;

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  }

  return (
    <div className="p-6">
      {/* Top stats bar */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{totalCount}</span>
          <span className="text-sm text-gray-400">
            Device{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="h-8 w-px bg-gray-800" />
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-gray-300">{onlineCount} Online</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-gray-300">{offlineCount} Offline</span>
          </span>
          {degradedCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-gray-300">{degradedCount} Degraded</span>
            </span>
          )}
        </div>
        <div className="h-8 w-px bg-gray-800" />
        <Link
          to="/alerts"
          className={clsx(
            'flex items-center gap-1.5 text-sm no-underline',
            (alertSummary?.totalUnresolved ?? 0) > 0
              ? 'text-yellow-400'
              : 'text-gray-400'
          )}
        >
          <AlertTriangle className="w-4 h-4" />
          {alertSummary?.totalUnresolved ?? 0} Alert{(alertSummary?.totalUnresolved ?? 0) !== 1 ? 's' : ''}
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['agents'] })}
            className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            to="/settings"
            className="flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-emerald-600 no-underline transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Device
          </Link>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices..."
            className="w-full bg-gray-900 border border-gray-800 rounded-md pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-300"
        >
          <option value="">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="degraded">Degraded</option>
        </select>
      </div>

      {/* Devices table */}
      {isLoading ? (
        <div className="text-gray-500 text-center py-20 text-sm">Loading devices...</div>
      ) : filtered.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th
                  className="text-left px-4 py-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('name')}
                >
                  <span className="flex items-center gap-1">
                    Device <SortIcon field="name" />
                  </span>
                </th>
                <th
                  className="text-left px-4 py-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('status')}
                >
                  <span className="flex items-center gap-1">
                    Status <SortIcon field="status" />
                  </span>
                </th>
                <th
                  className="text-left px-4 py-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('os')}
                >
                  <span className="flex items-center gap-1">
                    OS <SortIcon field="os" />
                  </span>
                </th>
                <th className="text-left px-4 py-3">Health</th>
                <th
                  className="text-left px-4 py-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('lastSeen')}
                >
                  <span className="flex items-center gap-1">
                    Last Seen <SortIcon field="lastSeen" />
                  </span>
                </th>
                <th className="text-left px-4 py-3">Auto-Fix</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent) => (
                <DeviceRow
                  key={agent.id}
                  agent={agent}
                  actionMenu={actionMenu}
                  setActionMenu={setActionMenu}
                  onDelete={() => setDeleteConfirm(agent)}
                  onNavigate={() => navigate(`/agents/${agent.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : totalCount > 0 ? (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-lg">
          <Search className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No devices match your search</p>
        </div>
      ) : (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-lg">
          <Monitor className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <h3 className="text-white font-medium mb-1">No devices registered</h3>
          <p className="text-gray-500 text-sm mb-4">
            Install the agent on a machine to get started.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 bg-emerald-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-emerald-600 no-underline"
          >
            <Plus className="w-4 h-4" />
            Add Device
          </Link>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <DeleteModal
          agent={deleteConfirm}
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

function DeviceRow({
  agent,
  actionMenu,
  setActionMenu,
  onDelete,
  onNavigate,
}: {
  agent: Agent;
  actionMenu: string | null;
  setActionMenu: (id: string | null) => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const lastSeen = agent.lastSeen ? getTimeAgo(new Date(agent.lastSeen)) : 'Never';

  return (
    <tr
      className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
      onClick={onNavigate}
    >
      <td className="px-4 py-3">
        <div>
          <span className="text-white font-medium">{agent.name}</span>
          <span className="text-gray-500 text-xs block">{agent.hostname}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={agent.status} />
      </td>
      <td className="px-4 py-3 text-gray-300">
        <span className="text-xs">{agent.os}</span>
        <span className="text-gray-600 text-xs block">{agent.arch}</span>
      </td>
      <td className="px-4 py-3">
        <HealthScore score={null} size="sm" />
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs">{lastSeen}</td>
      <td className="px-4 py-3">
        {agent.autoRemediate ? (
          <span className="text-emerald-400 text-xs">On</span>
        ) : (
          <span className="text-gray-600 text-xs">Off</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setActionMenu(actionMenu === agent.id ? null : agent.id)}
            className="p-1.5 text-gray-500 hover:text-white rounded hover:bg-gray-700 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {actionMenu === agent.id && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setActionMenu(null)}
              />
              <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                <Link
                  to={`/agents/${agent.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white no-underline"
                  onClick={() => setActionMenu(null)}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Details
                </Link>
                <Link
                  to={`/agents/${agent.id}/console`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white no-underline"
                  onClick={() => setActionMenu(null)}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Console
                </Link>
                <div className="border-t border-gray-700 my-1" />
                <button
                  onClick={() => {
                    setActionMenu(null);
                    onDelete();
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 w-full text-left"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function DeleteModal({
  agent,
  loading,
  onConfirm,
  onCancel,
}: {
  agent: Agent;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const uninstallCmd = `systemctl stop ai-remote-agent && systemctl disable ai-remote-agent && rm -f /usr/local/bin/ai-remote-agent /etc/systemd/system/ai-remote-agent.service && rm -rf /etc/ai-remote-agent && systemctl daemon-reload`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-white font-semibold text-lg mb-2">Delete Device</h3>
        <p className="text-gray-400 text-sm mb-4">
          This will remove <span className="text-white font-medium">{agent.name}</span> ({agent.hostname}) from the dashboard, including all snapshots, alerts, and history. This cannot be undone.
        </p>

        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <p className="text-gray-400 text-xs mb-2">
            To also uninstall the agent from the machine, run:
          </p>
          <code className="text-red-300 text-xs break-all leading-relaxed block">
            {uninstallCmd}
          </code>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Deleting...' : 'Delete Device'}
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
