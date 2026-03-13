import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import HealthScore from '@/components/HealthScore';
import { Monitor, AlertTriangle, Shield, Clock } from 'lucide-react';

export default function Dashboard() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents.list,
  });
  const { data: alertSummary } = useQuery({
    queryKey: ['alertSummary'],
    queryFn: api.alerts.summary,
  });

  const onlineCount = agents?.filter((a) => a.status === 'online').length ?? 0;
  const offlineCount = agents?.filter((a) => a.status === 'offline').length ?? 0;
  const totalCount = agents?.length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            Monitoring {totalCount} agent{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={<Monitor className="w-5 h-5 text-emerald-400" />}
          label="Online"
          value={onlineCount}
          color="emerald"
        />
        <SummaryCard
          icon={<Monitor className="w-5 h-5 text-red-400" />}
          label="Offline"
          value={offlineCount}
          color="red"
        />
        <SummaryCard
          icon={<AlertTriangle className="w-5 h-5 text-yellow-400" />}
          label="Unresolved Alerts"
          value={alertSummary?.totalUnresolved ?? 0}
          color="yellow"
        />
        <SummaryCard
          icon={<Shield className="w-5 h-5 text-blue-400" />}
          label="Total Agents"
          value={totalCount}
          color="blue"
        />
      </div>

      {/* Agent Grid */}
      {isLoading ? (
        <div className="text-gray-400 text-center py-20">Loading agents...</div>
      ) : agents && agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-gray-900 rounded-xl border border-gray-800">
          <Monitor className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg text-white mb-2">No agents registered</h3>
          <p className="text-gray-400 text-sm">
            Install the agent on a machine to get started.
            <br />
            Check the <Link to="/settings" className="text-emerald-400 hover:underline">Settings</Link> page for installation instructions.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        {icon}
        <span className="text-gray-400 text-sm">{label}</span>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const timeAgo = agent.lastSeen
    ? getTimeAgo(new Date(agent.lastSeen))
    : 'Never';

  return (
    <Link
      to={`/agents/${agent.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors no-underline"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold">{agent.name}</h3>
          <p className="text-gray-500 text-xs mt-0.5">{agent.hostname}</p>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>{agent.os}</span>
        <span>{agent.arch}</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo}
        </span>
      </div>

      {agent.autoRemediate && (
        <div className="mt-3 flex items-center gap-1 text-xs text-emerald-400">
          <Shield className="w-3 h-3" />
          Auto-remediation enabled
        </div>
      )}
    </Link>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
