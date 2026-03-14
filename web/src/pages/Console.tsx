import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Terminal, Bot, ArrowLeft, Send, Loader2, Play,
  ChevronDown, ChevronUp, Plus, MessageSquare, Trash2,
} from 'lucide-react';
import clsx from 'clsx';

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'system';
  text: string;
}

export default function Console() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'system', text: 'Remote console — type commands below' },
  ]);
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<{ command: string; reason: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
  });

  const { data: sessions } = useQuery({
    queryKey: ['consoleSessions', id],
    queryFn: () => api.console.sessions(id!),
    enabled: !!id,
  });

  const hostname = agent?.hostname ?? 'agent';

  // Auto-create or resume session on mount
  useEffect(() => {
    if (!sessions || !id) return;
    if (sessionId) return; // already have one

    // Resume most recent session if it's less than 30 min old
    const recent = sessions[0];
    if (recent) {
      const age = Date.now() - new Date(recent.lastActiveAt).getTime();
      if (age < 30 * 60 * 1000) {
        setSessionId(recent.id);
        return;
      }
    }

    // Otherwise create a new one
    api.console.createSession(id).then((s) => {
      setSessionId(s.id);
      queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
    });
  }, [sessions, id, sessionId, queryClient]);

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

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

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
      const data = await api.console.execute(id, cmd, sessionId ?? undefined);
      setPendingId(data.id);
    } catch {
      setLines((prev) => [
        ...prev.filter((l) => !(l.type === 'system' && l.text.includes('Executing...'))),
        { type: 'error', text: 'Failed to send command' },
      ]);
      setPendingCmd(null);
    }
  }, [id, hostname, pendingCmd, sessionId]);

  const askAI = useMutation({
    mutationFn: async (message: string) => {
      const terminalHistory = lines.slice(-30).map((l) => l.text).join('\n');
      return api.console.ask(id!, message, terminalHistory, sessionId ?? undefined);
    },
    onSuccess: (data) => {
      setAiResponse(data.response);
      setAiSuggestion(data.suggestion ?? null);
      setAiInput('');
      // Update sessionId if one was created server-side
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
      }
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      executeCommand(input);
    }
  }

  function runSuggestion() {
    if (aiSuggestion) {
      executeCommand(aiSuggestion.command);
      setAiSuggestion(null);
    }
  }

  function startNewSession() {
    if (!id) return;
    api.console.createSession(id).then((s) => {
      setSessionId(s.id);
      setLines([{ type: 'system', text: 'New session started' }]);
      setAiResponse('');
      setAiSuggestion(null);
      setShowSessions(false);
      queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
    });
  }

  function switchSession(sid: string) {
    setSessionId(sid);
    setLines([{ type: 'system', text: 'Switched to previous session' }]);
    setAiResponse('');
    setAiSuggestion(null);
    setShowSessions(false);
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">Console</span>
          {agent && (
            <span className="text-gray-500 text-xs">
              {agent.name} ({agent.hostname})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Session controls */}
          <div className="relative">
            <button
              onClick={() => setShowSessions(!showSessions)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800"
            >
              <MessageSquare className="w-3 h-3" />
              Sessions
            </button>
            {showSessions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSessions(false)} />
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[220px]">
                  <button
                    onClick={startNewSession}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-400 hover:bg-gray-700 w-full text-left"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Session
                  </button>
                  {(sessions ?? []).length > 0 && (
                    <div className="border-t border-gray-700 my-1" />
                  )}
                  {(sessions ?? []).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => switchSession(s.id)}
                      className={clsx(
                        'flex items-center justify-between px-3 py-2 text-xs w-full text-left hover:bg-gray-700',
                        s.id === sessionId ? 'text-emerald-400' : 'text-gray-300'
                      )}
                    >
                      <span>{new Date(s.createdAt).toLocaleString()}</span>
                      <span className="text-gray-600 text-[10px]">~{s.tokenEstimate} tok</span>
                    </button>
                  ))}
                  {(sessions ?? []).length > 0 && (
                    <>
                      <div className="border-t border-gray-700 my-1" />
                      <button
                        onClick={() => {
                          if (!id) return;
                          api.console.clearAllSessions(id).then(() => {
                            setSessionId(null);
                            setLines([{ type: 'system', text: 'All sessions cleared' }]);
                            setAiResponse('');
                            setAiSuggestion(null);
                            setShowSessions(false);
                            queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
                          });
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 w-full text-left"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear All Sessions
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <Link
            to={`/agents/${id}`}
            className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1 no-underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Link>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        onClick={focusInput}
        className="flex-1 overflow-y-auto bg-black p-4 font-mono text-[13px] cursor-text"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={clsx(
              'whitespace-pre-wrap leading-relaxed',
              line.type === 'command' && 'text-emerald-400',
              line.type === 'output' && 'text-gray-300',
              line.type === 'error' && 'text-red-400',
              line.type === 'system' && 'text-yellow-500/70 italic text-xs',
            )}
          >
            {line.text}
          </div>
        ))}

        <div className="flex items-center text-emerald-400 mt-1">
          <span className="text-gray-600">{hostname}:~$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!pendingCmd}
            className="flex-1 bg-transparent outline-none text-white caret-emerald-400 ml-1.5"
            autoFocus
          />
        </div>
      </div>

      {/* AI Panel */}
      <div className="border-t border-gray-800 bg-gray-900 shrink-0">
        <button
          onClick={() => setAiOpen(!aiOpen)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-blue-400" />
            AI Assistant
            {sessionId && (
              <span className="text-gray-600 text-[10px]">(session active)</span>
            )}
          </span>
          {aiOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {aiOpen && (
          <div className="px-4 pb-3 space-y-2.5">
            <div className="flex gap-2">
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aiInput.trim() && askAI.mutate(aiInput.trim())}
                placeholder="Ask AI about this machine..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => aiInput.trim() && askAI.mutate(aiInput.trim())}
                disabled={!aiInput.trim() || askAI.isPending}
                className="bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
              >
                {askAI.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>

            {aiResponse && (
              <div className="bg-gray-800 rounded-md p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono border border-gray-700 max-h-48 overflow-y-auto">
                {aiResponse}
              </div>
            )}

            {aiSuggestion && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-xs font-mono">{aiSuggestion.command}</code>
                  <button
                    onClick={runSuggestion}
                    className="bg-emerald-500 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-emerald-600 flex items-center gap-1 shrink-0"
                  >
                    <Play className="w-3 h-3" /> Run
                  </button>
                </div>
                <p className="text-gray-500 text-[11px] mt-1">{aiSuggestion.reason}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
