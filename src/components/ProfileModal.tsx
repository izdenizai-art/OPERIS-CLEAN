import { useState } from 'react';
import { Save, X } from 'lucide-react';
import type { SessionUser } from '@/lib/types';

interface Props {
  user: SessionUser;
  onClose: () => void;
  onSave: (changes: { displayName: string; email: string; department: string; title: string; theme: SessionUser['theme'] }) => Promise<void>;
  onPassword: (password: string) => Promise<void>;
}

export default function ProfileModal({ user, onClose, onSave, onPassword }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [department, setDepartment] = useState(user.department ?? '');
  const [title, setTitle] = useState(user.title ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await onSave({ displayName, email, department, title, theme: user.theme });
      if (password) await onPassword(password);
      onClose();
    } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
    <form onSubmit={save} className="w-full max-w-lg rounded-t-3xl bg-slate-900 p-5 ring-1 ring-slate-700 sm:rounded-3xl">
      <div className="mb-4 flex items-center justify-between"><div><h3 className="font-bold text-white">Profil Bilgilerim</h3><p className="text-xs text-slate-500">@{user.username}</p></div><button type="button" onClick={onClose} className="p-2 text-slate-400"><X className="h-4 w-4" /></button></div>
      <div className="space-y-3">
        <input required value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ad soyad" className="form-control" />
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" className="form-control" />
        <input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Birim / departman" className="form-control" />
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ünvan" className="form-control" />
        <input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="Yeni şifre (değişmeyecekse boş bırakın)" className="form-control" />
      </div>
      <button disabled={busy} className="action-button primary-button mt-4 w-full"><Save className="h-4 w-4" /> {busy ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}</button>
    </form>
  </div>;
}
