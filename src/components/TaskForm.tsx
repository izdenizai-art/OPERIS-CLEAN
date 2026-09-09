import { useState, useEffect } from 'react';
import { X, Flag, Calendar, Clock, AlignLeft, LockKeyhole } from 'lucide-react';
import type { BranchInfo, Task, Priority } from '@/lib/types';
import BranchRecordSelector, { defaultRecordBranch } from './BranchRecordSelector';
import { PRIORITY_LABELS } from '@/lib/types';
import { todayStr } from '@/lib/date';
import { uid } from '@/lib/storage';
import { useRecordLock } from '@/lib/useRecordLock';

interface Props {
  task: Task | null;
  defaultDate?: string;
  onSave: (task: Task) => void;
  onClose: () => void;
  branches: BranchInfo[];
}

export default function TaskForm({ task, defaultDate, onSave, onClose, branches }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [date, setDate] = useState(task?.date ?? defaultDate ?? todayStr());
  const [time, setTime] = useState(task?.time ?? '09:00');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'orta');
  const [branchCode, setBranchCode] = useState(() => defaultRecordBranch(branches, task?.branchCode ?? ''));
  const [error, setError] = useState('');
  const recordLock = useRecordLock('TASKS', task?.id, Boolean(task));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (task && !recordLock.editable) { setError(recordLock.error || 'Kayıt düzenleme kilidi alınamadı.'); return; }
    if (!title.trim()) { setError('Başlık gerekli.'); return; }
    if (!task && !branchCode) { setError('Kayıt yapılacak şubeyi seçin.'); return; }
    const saved: Task = {
      id: task?.id ?? uid(),
      branchCode: task?.branchCode ?? branchCode,
      title: title.trim(),
      description: description.trim(),
      date,
      time,
      priority,
      completed: task?.completed ?? false,
      createdAt: task?.createdAt ?? Date.now(),
    };
    onSave(saved);
  };

  const priorityOptions: Priority[] = ['dusuk', 'orta', 'yuksek'];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-slate-800 rounded-t-3xl sm:rounded-3xl p-6 animate-slide-up sm:animate-fade-in max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">{task ? 'İşi Düzenle' : 'Yeni İş'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {task && (recordLock.loading || recordLock.error) && (
          <div className={`mb-4 flex items-start gap-2 rounded-xl p-3 text-sm ${recordLock.error ? 'bg-red-500/15 text-red-200 ring-1 ring-red-500/40' : 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30'}`}>
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{recordLock.error || 'Düzenleme kilidi alınıyor…'}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <BranchRecordSelector
            branches={branches}
            value={task?.branchCode ?? branchCode}
            onChange={setBranchCode}
            disabled={Boolean(task)}
          />
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
              <span className="font-medium">Başlık</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition"
              placeholder="İş başlığı"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
              <AlignLeft className="w-4 h-4" />
              <span className="font-medium">Açıklama</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition resize-none"
              placeholder="Açıklama (isteğe bağlı)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                <Calendar className="w-4 h-4" />
                <span className="font-medium">Tarih</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Saat</span>
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
              <Flag className="w-4 h-4" />
              <span className="font-medium">Öncelik</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {priorityOptions.map((p) => {
                const active = priority === p;
                const activeCls: Record<Priority, string> = {
                  dusuk: 'bg-emerald-500/20 ring-emerald-500 text-emerald-300',
                  orta: 'bg-amber-500/20 ring-amber-500 text-amber-300',
                  yuksek: 'bg-red-500/20 ring-red-500 text-red-300',
                };
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`py-2.5 rounded-xl text-sm font-medium transition ring-1 ${
                      active
                        ? activeCls[p]
                        : 'bg-slate-900/60 ring-slate-700 text-slate-400 hover:ring-slate-600'
                    }`}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl py-3 transition"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={Boolean(task) && !recordLock.editable}
              className="flex-1 disabled:cursor-not-allowed disabled:opacity-50 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-xl py-3 transition active:scale-[0.98]"
            >
              {task ? 'Kaydet' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
