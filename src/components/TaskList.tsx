import { CheckCircle2, Circle, Pencil, Trash2, AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import type { Task } from '@/lib/types';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/lib/types';
import { sectionOf, SECTION_LABELS, remainingTime, isOverdue, formatTurkishDay } from '@/lib/date';

interface Props {
  tasks: Task[];
  onToggle: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  notifyMinutesBefore: number;
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
}

const SECTIONS: Array<'today' | 'tomorrow' | 'week' | 'later'> = ['today', 'tomorrow', 'week', 'later'];

export default function TaskList({
  tasks, onToggle, onEdit, onDelete, onRestore, notifyMinutesBefore, canEdit, canDelete, isAdmin,
}: Props) {
  const visible = tasks.filter(task => !task.deletedAt);
  const deleted = isAdmin ? tasks.filter(task => Boolean(task.deletedAt)) : [];
  const active = visible.filter(task => !task.completed);
  const done = visible.filter(task => task.completed);

  const grouped = SECTIONS.map(section => ({
    section,
    items: active.filter(task => sectionOf(task.date) === section),
  })).filter(group => group.items.length > 0);

  return (
    <div className="space-y-6">
      {grouped.length === 0 && done.length === 0 && deleted.length === 0 && (
        <div className="py-20 text-center text-slate-500">
          <Clock className="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p>Henüz iş eklenmedi.</p>
        </div>
      )}

      {grouped.map(({ section, items }) => (
        <div key={section}>
          <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            {SECTION_LABELS[section]} <span className="text-slate-600">({items.length})</span>
          </h3>
          <div className="space-y-2">
            {items.map(task => <TaskCard key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} notifyMinutesBefore={notifyMinutesBefore} canEdit={canEdit} canDelete={canDelete} />)}
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Tamamlananlar <span className="text-slate-600">({done.length})</span>
          </h3>
          <div className="space-y-2">
            {done.map(task => <TaskCard key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} notifyMinutesBefore={notifyMinutesBefore} canEdit={canEdit} canDelete={canDelete} />)}
          </div>
        </div>
      )}

      {deleted.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wide text-red-400">
            <Trash2 className="h-4 w-4" /> Silinen Kayıtlar <span>({deleted.length})</span>
          </h3>
          <div className="space-y-2">
            {deleted.map(task => <TaskCard key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} notifyMinutesBefore={notifyMinutesBefore} canEdit={false} canDelete={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task, onToggle, onEdit, onDelete, onRestore, notifyMinutesBefore, canEdit, canDelete,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  notifyMinutesBefore: number;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const deleted = Boolean(task.deletedAt);
  const overdue = !deleted && isOverdue(task.date, task.time, task.completed);
  const remaining = remainingTime(task.date, task.time);
  const targetAt = new Date(`${task.date}T${task.time || '00:00'}:00`).getTime();
  const approaching = !deleted && !task.completed && !overdue && Date.now() >= targetAt - notifyMinutesBefore * 60_000 && Date.now() <= targetAt;

  return (
    <div className={`rounded-2xl p-4 ring-1 transition-all ${
      deleted ? 'border-2 border-red-500 bg-red-950/30 ring-red-500/50' :
      task.completed ? 'bg-slate-800/30 ring-slate-700/40 opacity-60' :
      overdue ? 'bg-red-950/40 ring-red-800/60' :
      approaching ? 'bg-orange-500/20 ring-orange-400/70' :
      'bg-slate-800/60 ring-slate-700/50'
    }`}>
      <div className="flex items-start gap-3">
        {!deleted && (
          <button onClick={() => canEdit && onToggle(task.id)} disabled={!canEdit} className="mt-0.5 shrink-0 disabled:opacity-50">
            {task.completed ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <Circle className="h-6 w-6 text-slate-500" />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={`font-semibold ${deleted ? 'text-red-200 line-through' : 'text-white'} ${task.completed ? 'line-through' : ''}`}>{task.title}</h4>
            <span className="record-branch-badge">{task.branchCode || '---'}</span>
            {deleted && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">SİLİNDİ</span>}
            {!deleted && <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}22`, color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>}
          </div>
          {task.description && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{task.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-400">{formatTurkishDay(new Date(task.date + 'T00:00'))} · {task.time}</span>
            {deleted ? <span className="font-semibold text-red-300">{task.deletedByName || 'Yönetici'} tarafından silindi</span> :
              !task.completed && <span className={`flex items-center gap-1 font-medium ${overdue ? 'text-red-400' : approaching ? 'text-orange-300' : 'text-sky-300'}`}>{overdue && <AlertTriangle className="h-3 w-3" />}{remaining}</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          {deleted ? (
            <button onClick={() => onRestore(task.id)} className="rounded-lg bg-emerald-500/15 p-2 text-emerald-300 hover:bg-emerald-500/25" title="Geri yükle"><RotateCcw className="h-4 w-4" /></button>
          ) : (
            <>
              {canEdit && <button onClick={() => onEdit(task)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-sky-400"><Pencil className="h-4 w-4" /></button>}
              {canDelete && <button onClick={() => onDelete(task.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
