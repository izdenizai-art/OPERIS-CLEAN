import { useState, useMemo, useRef } from 'react';
import { Plus, Pencil, Trash2, Eye, EyeOff, Download, Upload, Search, FolderOpen, KeyRound, FileSpreadsheet, RotateCcw } from 'lucide-react';
import type { BranchInfo, Credential, SectionPermissions } from '@/lib/types';
import BranchRecordSelector, { defaultRecordBranch } from './BranchRecordSelector';
import { uid } from '@/lib/storage';
import { formatTurkishDate } from '@/lib/date';
import { exportCredentialsExcel } from '@/lib/excel';
import { useRecordLock } from '@/lib/useRecordLock';

interface Props {
  credentials: Credential[];
  onSave: (c: Credential) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  isAdmin: boolean;
  onImportExcel: (file: File) => Promise<void>;
  onDownloadTemplate: () => void;
  permissions: SectionPermissions;
  branches: BranchInfo[];
}

export default function CredentialsVault({
  credentials,
  onSave,
  onDelete,
  onRestore,
  isAdmin,
  onImportExcel,
  onDownloadTemplate,
  permissions,
  branches,
}: Props) {
  const [editing, setEditing] = useState<Credential | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('__all__');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recordLock = useRecordLock('CREDENTIALS', editing?.id, showForm && Boolean(editing));

  const groups = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach((c) => set.add(c.groupName || 'Genel'));
    return ['__all__', ...Array.from(set).sort()];
  }, [credentials]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return credentials
      .filter((c) => activeGroup === '__all__' || (c.groupName || 'Genel') === activeGroup)
      .filter((c) => !q || c.username.toLowerCase().includes(q) || c.ip.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.groupName.toLowerCase().includes(q))
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.username.localeCompare(b.username));
  }, [credentials, query, activeGroup]);

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNew = () => {
    if (!permissions.canCreate) return;
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (c: Credential) => {
    if (!permissions.canEdit) return;
    setEditing(c);
    setShowForm(true);
  };

  const handleImportFile = async (file?: File) => {
    if (!permissions.canExcel || !file) return;
    setImporting(true);
    try {
      await onImportExcel(file);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Bilgilerde ara..."
            className="w-full bg-slate-800/60 text-white rounded-xl pl-10 pr-4 py-2.5 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition text-sm"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleImportFile(e.target.files?.[0])}
        />
        {permissions.canExcel && <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition"
        >
          <Upload className="w-4 h-4" /> {importing ? 'Yükleniyor…' : 'Excel Yükle'}
        </button>}
        {permissions.canExcel && <button
          onClick={() => {
            const ok = window.confirm('Dışa aktarılacak Excel dosyası şifreleri açık metin olarak içerir. Güvenli bir yerde saklayacağınızı onaylıyor musunuz?');
            if (ok) exportCredentialsExcel(credentials);
          }}
          disabled={credentials.length === 0}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition"
        >
          <Download className="w-4 h-4" /> Excel
        </button>}
        {permissions.canCreate && <button
          onClick={handleNew}
          className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition"
        >
          <Plus className="w-4 h-4" /> Yeni
        </button>}
      </div>

      {permissions.canExcel && <section className="rounded-2xl bg-slate-800/60 p-4 ring-1 ring-slate-700/50">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">Toplu bilgi yükleme</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Excel dosyanızdaki “Bilgiler” sayfasından Grup, Kullanıcı Adı, Şifre,
              IP / Network ve Açıklama sütunları topluca eklenir.
            </p>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
            >
              <Download className="h-4 w-4" /> Bilgiler Excel şablonunu indir
            </button>
          </div>
        </div>
      </section>}

      {groups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`shrink-0 text-sm px-3 py-1.5 rounded-full font-medium transition ring-1 ${
                activeGroup === g
                  ? 'bg-sky-500/20 ring-sky-500 text-sky-300'
                  : 'bg-slate-800/60 ring-slate-700 text-slate-400 hover:ring-slate-600'
              }`}
            >
              {g === '__all__' ? 'Tümü' : g}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{credentials.length === 0 ? 'Henüz bilgi eklenmedi.' : 'Aramanızla eşleşen kayıt yok.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className={`${c.deletedAt ? 'border-2 border-red-500 bg-red-950/30' : 'bg-slate-800/60 ring-1 ring-slate-700/50'} rounded-xl p-3 animate-fade-in`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className={`text-sm font-semibold ${c.deletedAt ? 'text-red-200 line-through' : 'text-sky-300'}`}>{c.groupName || 'Genel'} {c.deletedAt && <span className="ml-1 rounded bg-red-500 px-1.5 py-0.5 text-[9px] text-white">SİLİNDİ</span>}</span>
                  <span className="record-branch-badge">{c.branchCode || '---'}</span>
                </div>
                {(permissions.canEdit || permissions.canDelete) && <div className="flex gap-1">
                  {!c.deletedAt && permissions.canEdit && <button onClick={() => handleEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-sky-400 transition">
                    <Pencil className="w-4 h-4" />
                  </button>}
                  {c.deletedAt && isAdmin ? <button onClick={() => onRestore(c.id)} className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/15"><RotateCcw className="w-4 h-4" /></button> : permissions.canDelete && <button onClick={() => onDelete(c.id)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-red-400 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>}
                </div>}
              </div>

              <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2 text-xs">
                <Field label="Kullanıcı Adı" value={c.username} />
                <div>
                  <p className="text-[11px] text-slate-500">Şifre</p>
                  <div className="flex items-center gap-2">
                    <code className="text-white font-mono text-xs flex-1 truncate">
                      {revealed.has(c.id) ? c.password : '••••••••'}
                    </code>
                    <button onClick={() => toggleReveal(c.id)} className="p-1 rounded text-slate-400 hover:text-sky-400 transition">
                      {revealed.has(c.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Field label="IP / Network" value={c.ip} mono />
                <Field label="Açıklama" value={c.description} />
              </div>

              <p className="text-[11px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-700/40">
                Son değiştirilme: {formatTurkishDate(new Date(c.lastChanged))}
              </p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <>
        {editing && (recordLock.loading || recordLock.error) && (
          <div className={`fixed left-1/2 top-4 z-[120] -translate-x-1/2 rounded-xl px-4 py-3 text-sm shadow-xl ${recordLock.error ? 'bg-red-700 text-white' : 'bg-sky-700 text-white'}`}>
            {recordLock.error || 'Düzenleme kilidi alınıyor…'}
          </div>
        )}
        <CredentialForm
          credential={editing}
          branches={branches}
          onSave={onSave}
          onClose={() => setShowForm(false)}
        lockEditable={!editing || recordLock.editable}
        />
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-white ${mono ? 'font-mono' : ''} truncate`}>{value || '—'}</p>
    </div>
  );
}

function CredentialForm({ credential, branches, onSave, onClose, lockEditable }: {
  credential: Credential | null;
  branches: BranchInfo[];
  onSave: (c: Credential) => void;
  onClose: () => void;
  lockEditable: boolean;
}) {
  const [groupName, setGroupName] = useState(credential?.groupName ?? '');
  const [username, setUsername] = useState(credential?.username ?? '');
  const [password, setPassword] = useState(credential?.password ?? '');
  const [ip, setIp] = useState(credential?.ip ?? '');
  const [description, setDescription] = useState(credential?.description ?? '');
  const [branchCode, setBranchCode] = useState(() => defaultRecordBranch(branches, credential?.branchCode ?? ''));
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (credential && !lockEditable) {
      setError('Bu kayıt başka bir kullanıcı tarafından düzenleniyor.');
      return;
    }
    if (!username.trim() && !password.trim() && !ip.trim()) {
      setError('En az bir alan doldurun.');
      return;
    }
    if (!credential && !branchCode) {
      setError('Kayıt yapılacak şubeyi seçin.');
      return;
    }
    const saved: Credential = {
      id: credential?.id ?? uid(),
      branchCode: credential?.branchCode ?? branchCode,
      groupName: groupName.trim() || 'Genel',
      username: username.trim(),
      password: password.trim(),
      ip: ip.trim(),
      description: description.trim(),
      lastChanged: Date.now(),
      createdAt: credential?.createdAt ?? Date.now(),
    };
    onSave(saved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-slate-800 rounded-t-3xl sm:rounded-3xl p-6 animate-slide-up sm:animate-fade-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">{credential ? 'Bilgiyi Düzenle' : 'Yeni Bilgi'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-700 text-slate-400">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <BranchRecordSelector
            branches={branches}
            value={credential?.branchCode ?? branchCode}
            onChange={setBranchCode}
            disabled={Boolean(credential)}
          />
          <div>
            <label className="block text-sm text-slate-300 mb-2">Grup / Başlık</label>
            <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)}
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition"
              placeholder="Örn: Sunucular, Veritabanı..." />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Kullanıcı Adı</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Şifre</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 pr-12 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-sky-400"
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">IP / Network</label>
            <input type="text" value={ip} onChange={(e) => setIp(e.target.value)}
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition font-mono"
              placeholder="192.168.1.1" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Açıklama</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full bg-slate-900/60 text-white rounded-xl px-4 py-3 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none transition resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl py-3 transition">İptal</button>
            <button type="submit" disabled={Boolean(credential) && !lockEditable} className="flex-1 disabled:cursor-not-allowed disabled:opacity-50 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-xl py-3 transition">Kaydet</button>
          </div>
        </form>
      </div>
    </div>
  );
}
