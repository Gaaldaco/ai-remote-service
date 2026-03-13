import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Terminal, Bot, ArrowLeft, Send, Loader2, Play, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'system';
  text: string;
}

export default function Console() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'system', text: 'AI Remote Agent Console — type commands below' },
  ]);
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<{ command: string; reason: string } | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
  });

  const hostname = agent?.hostname ?? 'agent';

  // Poll for command result
  useQuery({
    queryKey: ['cmd-result', pendingId],
    queryFn: async () => {
      if (!pendingId || !id) return null;
      const res = await fetch(`/api/console/${id}/result/${pendingId}`);
      return res.json();
    },
    enabled: !!pendingId && !!id,
    refetchInterval: 2000,
    select: (data) => {
      if (data?.status === 'complete') {
        setLines((prev) => [
          ...prev.filter((l) => !(l.type === 'system' && l.text.includes('Executing...'))),
          { type: data.success ? 'output' : 'error', text: data.output || '(no output)' },
        ]);
        setPendingCmd(null);
        setPendingId(null);
      }
      return data;
    },
  });

  // Auto-scroll
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on click
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || !id || pendingCmd) return;

    setLines((prev) => [
      ...prev,
      { type: 'command', text: `${hostname}:~$ ${cmd}` },
      { type: 'system', text: 'Executing...' },
    ]);
    setPendingCmd(cmd);
    setInput('');

    try {
      const res = await fetch(`/api/console/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      setPendingId(data.id);
    } catch {
      setLines((prev) => [
        ...prev.filter((l) => !(l.type === 'system' && l.text.includes('Executing...'))),
        { type: 'error', text: 'Failed to send command' },
      ]);
      setPendingCmd(null);
    }
  }, [id, hostname, pendingCmd]);

  const askAI = useMutation({
    mutationFn: async (message: string) => {
      const terminalHistory = lines
        .slice(-30)
        .map((l) => l.text)
        .join('\n');
      const res = await fetch(`/api/console/${id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, terminalHistory }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setAiResponse(data.response);
      setAiSuggestion(data.suggestion ?? null);
      setAiInput('');
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      executeCommand(input);
    }
  }

  function runSuggestion() {
    if (aiSuggestion) {
      setInput(aiSuggestion.command);
      executeCommand(aiSuggestion.command);
      setAiSuggestion(null);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-white">Console</h1>
          {agent && (
            <span className="text-gray-500 text-sm">
              {agent.name} ({agent.hostname})
            </span>
          )}
        </div>
        <Link
          to={`/agents/${id}`}
          className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        onClick={focusInput}
        className="flex-1 overflow-y-auto bg-black p-4 font-mono text-sm cursor-text"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={clsx(
              'whitespace-pre-wrap leading-relaxed',
              line.type === 'command' && 'text-emerald-400',
              line.type === 'output' && 'text-gray-300',
              line.type === 'error' && 'text-red-400',
              line.type === 'system' && 'text-yellow-500 italic',
            )}
          >
            {line.text}
          </div>
        ))}

        {/* Active input line */}
        <div className="flex items-center text-emerald-400 mt-1">
          <span>{hostname}:~$ </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!pendingCmd}
            className="flex-1 bg-transparent outline-none text-white caret-emerald-400 ml-1"
            autoFocus
          />
        </div>
      </div>

      {/* AI Assistant Panel */}
      <div className="border-t border-gray-800 bg-gray-900">
        <button
          onClick={() => setAiOpen(!aiOpen)}
          className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-400" />
            AI Assistant
          </span>
          {aiOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>

        {aiOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex gap-2">
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aiInput.trim() && askAI.mutate(aiInput.trim())}
                placeholder="Ask AI about this machine..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={() => aiInput.trim() && askAI.mutate(aiInput.trim())}
                disabled={!aiInput.trim() || askAI.isPending}
                className="bg-blue-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
              >
                {askAI.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>

            {aiResponse && (
              <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap font-mono border border-gray-700">
                {aiResponse}
              </div>
            )}

            {aiSuggestion && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-gray-400 text-xs mb-1">Suggested command:</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-sm font-mono">{aiSuggestion.command}</code>
                  <button
                    onClick={runSuggestion}
                    className="bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-emerald-600 flex items-center gap-1 shrink-0"
                  >
                    <Play className="w-3 h-3" /> Run this
                  </button>
                </div>
                <p className="text-gray-500 text-xs mt-1">{aiSuggestion.reason}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
