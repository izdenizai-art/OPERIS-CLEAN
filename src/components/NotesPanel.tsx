import { useState } from 'react';
import { Edit3, Save, StickyNote, Trash2, X } from 'lucide-react';
import type { NoteColor, UserNote } from '@/lib/types';

interface Props {
  notes: UserNote[];
  onCreate: (input: { title: string; content: string; color: NoteColor }) => Promise<void>;
  onUpdate: (id: string, input: { title: string; content: string; color: NoteColor }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const COLORS: { value: NoteColor; label: string; className: string }[] = [
  { value: 'yellow', label: 'Sarı', className: 'bg-yellow-300' },
  { value: 'red', label: 'Kırmızı', className: 'bg-red-500' },
  { value: 'orange', label: 'Turuncu', className: 'bg-orange-400' },
  { value: 'darkGreen', label: 'Koyu Yeşil', className: 'bg-emerald-800' },
  { value: 'turquoise', label: 'Turkuaz', className: 'bg-cyan-400' },
];

export default function NotesPanel({ notes, onCreate, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState<UserNote | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState<NoteColor>('yellow');
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setEditing(null); setTitle(''); setContent(''); setColor('yellow'); setShowForm(true);
  };

  const openEdit = (note: UserNote) => {
    setEditing(note); setTitle(note.title); setContent(note.content); setColor(note.color); setShowForm(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      if (editing) await onUpdate(editing.id, { title, content, color });
      else await onCreate({ title, content, color });
      setShowForm(false); setEditing(null); setTitle(''); setContent('');
    } finally { setBusy(false); }
  };

  return (
    <section className="corporate-panel h-full">
      <div className="corporate-panel-header">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><StickyNote className="h-4 w-4 text-amber-300" /> Kişisel Notlar</h3>
        <button type="button" onClick={openNew} className="dashboard-window-button ui-button ui-button-compact ui-button-primary">+ Yeni Not</button>
      </div>

      <div className="max-h-[460px] space-y-2 overflow-y-auto p-2">
        {notes.length ? notes.map(note => (
          <article key={note.id} data-note-color={note.color} className={`personal-note-card rounded-xl p-3 shadow-sm ${noteClass(note.color)}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {note.title && <h4 className="truncate text-sm font-bold">{note.title}</h4>}
                <span className="record-branch-badge mt-1">{note.branchCode || '---'}</span>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{note.content}</p>
                <p className="mt-2 text-[10px] opacity-70">{new Date(note.updatedAt).toLocaleString('tr-TR')}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => openEdit(note)} className="rounded-lg bg-black/10 p-1.5 hover:bg-black/20"><Edit3 className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void onDelete(note.id)} className="rounded-lg bg-black/10 p-1.5 hover:bg-black/20"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </article>
        )) : <div className="py-12 text-center text-slate-500"><StickyNote className="mx-auto mb-2 h-8 w-8 opacity-40" /><p className="text-sm">Henüz kişisel notunuz yok.</p></div>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
          <form onSubmit={submit} className="w-full max-w-lg rounded-t-3xl bg-slate-900 p-5 ring-1 ring-slate-700 sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-white">{editing ? 'Notu Düzenle' : 'Yeni Not'}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 text-slate-400"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Başlık (isteğe bağlı)" className="form-control" />
              <textarea required rows={6} value={content} onChange={e => setContent(e.target.value)} maxLength={4000} placeholder="Notunuzu yazın" className="form-control resize-y" />
              <div className="grid grid-cols-5 gap-2">
                {COLORS.map(option => (
                  <button key={option.value} type="button" onClick={() => setColor(option.value)}
                    className={`flex h-10 items-center justify-center rounded-lg ring-2 ${option.className} ${color === option.value ? 'ring-white' : 'ring-transparent'}`}
                    title={option.label}>{color === option.value && <span className="text-xs font-bold text-white">✓</span>}</button>
                ))}
              </div>
              <button disabled={busy} className="action-button primary-button w-full"><Save className="h-4 w-4" /> {busy ? 'Kaydediliyor…' : 'Notu Kaydet'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function noteClass(color: NoteColor) {
  if (color === 'red') return 'bg-red-500 text-white';
  if (color === 'orange') return 'bg-orange-400 text-slate-950';
  if (color === 'darkGreen') return 'bg-emerald-800 text-white';
  if (color === 'turquoise') return 'bg-cyan-400 text-slate-950';
  return 'bg-yellow-300 text-slate-950';
}
