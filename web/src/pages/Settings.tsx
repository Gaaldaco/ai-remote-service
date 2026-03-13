import { useState } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';

export default function Settings() {
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_API_URL || window.location.origin);
  const [copied, setCopied] = useState(false);

  const installCommand = `curl -sSL ${apiUrl}/install.sh | sudo bash`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          Run this command on any Linux machine to install the AI Remote Agent.
          The installer will prompt for the API URL and register the agent.
        </p>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">API URL</label>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          />
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <h3 className="text-sm text-gray-400 mb-2">Quick Install (when hosted)</h3>
          <div className="flex items-center gap-2">
            <code className="text-emerald-300 text-sm flex-1 break-all">{installCommand}</code>
            <button
              onClick={() => handleCopy(installCommand)}
              className="text-gray-400 hover:text-white shrink-0"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-2">Manual Install</h3>
          <ol className="text-sm text-gray-300 space-y-2 list-decimal list-inside">
            <li>
              Build the agent: <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">cd agent && make build-linux</code>
            </li>
            <li>
              Copy the binary and service files to the target machine
            </li>
            <li>
              Run the installer: <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">sudo bash install.sh</code>
            </li>
            <li>
              Enter the API URL and register the agent when prompted
            </li>
            <li>
              Verify: <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">systemctl status ai-remote-agent</code>
            </li>
          </ol>
        </div>
      </div>

      {/* Configuration Reference */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Agent Configuration</h2>
        <p className="text-gray-400 text-sm mb-3">
          Agent config is stored at <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">/etc/ai-remote-agent/config.yaml</code>
        </p>
        <pre className="bg-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-auto">
{`api_url: "${apiUrl}"
api_key: "ars_..."
agent_name: "my-server"
snapshot_interval: 60     # seconds between snapshots
heartbeat_interval: 30    # seconds between heartbeats
command_poll_interval: 10 # seconds between command polls`}
        </pre>
      </div>
    </div>
  );
}
