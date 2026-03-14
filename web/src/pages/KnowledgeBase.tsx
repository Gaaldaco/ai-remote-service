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
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Knowledge Base</h1>
          <p className="text-gray-500 text-xs mt-1">
            {entries?.length ?? 0} solution{(entries?.length ?? 0) !== 1 ? 's' : ''} documented
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-emerald-600"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Entry
        </button>
      </div>

      {showForm && <AddEntryForm onClose={() => setShowForm(false)} />}

      {isLoading ? (
        <div className="text-gray-500 text-center py-20 text-sm">Loading...</div>
      ) : (entries ?? []).length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Pattern</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Solution</th>
                <th className="text-left px-4 py-3">Success Rate</th>
                <th className="text-left px-4 py-3">Auto-Apply</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((entry) => {
                const total = entry.successCount + entry.failureCount;
                const rate = total > 0 ? Math.round((entry.successCount / total) * 100) : null;

                return (
                  <tr key={entry.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <span className="text-white text-xs font-medium">{entry.issuePattern}</span>
                      {entry.description && (
                        <span className="text-gray-500 text-xs block mt-0.5">{entry.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                        {entry.issueCategory}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-emerald-400 text-xs">{entry.solution}</code>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {rate !== null ? (
                        <span className={rate >= 70 ? 'text-emerald-400' : rate >= 40 ? 'text-yellow-400' : 'text-red-400'}>
                          {rate}% ({total})
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleAutoApply.mutate(entry)}
                        className={clsx(
                          'flex items-center gap-1 text-xs',
                          entry.autoApply ? 'text-emerald-400' : 'text-gray-600'
                        )}
                      >
                        {entry.autoApply ? (
                          <ToggleRight className="w-4 h-4" />
                        ) : (
                          <ToggleLeft className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteMutation.mutate(entry.id)}
                        className="text-gray-500 hover:text-red-400 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-lg">
          <BookOpen className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <h3 className="text-white font-medium mb-1">No solutions documented</h3>
          <p className="text-gray-500 text-sm">
            Add entries manually or they'll be created automatically when AI finds solutions.
          </p>
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
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4">
      <h3 className="text-white text-sm font-semibold mb-4">New Entry</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Issue Pattern</label>
          <input
            value={form.issuePattern}
            onChange={(e) => setForm({ ...form, issuePattern: e.target.value })}
            placeholder="e.g., nginx service down"
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select
            value={form.issueCategory}
            onChange={(e) => setForm({ ...form, issueCategory: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-300"
          >
            <option value="performance">Performance</option>
            <option value="security">Security</option>
            <option value="availability">Availability</option>
            <option value="update">Update</option>
          </select>
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">Solution (command)</label>
        <input
          value={form.solution}
          onChange={(e) => setForm({ ...form, solution: e.target.value })}
          placeholder="e.g., systemctl restart nginx"
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white font-mono"
        />
      </div>
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={form.autoApply}
            onChange={(e) => setForm({ ...form, autoApply: e.target.checked })}
            className="rounded"
          />
          Auto-apply when matched
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!form.issuePattern || !form.solution}
            className="bg-emerald-500 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
