import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type KBEntry } from '@/lib/api';
import { BookOpen, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import clsx from 'clsx';

export default function KnowledgeBase() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ['knowledgeBase'],
    queryFn: api.knowledgeBase.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.knowledgeBase.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] }),
  });

  const toggleAutoApply = useMutation({
    mutationFn: (entry: KBEntry) =>
      api.knowledgeBase.update(entry.id, { autoApply: !entry.autoApply }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
          <p className="text-gray-400 text-sm mt-1">
            Learned solutions from past incidents
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600"
        >
          <Plus className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      {showForm && <AddEntryForm onClose={() => setShowForm(false)} />}

      {isLoading ? (
        <div className="text-gray-400 text-center py-20">Loading...</div>
      ) : (
        <div className="space-y-3">
          {(entries ?? []).map((entry) => (
            <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="w-4 h-4 text-emerald-400" />
                    <span className="text-white font-semibold text-sm">{entry.issuePattern}</span>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                      {entry.issueCategory}
                    </span>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                      {entry.platform}
                    </span>
                  </div>
                  {entry.description && (
                    <p className="text-gray-400 text-sm mt-1">{entry.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleAutoApply.mutate(entry)}
                    className={clsx(
                      'flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg',
                      entry.autoApply
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-gray-800 text-gray-400'
                    )}
                  >
                    {entry.autoApply ? (
                      <ToggleRight className="w-4 h-4" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                    Auto-Apply
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(entry.id)}
                    className="text-red-400 hover:text-red-300 p-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-3 mb-3">
                <span className="text-xs text-gray-500 block mb-1">Solution:</span>
                <code className="text-emerald-300 text-xs">{entry.solution}</code>
              </div>

              <div className="flex gap-4 text-xs text-gray-500">
                <span className="text-emerald-400">{entry.successCount} successes</span>
                <span className="text-red-400">{entry.failureCount} failures</span>
                <span>
                  {entry.successCount + entry.failureCount > 0
                    ? `${Math.round((entry.successCount / (entry.successCount + entry.failureCount)) * 100)}% success rate`
                    : 'No executions yet'}
                </span>
              </div>
            </div>
          ))}
          {(!entries || entries.length === 0) && (
            <div className="text-center py-20 bg-gray-900 rounded-xl border border-gray-800">
              <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg text-white mb-2">Knowledge base is empty</h3>
              <p className="text-gray-400 text-sm">
                Solutions will be automatically added when AI successfully remediates issues.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddEntryForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    issuePattern: '',
    issueCategory: 'performance',
    platform: 'linux',
    solution: '',
    description: '',
    autoApply: false,
  });

  const createMutation = useMutation({
    mutationFn: () => api.knowledgeBase.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] });
      onClose();
    },
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
      <h3 className="text-white font-semibold mb-4">New Knowledge Base Entry</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Issue Pattern</label>
          <input
            value={form.issuePattern}
            onChange={(e) => setForm({ ...form, issuePattern: e.target.value })}
            placeholder="e.g., nginx service down"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Category</label>
          <select
            value={form.issueCategory}
            onChange={(e) => setForm({ ...form, issueCategory: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300"
          >
            <option value="performance">Performance</option>
            <option value="security">Security</option>
            <option value="availability">Availability</option>
            <option value="update">Update</option>
          </select>
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Solution (command)</label>
        <input
          value={form.solution}
          onChange={(e) => setForm({ ...form, solution: e.target.value })}
          placeholder="e.g., systemctl restart nginx"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
        />
      </div>
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={form.autoApply}
            onChange={(e) => setForm({ ...form, autoApply: e.target.checked })}
            className="rounded"
          />
          Auto-apply when matched
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!form.issuePattern || !form.solution}
            className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
