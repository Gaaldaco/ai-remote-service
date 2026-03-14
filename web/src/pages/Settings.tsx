import { useState } from 'react';
import { Terminal, Copy, Check, Trash2, Download } from 'lucide-react';

const API_URL = 'https://api-production-64cc.up.railway.app';

export default function Settings() {
  const [copied, setCopied] = useState('');

  const installCommand = `curl -sSL ${API_URL}/install.sh -o /tmp/install.sh && bash /tmp/install.sh`;
  const updateCommand = `curl -sL https://github.com/Gaaldaco/ai-remote-service/releases/latest/download/ai-remote-agent-linux-amd64 -o /usr/local/bin/ai-remote-agent && chmod +x /usr/local/bin/ai-remote-agent && systemctl restart ai-remote-agent`;
  const uninstallCommand = `systemctl stop ai-remote-agent && systemctl disable ai-remote-agent && rm -f /usr/local/bin/ai-remote-agent /etc/systemd/system/ai-remote-agent.service && rm -rf /etc/ai-remote-agent && systemctl daemon-reload && echo "Agent uninstalled successfully"`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-white mb-6">Settings</h1>

      {/* Install Agent */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Download className="w-4 h-4 text-emerald-400" />
          Install Agent
        </h2>
        <p className="text-gray-500 text-xs mb-4">
          Run as root on any Linux machine. Downloads the agent binary, registers with the API, and starts the systemd service.
        </p>

        <CommandBlock
          label="Install"
          command={installCommand}
          copied={copied}
          onCopy={handleCopy}
          copyKey="install"
        />
        <CommandBlock
          label="Update existing agent"
          command={updateCommand}
          copied={copied}
          onCopy={handleCopy}
          copyKey="update"
          className="mt-3"
        />
      </div>

      {/* Uninstall Agent */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400" />
          Uninstall Agent
        </h2>
        <p className="text-gray-500 text-xs mb-4">
          Run as root on the target machine to stop, disable, and remove the agent. Then delete the device from the Devices page to clean up dashboard data.
        </p>

        <CommandBlock
          label="Uninstall"
          command={uninstallCommand}
          copied={copied}
          onCopy={handleCopy}
          copyKey="uninstall"
          variant="danger"
        />
      </div>

      {/* Configuration Reference */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-400" />
          Agent Configuration
        </h2>
        <p className="text-gray-500 text-xs mb-3">
          Config file: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-[11px]">/etc/ai-remote-agent/config.yaml</code>
        </p>
        <pre className="bg-gray-800 rounded-md p-3 text-xs text-gray-300 overflow-auto">
{`api_url: "${API_URL}"
api_key: "ars_..."
agent_name: "my-server"
snapshot_interval: 60     # seconds between snapshots
heartbeat_interval: 30    # seconds between heartbeats
command_poll_interval: 5  # seconds between command polls`}
        </pre>
        <div className="mt-3 space-y-1 text-xs text-gray-500">
          <p>Logs: <code className="bg-gray-800 px-1 py-0.5 rounded text-[11px]">journalctl -u ai-remote-agent -f</code></p>
          <p>Status: <code className="bg-gray-800 px-1 py-0.5 rounded text-[11px]">systemctl status ai-remote-agent</code></p>
          <p>Restart: <code className="bg-gray-800 px-1 py-0.5 rounded text-[11px]">systemctl restart ai-remote-agent</code></p>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({
  label,
  command,
  copied,
  onCopy,
  copyKey,
  variant = 'default',
  className = '',
}: {
  label: string;
  command: string;
  copied: string;
  onCopy: (text: string, key: string) => void;
  copyKey: string;
  variant?: 'default' | 'danger';
  className?: string;
}) {
  const codeColor = variant === 'danger' ? 'text-red-300' : 'text-emerald-300';

  return (
    <div className={`bg-gray-800 rounded-md p-3 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        <button
          onClick={() => onCopy(command, copyKey)}
          className="text-gray-500 hover:text-white"
        >
          {copied === copyKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <code className={`${codeColor} text-xs break-all leading-relaxed`}>{command}</code>
    </div>
  );
}
