import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Terminal, Bot, ArrowLeft, Send, Loader2, Play,
  ChevronDown, ChevronUp, Plus, MessageSquare, Trash2, Zap, CheckCircle,
} from 'lucide-react';
import clsx from 'clsx';

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'system' | 'ai' | 'success';
  text: string;
}

export default function Console() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [autopilot, setAutopilot] = useState(false);
  const [autopilotPaused, setAutopilotPaused] = useState(false);
  const [autopilotFix, setAutopilotFix] = useState<{ command: string; reason: string } | null>(null);
  const [autopilotDone, setAutopilotDone] = useState(false);
  const [autopilotPrompt, setAutopilotPrompt] = useState<{
    issue: string; failedCmd: string; failedOutput: string; alertId: string;
  } | null>(null);

  // Refs to avoid stale closures in async callbacks
  const autopilotRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const linesRef = useRef<TerminalLine[]>([]);
  const alertIdRef = useRef<string>('');
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep refs in sync
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { linesRef.current = lines; }, [lines]);

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
    if (sessionId) return;

    const recent = sessions[0];
    if (recent) {
      const age = Date.now() - new Date(recent.lastActiveAt).getTime();
      if (age < 30 * 60 * 1000) {
        setSessionId(recent.id);
        return;
      }
    }

    api.console.createSession(id).then((s) => {
      setSessionId(s.id);
      queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
    });
  }, [sessions, id, sessionId, queryClient]);

  // ─── Execute command on agent ────────────────────────────────────────────
  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || !id) return;

    setLines((prev) => [
      ...prev,
      { type: 'command', text: `${hostname}:~$ ${cmd}` },
      { type: 'system', text: 'Executing...' },
    ]);
    setPendingCmd(cmd);
    setInput('');

    try {
      const data = await api.console.execute(id, cmd, sessionIdRef.current ?? undefined);
      setPendingId(data.id);
    } catch {
      setLines((prev) => [
        ...prev.filter((l) => !(l.type === 'system' && l.text.includes('Executing...'))),
        { type: 'error', text: 'Failed to send command' },
      ]);
      setPendingCmd(null);
    }
  }, [id, hostname]);

  // ─── Autopilot step — AI analyzes and decides next action ───────────────
  const autopilotStep = useCallback(async (message: string) => {
    if (!id || !sessionIdRef.current || !autopilotRef.current) return;

    setLines((prev) => [...prev, { type: 'ai', text: '[AI] Analyzing...' }]);

    try {
      const recentLines = linesRef.current.slice(-40).map((l) => l.text).join('\n');
      const data = await api.console.ask(id, message, recentLines, sessionIdRef.current, true);

      if (data.sessionId && !sessionIdRef.current) {
        setSessionId(data.sessionId);
      }

      // Clean AI response (remove code blocks that we parse separately)
      const cleanResponse = data.response
        .replace(/```diagnostic\n[\s\S]*?\n```/g, '')
        .replace(/```suggest\n[\s\S]*?\n```/g, '')
        .replace(/```solution\n[\s\S]*?\n```/g, '')
        .replace(/```resolved\n[\s\S]*?\n```/g, '')
        .trim();

      if (cleanResponse) {
        setLines((prev) => [
          ...prev.filter((l) => !(l.type === 'ai' && l.text === '[AI] Analyzing...')),
          { type: 'ai', text: `[AI] ${cleanResponse}` },
        ]);
      } else {
        setLines((prev) => prev.filter((l) => !(l.type === 'ai' && l.text === '[AI] Analyzing...')));
      }

      // Check for resolved signal — AI says the issue is fixed
      const resolvedMatch = data.response.match(/```resolved\n([\s\S]*?)\n```/);
      if (resolvedMatch) {
        try {
          const resolved = JSON.parse(resolvedMatch[1]);
          // Resolve the alert if we have one
          if (alertIdRef.current) {
            try {
              await api.alerts.resolve(alertIdRef.current);
            } catch { /* alert might already be resolved */ }
          }
          setAutopilotDone(true);
          setAutopilot(false);
          autopilotRef.current = false;
          setLines((prev) => [...prev, {
            type: 'success',
            text: `[RESOLVED] ${resolved.summary || 'Issue has been remediated successfully.'}`,
          }]);
          queryClient.invalidateQueries({ queryKey: ['alerts'] });
          queryClient.invalidateQueries({ queryKey: ['alertSummary'] });
          return;
        } catch { /* ignore parse error, continue */ }
      }

      // Diagnostic command — auto-execute (read-only, safe)
      if (data.diagnostic) {
        setLines((prev) => [...prev, { type: 'ai', text: `[AI] Running diagnostic: ${data.diagnostic!.reason}` }]);
        setTimeout(() => executeCommand(data.diagnostic!.command), 500);
        return;
      }

      // Fix suggestion — pause for user approval
      if (data.suggestion) {
        setAutopilotPaused(true);
        setAutopilotFix(data.suggestion);
        setLines((prev) => [...prev, {
          type: 'ai',
          text: `[AI] Suggested fix: ${data.suggestion!.command}\n     Reason: ${data.suggestion!.reason}\n     Waiting for your approval...`,
        }]);
        return;
      }

      // AI didn't emit any action block — nudge it to continue
      if (autopilotRef.current) {
        setTimeout(() => {
          autopilotStep('Continue investigating. If you need to run a command, use a diagnostic or suggest block. If the issue is resolved, emit a resolved block.');
        }, 1000);
      }
    } catch (err: any) {
      setLines((prev) => [
        ...prev.filter((l) => !(l.type === 'ai' && l.text === '[AI] Analyzing...')),
        { type: 'error', text: `[AI Error] ${err.message}` },
      ]);
    }
  }, [id, executeCommand, queryClient]);

  // ─── Poll for command results ───────────────────────────────────────────
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
        const outputText = data.output || '(no output)';
        setLines((prev) => [
          ...prev.filter((l) => !(l.type === 'system' && l.text.includes('Executing...'))),
          { type: data.success ? 'output' : 'error', text: outputText },
        ]);
        setPendingCmd(null);
        setPendingId(null);

        // Autopilot: feed output back to AI for next step
        if (autopilotRef.current && id && sessionIdRef.current) {
          setTimeout(() => {
            const resultStatus = data.success ? 'succeeded' : 'failed';
            autopilotStep(
              `Command ${resultStatus}. Output:\n${outputText}\n\nAnalyze this output. ` +
              `If the fix was applied and worked, verify it and then emit a resolved block. ` +
              `If you need more info, run another diagnostic. ` +
              `If you're ready to fix, suggest a command.`
            );
          }, 800);
        }
      }
      return data;
    },
  });

  // ─── Show autopilot prompt from URL params (don't auto-start) ───────────
  useEffect(() => {
    if (!sessionId || !id) return;
    const isAutopilot = searchParams.get('autopilot') === 'true';
    if (!isAutopilot || autopilotRef.current || autopilotPrompt) return;

    const issue = searchParams.get('issue') || '';
    const failedCmd = searchParams.get('failedCmd') || '';
    const failedOutput = searchParams.get('failedOutput') || '';
    const alertId = searchParams.get('alertId') || '';

    // Clear URL params
    setSearchParams({}, { replace: true });

    // Show the issue context and prompt user to start autopilot
    setLines((prev) => [
      ...prev,
      { type: 'system', text: `Issue: ${issue}` },
      ...(failedCmd ? [{ type: 'system' as const, text: `Failed command: ${failedCmd}` }] : []),
    ]);
    setAutopilotPrompt({ issue, failedCmd, failedOutput, alertId });
  }, [sessionId, id, searchParams, autopilotPrompt]);

  // Actually start autopilot when user clicks the button
  function startAutopilot() {
    if (!autopilotPrompt || !id) return;
    const { issue, failedCmd, failedOutput, alertId } = autopilotPrompt;

    setAutopilot(true);
    autopilotRef.current = true;
    setAiOpen(true);
    setAutopilotDone(false);
    setAutopilotPrompt(null);
    alertIdRef.current = alertId;

    const initialMessage = failedCmd
      ? `AUTOPILOT: A remediation command failed. Investigate and fix this issue.\n\nIssue: ${issue}\nFailed command: ${failedCmd}\nError output: ${failedOutput}\n${alertId ? `Alert ID: ${alertId}` : ''}\n\nYour goal: diagnose the root cause, apply a fix, verify it worked, document the solution, and resolve the alert. Start by running diagnostics.`
      : `AUTOPILOT: There's a critical issue that needs investigation and remediation.\n\nIssue: ${issue}\n${alertId ? `Alert ID: ${alertId}` : ''}\n\nYour goal: diagnose the root cause, apply a fix, verify it worked, document the solution, and resolve the alert. Start by running diagnostics.`;

    setLines((prev) => [
      ...prev,
      { type: 'system', text: '--- Autopilot mode activated ---' },
      { type: 'ai', text: `[AI] Investigating: ${issue || 'system issue'}` },
    ]);

    setTimeout(() => autopilotStep(initialMessage), 500);
  }

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, autopilotPaused]);

  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  // ─── Manual AI chat (non-autopilot) ─────────────────────────────────────
  const askAI = useMutation({
    mutationFn: async (message: string) => {
      const terminalHistory = linesRef.current.slice(-30).map((l) => l.text).join('\n');
      return api.console.ask(id!, message, terminalHistory, sessionIdRef.current ?? undefined, autopilotRef.current);
    },
    onSuccess: (data) => {
      setAiResponse(data.response);
      setAiSuggestion(data.suggestion ?? null);
      setAiInput('');
      if (data.sessionId && !sessionIdRef.current) {
        setSessionId(data.sessionId);
        queryClient.invalidateQueries({ queryKey: ['consoleSessions', id] });
      }

      // If in autopilot and the manual ask returned a diagnostic/suggestion, handle it
      if (autopilotRef.current) {
        if (data.diagnostic) {
          setLines((prev) => [...prev, { type: 'ai', text: `[AI] Running diagnostic: ${data.diagnostic!.reason}` }]);
          setTimeout(() => executeCommand(data.diagnostic!.command), 500);
        } else if (data.suggestion) {
          setAutopilotPaused(true);
          setAutopilotFix(data.suggestion);
          setLines((prev) => [...prev, {
            type: 'ai',
            text: `[AI] Suggested fix: ${data.suggestion!.command}\n     Reason: ${data.suggestion!.reason}\n     Waiting for your approval...`,
          }]);
        }
      }
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') executeCommand(input);
  }

  function runSuggestion() {
    if (aiSuggestion) {
      executeCommand(aiSuggestion.command);
      setAiSuggestion(null);
    }
  }

  function stopAutopilot() {
    setAutopilot(false);
    autopilotRef.current = false;
    setAutopilotPaused(false);
    setAutopilotFix(null);
    setLines((prev) => [...prev, { type: 'system', text: '--- Autopilot stopped ---' }]);
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
          {autopilot && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400">
              <Zap className="w-3 h-3" />
              Autopilot
              <button onClick={stopAutopilot} className="ml-1 text-red-400 hover:text-red-300">
                Stop
              </button>
            </span>
          )}
          {autopilotDone && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
              <CheckCircle className="w-3 h-3" />
              Resolved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSessions(!showSessions)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800"
            >
              <MessageSquare className="w-3 h-3" /> Sessions
            </button>
            {showSessions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSessions(false)} />
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[220px]">
                  <button
                    onClick={startNewSession}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-400 hover:bg-gray-700 w-full text-left"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Session
                  </button>
                  {(sessions ?? []).length > 0 && <div className="border-t border-gray-700 my-1" />}
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
                        <Trash2 className="w-3 h-3" /> Clear All Sessions
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
              line.type === 'ai' && 'text-blue-300 text-xs',
              line.type === 'success' && 'text-emerald-400 font-bold text-sm',
            )}
          >
            {line.text}
          </div>
        ))}

        {/* Autopilot start prompt */}
        {autopilotPrompt && !autopilot && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-4 my-2 mx-1">
            <p className="text-blue-300 text-sm mb-1">This issue needs a live troubleshooting session.</p>
            <p className="text-gray-400 text-xs mb-3">AI will run diagnostics, find the root cause, suggest a fix for your approval, verify it worked, and document the solution.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={startAutopilot}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Start Autopilot
              </button>
              <button
                onClick={() => setAutopilotPrompt(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Manual Mode
              </button>
            </div>
          </div>
        )}

        {/* Autopilot fix approval */}
        {autopilotPaused && autopilotFix && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-3 my-2 mx-1">
            <p className="text-blue-300 text-xs mb-1">AI wants to run this fix:</p>
            <code className="text-emerald-400 text-xs block mb-1 font-mono">{autopilotFix.command}</code>
            <p className="text-gray-500 text-xs mb-2">{autopilotFix.reason}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const fix = autopilotFix;
                  setAutopilotPaused(false);
                  setAutopilotFix(null);
                  executeCommand(fix.command);
                }}
                className="px-3 py-1 rounded text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600"
              >
                Approve & Run
              </button>
              <button
                onClick={() => {
                  setAutopilotPaused(false);
                  setAutopilotFix(null);
                  setLines((prev) => [...prev, { type: 'system', text: 'Fix rejected by user' }]);
                  setTimeout(() => autopilotStep('The user rejected that fix. Suggest an alternative approach or investigate further.'), 300);
                }}
                className="px-3 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Reject
              </button>
              <button onClick={stopAutopilot} className="px-3 py-1 rounded text-xs font-medium text-red-400 hover:text-red-300">
                Stop Autopilot
              </button>
            </div>
          </div>
        )}

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
            {sessionId && <span className="text-gray-600 text-[10px]">(session active)</span>}
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

            {aiResponse && !autopilot && (
              <div className="bg-gray-800 rounded-md p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono border border-gray-700 max-h-48 overflow-y-auto">
                {aiResponse}
              </div>
            )}

            {aiSuggestion && !autopilot && (
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
