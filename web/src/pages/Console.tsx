import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConsoleMessage } from '@/lib/api';
import { Terminal, Bot, User, ChevronRight, Send, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export default function Console() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
  });

  const { data: messages } = useQuery({
    queryKey: ['console-messages', id],
    queryFn: () => api.console.messages(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) => api.console.send(id!, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['console-messages', id] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    setInput('');
    sendMutation.mutate(trimmed);
  }

  function roleIcon(role: ConsoleMessage['role']) {
    switch (role) {
      case 'user':
        return <User className="w-4 h-4 text-emerald-400" />;
      case 'assistant':
        return <Bot className="w-4 h-4 text-blue-400" />;
      case 'command':
        return <ChevronRight className="w-4 h-4 text-yellow-400" />;
      case 'output':
        return <Terminal className="w-4 h-4 text-gray-500" />;
    }
  }

  function roleLabel(role: ConsoleMessage['role']) {
    switch (role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'AI';
      case 'command':
        return 'Command';
      case 'output':
        return 'Output';
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-white">
            Live Console
          </h1>
          {agent && (
            <span className="text-gray-400 text-sm">
              — {agent.name} ({agent.hostname})
            </span>
          )}
        </div>
        <Link
          to={`/agents/${id}`}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Back to Agent
        </Link>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-950">
        {(!messages || messages.length === 0) && (
          <div className="text-center text-gray-600 py-20">
            <Terminal className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No messages yet. Start chatting or run a command with <code className="text-emerald-400">$</code> prefix.</p>
          </div>
        )}
        {(messages ?? []).map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              'rounded-lg p-3 text-sm',
              msg.role === 'user' && 'bg-emerald-500/5 border border-emerald-500/20',
              msg.role === 'assistant' && 'bg-blue-500/5 border border-blue-500/20',
              msg.role === 'command' && 'bg-yellow-500/5 border border-yellow-500/20',
              msg.role === 'output' && 'bg-gray-800/50 border border-gray-700/50',
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              {roleIcon(msg.role)}
              <span
                className={clsx(
                  'text-xs font-medium',
                  msg.role === 'user' && 'text-emerald-400',
                  msg.role === 'assistant' && 'text-blue-400',
                  msg.role === 'command' && 'text-yellow-400',
                  msg.role === 'output' && 'text-gray-500',
                )}
              >
                {roleLabel(msg.role)}
              </span>
              {msg.model && (
                <span
                  className={clsx(
                    'text-xs px-1.5 py-0.5 rounded',
                    msg.model.includes('sonnet')
                      ? 'bg-purple-500/10 text-purple-400'
                      : 'bg-sky-500/10 text-sky-400'
                  )}
                >
                  {msg.model.includes('sonnet') ? 'Sonnet' : 'Haiku'}
                </span>
              )}
              <span className="text-gray-600 text-xs ml-auto">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <pre
              className={clsx(
                'whitespace-pre-wrap font-mono text-xs leading-relaxed',
                msg.role === 'user' && 'text-emerald-300',
                msg.role === 'assistant' && 'text-gray-300',
                msg.role === 'command' && 'text-yellow-300',
                msg.role === 'output' && 'text-gray-400',
              )}
            >
              {msg.content}
            </pre>
          </div>
        ))}
        {sendMutation.isPending && (
          <div className="flex items-center gap-2 text-gray-500 text-sm p-3">
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask AI or prefix with $ to run a command..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:border-emerald-400 transition-colors"
            disabled={sendMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            className="bg-emerald-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
        <p className="text-gray-600 text-xs mt-2">
          Prefix with <code className="text-emerald-400">$</code> or <code className="text-emerald-400">/run</code> to execute a command on the agent.
        </p>
      </div>
    </div>
  );
}
