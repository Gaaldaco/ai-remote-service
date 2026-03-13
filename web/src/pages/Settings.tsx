import { useState } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';

const API_URL = 'https://api-production-64cc.up.railway.app';

export default function Settings() {
  const [copied, setCopied] = useState('');

  const installCommand = `curl -sSL ${API_URL}/install.sh -o /tmp/install.sh && bash /tmp/install.sh`;
  const updateCommand = `curl -sL https://github.com/Gaaldaco/ai-remote-service/releases/latest/download/ai-remote-agent-linux-amd64 -o /usr/local/bin/ai-remote-agent && chmod +x /usr/local/bin/ai-remote-agent && systemctl restart ai-remote-agent`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Agent Installation */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-emerald-400" />
          Install Agent
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Run this command as root on any Linux machine. It downloads the agent, registers with the API, and starts the service automatically.
        </p>

        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Install</span>
            <button
              onClick={() => handleCopy(installCommand, 'install')}
              className="text-gray-400 hover:text-white"
            >
              {copied === 'install' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <code className="text-emerald-300 text-sm break-all">{installCommand}</code>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Update existing agent</span>
            <button
              onClick={() => handleCopy(updateCommand, 'update')}
              className="text-gray-400 hover:text-white"
            >
              {copied === 'update' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <code className="text-emerald-300 text-xs break-all">{updateCommand}</code>
        </div>
      </div>

      {/* Configuration Reference */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Agent Configuration</h2>
        <p className="text-gray-400 text-sm mb-3">
          Config: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">/etc/ai-remote-agent/config.yaml</code>
        </p>
        <pre className="bg-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-auto">
{`api_url: "${API_URL}"
api_key: "ars_..."
agent_name: "my-server"
snapshot_interval: 60     # seconds between snapshots
heartbeat_interval: 30    # seconds between heartbeats
command_poll_interval: 5  # seconds between command polls`}
        </pre>
        <div className="mt-4 space-y-1 text-sm text-gray-400">
          <p>Logs: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">journalctl -u ai-remote-agent -f</code></p>
          <p>Status: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">systemctl status ai-remote-agent</code></p>
          <p>Restart: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">systemctl restart ai-remote-agent</code></p>
        </div>
      </div>
    </div>
  );
}
