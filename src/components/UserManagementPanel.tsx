import { useState } from 'react';
import { Shield, UserPlus, Trash2, KeyRound, Save } from 'lucide-react';
import { api } from '@/lib/api';
import type { BranchHelpDeskPermissions, BranchInfo, BranchRole, SessionUser, UserPermissions, SectionPermissions } from '@/lib/types';
import { BRANCH_MANAGER_HELPDESK, BRANCH_MANAGER_PERMISSIONS, EMPTY_BRANCH_HELPDESK, cloneBranchHelpDesk, cloneUserPermissions } from '@/lib/branchRoles';

interface Props {
  users: SessionUser[];
  branches: BranchInfo[];
  currentUser: SessionUser;
  onCreate: (input: {
    username: string; displayName: string; email: string; department: string; password: string; isAdmin: boolean; permissions: UserPermissions;
    assignments: Array<{
      branchCode: string; isPrimary: boolean; role: BranchRole; permissions: UserPermissions;
      helpDesk: BranchHelpDeskPermissions;
    }>;
  }) => Promise<void>;
  onUpdate: (id: string, changes: { displayName: string; email: string; department: string; active: boolean; isAdmin: boolean; permissions: UserPermissions }) => Promise<void>;
  onResetPassword: (id: string, password: string) => Promise<void>;
  onDelete: (id: string) => void;
}

const DEFAULT_SECTION: SectionPermissions = {
  canView: true,
  canCreate: true,
  canEdit: false,
  canDelete: false,
  canExcel: false,
};

const DEFAULT_ASSET_PERMISSIONS: UserPermissions['assets'] = {
  dashboardView: false,
  cardsView: false,
  cardsCreate: false,
  cardsEdit: false,
  cardsDelete: false,
  assignmentsView: false,
  assignmentsCreate: false,
  assignmentsReturn: false,
  transfersView: false,
  transfersCreate: false,
  transfersApprove: false,
  countsView: false,
  countsCreate: false,
  countsScan: false,
  countsReview: false,
  countsCorrect: false,
  countsComplete: false,
  countsApprove: false,
  locationsView: false,
  locationsManage: false,
  labelsView: false,
  labelsDesign: false,
  labelsPrint: false,
  documentsView: false,
  documentsPrint: false,
  reportsView: false,
  reportsExport: false,
  integrationsView: false,
  integrationsManage: false,
};

const DEFAULT_PERMISSIONS: UserPermissions = {
  tasks: { ...DEFAULT_SECTION },
  credentials: { ...DEFAULT_SECTION },
  tracking: { ...DEFAULT_SECTION },
  network: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExcel: false },
  canAccessSettings: false,
  canManageUsers: false,
  canManageBranches: false,
  canAssignUserBranches: false,
  canSendBranchAnnouncements: false,
  canAccessAssets: false,
  assets: { ...DEFAULT_ASSET_PERMISSIONS },
};

const strongPassword = (value: string) =>
  value.length >= 8 &&
  /[A-ZÇĞİÖŞÜ]/u.test(value) &&
  /[a-zçğıöşü]/u.test(value) &&
  /[0-9]/.test(value) &&
  /[^\p{L}\p{N}\s]/u.test(value);

type CreateAssignment = {
  branchCode: string;
  isPrimary: boolean;
  role: BranchRole;
  permissions: UserPermissions;
  helpDesk: BranchHelpDeskPermissions;
};

const isSuperAdminUsername = (value: string) =>
  value.trim().normalize('NFKC').replace(/[Iİı]/g, 'i').toLowerCase() === 'balamir';


export default function UserManagementPanel({ users, branches, currentUser, onCreate, onUpdate, onResetPassword, onDelete }: Props) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [password, setPassword] = useState('');
  const [isAdminRole,setIsAdminRole]=useState(false);
  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);
  const [assignments, setAssignments] = useState<CreateAssignment[]>([]);
  const [busy, setBusy] = useState(false);

  if (!currentUser.isAdmin && !currentUser.permissions.canManageUsers) return null;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!strongPassword(password)) {
      alert('Şifre en az 8 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.');
      return;
    }
    if(isSuperAdminUsername(username)){
      alert('balamir kullanıcı adı ve büyük/küçük harf varyasyonları Süper Admin hesabına rezerve edilmiştir.');
      return;
    }
    if (!assignments.length) { alert('En az bir şube seçilmelidir.'); return; }
    if (assignments.filter(item => item.isPrimary).length !== 1) { alert('Tam olarak bir birincil şube seçilmelidir.'); return; }
    setBusy(true);
    try {
      const primary = assignments.find(item => item.isPrimary)!;
      await onCreate({ username, displayName, email, department, password, isAdmin:isAdminRole, permissions: primary.permissions, assignments });
      setUsername(''); setDisplayName(''); setEmail(''); setDepartment(''); setPassword(''); setIsAdminRole(false);
      setPermissions(DEFAULT_PERMISSIONS); setAssignments([]);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kullanıcı oluşturulamadı.');
    } finally { setBusy(false); }
  };

  return (
    <section className="panel-card space-y-4">
      <h3 className="panel-title"><Shield className="w-5 h-5 text-violet-400" /> Kullanıcı ve Yetki Yönetimi</h3>

      <form onSubmit={create} className="space-y-3 rounded-xl bg-slate-900/40 p-3 ring-1 ring-slate-700">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="Kullanıcı adı"
            className="rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ad soyad"
            className="rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="E-posta adresi"
            className="rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
          <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Birim / departman"
            className="rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
        </div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
          placeholder="Geçici şifre: 8+ karakter, büyük/küçük/rakam/özel karakter"
          className="w-full rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
        <label className="block text-xs font-semibold text-slate-300">
          Kullanıcı Rolü
          <select value={isAdminRole?'ADMIN':'USER'} onChange={e=>setIsAdminRole(e.target.value==='ADMIN')}
            className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500">
            <option value="USER">Standart Kullanıcı</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        {isAdminRole&&<p className="rounded-lg bg-violet-950/40 p-2 text-xs text-violet-200 ring-1 ring-violet-700/50">
          Admin rolü OPERİS merkezi yönetim yetkilerinin tamamına sahiptir.
        </p>}
        <fieldset className="rounded-xl bg-slate-950/40 p-3 ring-1 ring-slate-700">
          <legend className="px-2 text-sm font-semibold text-cyan-300">Şube Atamaları ve Help Desk Rolleri</legend>
          <p className="mb-3 text-xs text-slate-400">
            Bir kullanıcı aynı anda birden fazla şubede Şube Yetkilisi olabilir. Rol, OPERİS ve Help Desk yetkileri her şube için bağımsız kaydedilir.
          </p>
          <div className="space-y-2">
            {branches.filter(branch => branch.active).map(branch => {
              const item = assignments.find(value => value.branchCode === branch.code);
              return (
                <div key={branch.code} className="rounded-lg bg-slate-900/70 p-2 ring-1 ring-slate-700/70">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-white">
                      <input type="checkbox" checked={Boolean(item)}
                        onChange={(event) => {
                          const checked=event.target.checked;
                          setAssignments(current => {
                            if(!checked){
                              const next=current.filter(value=>value.branchCode!==branch.code);
                              if(next.length&&!next.some(value=>value.isPrimary))next[0]={...next[0],isPrimary:true};
                              return next;
                            }
                            return [...current,{
                              branchCode:branch.code,
                              isPrimary:current.length===0,
                              role:'USER',
                              permissions:cloneUserPermissions(permissions),
                              helpDesk:cloneBranchHelpDesk(EMPTY_BRANCH_HELPDESK),
                            }];
                          });
                        }} />
                      {branch.code} — {branch.name}
                    </label>
                    {item && <label className="flex items-center gap-2 text-xs text-sky-300">
                      <input type="radio" name="primaryBranch" checked={item.isPrimary}
                        onChange={() => setAssignments(current=>current.map(value=>({...value,isPrimary:value.branchCode===branch.code})))} />
                      Birincil şube
                    </label>}
                  </div>
                  {item && <div className="mt-3 space-y-3">
                    <label className="block text-xs font-semibold text-slate-300">
                      Şube Rolü
                      <select
                        value={item.role}
                        onChange={event=>setAssignments(current=>current.map(value=>{
                          if(value.branchCode!==branch.code)return value;
                          const role=event.target.value as BranchRole;
                          return role==='BRANCH_MANAGER'
                            ? {...value,role,permissions:cloneUserPermissions(BRANCH_MANAGER_PERMISSIONS),helpDesk:cloneBranchHelpDesk(BRANCH_MANAGER_HELPDESK)}
                            : {...value,role};
                        }))}
                        className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700"
                      >
                        <option value="USER">Standart Kullanıcı</option>
                        <option value="BRANCH_MANAGER">Şube Yetkilisi</option>
                      </select>
                    </label>
                    {item.role==='BRANCH_MANAGER'&&<p className="rounded-lg bg-cyan-950/30 p-2 text-xs text-cyan-200 ring-1 ring-cyan-700/50">
                      Şube Yetkilisi bu şubede tam operasyon, demirbaş, Network, Dashboard, Help Desk ve şube duyuru preset'i ile başlar. Rol aynı kalırken bu şubedeki tekil yetkiler Admin tarafından değiştirilebilir; diğer şubelerdeki rol ve yetkiler etkilenmez.
                    </p>}
                    <div className="rounded-lg bg-slate-950/50 p-2 ring-1 ring-slate-700/50">
                      <p className="mb-2 text-xs font-semibold text-slate-300">Bu şubeye özel OPERİS yetkileri</p>
                      <PermissionEditor value={item.permissions}
                        onChange={(nextPermissions)=>setAssignments(current=>current.map(value=>value.branchCode===branch.code?{...value,permissions:nextPermissions}:value))} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {([
                        ['canOpen','Ticket açabilir'],
                        ['canCoordinate','Ticket Açma/Takip Koordinatörü'],
                        ['canRespond','Atanmış Ticketa Cevap Yazabilir'],
                        ['canViewAll','Şubenin Tüm Ticketlarını Görebilir'],
                        ['canAssign','Atama Yapabilir / Değiştirebilir / Boşa Çıkarabilir'],
                        ['canChangeStatus','Ticket Durumu Değiştirebilir'],
                        ['canClose','Ticket Kapatabilir'],
                        ['canReopen','Kapanmış Ticketı Açabilir'],
                        ['canReport','Şube Ticket Dashboard/Raporlarını Görebilir'],
                        ['canTopics','Kategori / Konu Yönetebilir'],
                        ['canCannedReplies','Hazır Cevap Yönetebilir'],
                        ['canKnowledge','Bilgi Bankası Yönetebilir'],
                      ] as const).map(([key,label])=>(
                        <label key={key} className="flex items-start gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={item.helpDesk[key]}
                            onChange={(event)=>setAssignments(current=>current.map(value=>{
                              if(value.branchCode!==branch.code)return value;
                              const next={...value.helpDesk,[key]:event.target.checked};
                              if(key==='canAssign'&&event.target.checked)next.canCoordinate=true;
                              if(key==='canViewAll'&&event.target.checked)next.canCoordinate=true;
                              return {...value,helpDesk:next};
                            }))} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Koordinatör açık ticketlara cevap yazabilir ve atamayı yönetebilir. Cevaplayan kullanıcı boşta açık ticketı üzerine alabilir;
                      mevcut atamayı değiştiremez ve yalnız kendisine atanmış ticketa görevli cevabı yazar.
                    </p>
                  </div>}
                </div>
              );
            })}
          </div>
        </fieldset>
        {!isAdminRole&&<div className="rounded-xl bg-slate-950/40 p-3 ring-1 ring-slate-700/60">
          <p className="mb-2 text-xs font-semibold text-slate-300">Yeni seçilecek şubeler için yetki şablonu</p>
          <PermissionEditor value={permissions} onChange={setPermissions} />
        </div>}
        <button disabled={busy} className="w-full action-button primary-button">
          <UserPlus className="w-4 h-4" /> {busy ? 'Oluşturuluyor…' : 'Kullanıcı Oluştur'}
        </button>
      </form>

      <div className="space-y-3">
        {users.map((user) => (
          <UserCard key={user.id} user={user} onUpdate={onUpdate} onResetPassword={onResetPassword} onDelete={onDelete} />
        ))}
      </div>
    </section>
  );
}

function UserCard({ user, onUpdate, onResetPassword, onDelete }: {
  user: SessionUser;
  onUpdate: Props['onUpdate'];
  onResetPassword: Props['onResetPassword'];
  onDelete: Props['onDelete'];
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [department, setDepartment] = useState(user.department ?? '');
  const [expanded, setExpanded] = useState(false);
  const [directoryChangeUnread,setDirectoryChangeUnread]=useState(Boolean(user.directoryChangeUnread));
  const [active, setActive] = useState(user.active);
  const [permissions, setPermissions] = useState(user.permissions);
  const isSuperAdminUser=isSuperAdminUsername(user.username);
  const [isAdminRole,setIsAdminRole]=useState(user.isAdmin);

  const [saving, setSaving] = useState(false);

  const save = async () => {
    if(isSuperAdminUser){alert('balamir Süper Admin hesabı bu ekrandan değiştirilemez.');return;}
    setSaving(true);
    try {
      await onUpdate(user.id, { displayName, email, department, active, isAdmin:isAdminRole, permissions });
      alert('Kullanıcı ve yetkileri başarıyla güncellendi.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Güncelleme başarısız.');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    const password = prompt(`${user.username} için yeni geçici şifreyi girin:`);
    if (!password) return;
    if (!strongPassword(password)) { alert('Şifre en az 8 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.'); return; }
    try {
      await onResetPassword(user.id, password);
      alert('Şifre güncellendi.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Şifre güncellenemedi.');
    }
  };

  return (
    <div className={`rounded-xl bg-slate-900/40 p-3 ring-1 ${directoryChangeUnread ? 'ring-emerald-400/80' : 'ring-slate-700'}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{user.username}</p>
          <p className="text-xs text-slate-500">{user.isAdmin ? 'Yönetici' : user.active ? 'Aktif kullanıcı' : 'Pasif kullanıcı'}{user.directorySource === 'AD' ? ' · Domain' : ''}</p>
        </div>
        {!user.isAdmin && user.directorySource !== 'AD' && (
          <button onClick={() => {
            if (confirm(`${user.username} kullanıcısı silinsin mi?`)) onDelete(user.id);
          }} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10" aria-label="Kullanıcıyı sil">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <button type="button" onClick={() => {
        const next=!expanded;
        setExpanded(next);
        if(next&&directoryChangeUnread&&user.directorySource==='AD'){
          void api.acknowledgeDomainUserChange(user.id).then(()=>setDirectoryChangeUnread(false)).catch(()=>{});
        }
      }} className="mb-2 w-full rounded-lg bg-slate-800/70 px-3 py-2 text-left text-xs text-sky-300">
        {expanded ? 'Kullanıcı bilgilerini kapat' : 'Kullanıcı bilgilerini aç'}
      </button>
      {expanded && <>
      {user.directorySource === 'AD' && <div className="mb-3 rounded-lg bg-slate-950/50 p-3 text-xs ring-1 ring-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-emerald-300">DC Kullanıcı Bilgisi</strong>
          <span className="text-slate-400">{user.directoryLastChangeAt ? `Son DC değişimi: ${new Date(user.directoryLastChangeAt).toLocaleString('tr-TR')}` : 'Henüz kayıtlı DC değişimi yok'}</span>
        </div>
        {user.directoryLastChanges?.length ? <div className="mt-2 space-y-1">
          {user.directoryLastChanges.map((change,index)=><div key={`${change.field}-${index}`} className="grid gap-1 rounded-md bg-slate-900/70 p-2 sm:grid-cols-[140px_1fr]">
            <span className="font-semibold text-slate-300">{change.label}</span>
            <span className="break-words text-slate-400">{String(change.oldValue ?? '—')} → <b className="text-emerald-300">{String(change.newValue ?? '—')}</b></span>
          </div>)}
        </div> : <p className="mt-2 text-slate-500">DC'den alan değişikliği kaydedilmemiş.</p>}
      </div>}
      {user.directorySource === 'AD' && <p className="mb-3 rounded-lg bg-cyan-950/30 p-2 text-xs text-cyan-200 ring-1 ring-cyan-700/50">
        Ad Soyad, e-posta, birim, aktiflik ve parola Active Directory tarafından yönetilir. OPERİS yetkileri bu ekrandan düzenlenebilir.
      </p>}
      {isSuperAdminUser
        ? <div className="mb-3 rounded-lg bg-violet-950/40 p-3 text-xs text-violet-100 ring-1 ring-violet-700/60">
            <strong>Süper Admin · balamir</strong>
            <p className="mt-1 text-violet-200/80">Rol, yetki, aktiflik, şube ve parola ayarları başka kullanıcılar tarafından değiştirilemez. Profil bilgilerini yalnız hesap sahibi kendi profilinden günceller.</p>
          </div>
        : <label className="mb-3 block text-xs font-semibold text-slate-300">
            OPERİS Kullanıcı Rolü
            <select value={isAdminRole?'ADMIN':'USER'} onChange={e=>setIsAdminRole(e.target.value==='ADMIN')}
              className="mt-1 w-full rounded-xl bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700">
              <option value="USER">Standart Kullanıcı</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>}
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={user.directorySource === 'AD' || isSuperAdminUser}
        className="mb-3 w-full rounded-xl bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700 disabled:cursor-not-allowed disabled:opacity-60" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-posta" disabled={user.directorySource === 'AD' || isSuperAdminUser}
        className="mb-3 w-full rounded-xl bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700 disabled:cursor-not-allowed disabled:opacity-60" />
      <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Birim / departman" disabled={user.directorySource === 'AD' || isSuperAdminUser}
        className="mb-3 w-full rounded-xl bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700 disabled:cursor-not-allowed disabled:opacity-60" />
          {!isAdminRole && !isSuperAdminUser && <PermissionEditor value={permissions} onChange={setPermissions} />}
          {!isAdminRole && <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={active} disabled={user.directorySource === 'AD' || isSuperAdminUser} onChange={(e) => setActive(e.target.checked)} /> Kullanıcı aktif
          </label>}
          {!isSuperAdminUser && <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={saving} onClick={() => void save()} className="action-button secondary-button">
              <Save className="w-4 h-4" /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            {user.directorySource !== 'AD'
              ? <button onClick={() => void resetPassword()} className="action-button secondary-button"><KeyRound className="w-4 h-4" /> Şifre</button>
              : <button disabled className="action-button secondary-button opacity-50"><KeyRound className="w-4 h-4" /> Parola DC'de</button>}
          </div>}
        </>}
    </div>
  );
}

function PermissionEditor({ value, onChange }: { value: UserPermissions; onChange: (value: UserPermissions) => void }) {
  return (
    <div className="space-y-3">
      <SectionPermissionEditor title="İşler / Takvim" value={value.tasks} onChange={(tasks) => onChange({ ...value, tasks })} />
      <SectionPermissionEditor title="Bilgiler" value={value.credentials} onChange={(credentials) => onChange({ ...value, credentials })} />
      <SectionPermissionEditor title="Takip" value={value.tracking} onChange={(tracking) => onChange({ ...value, tracking })} />
      <SectionPermissionEditor
        title="Network İzleme"
        value={value.network}
        excelLabel="Manuel ping testi"
        onChange={(network) => onChange({ ...value, network })}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PermissionToggle
          checked={value.canAccessSettings}
          label="Ayarlara erişim"
          onChange={(checked) => onChange({ ...value, canAccessSettings: checked })}
        />
        <PermissionToggle
          checked={value.canManageUsers}
          label="Kullanıcı yönetimi"
          onChange={(checked) => onChange({ ...value, canManageUsers: checked, canAccessSettings: checked || value.canAccessSettings })}
        />
        <PermissionToggle
          checked={value.canManageBranches}
          label="Şube oluşturma / düzenleme / silme"
          onChange={(checked) => onChange({ ...value, canManageBranches: checked, canAccessSettings: checked || value.canAccessSettings })}
        />
        <PermissionToggle
          checked={value.canAssignUserBranches}
          label="Kullanıcıyı şubeye atama / şube yetkisini değiştirme"
          onChange={(checked) => onChange({ ...value, canAssignUserBranches: checked, canAccessSettings: checked || value.canAccessSettings })}
        />
        <PermissionToggle
          checked={value.canSendBranchAnnouncements}
          label="Şube içinde duyuru gönder"
          onChange={(checked) => onChange({ ...value, canSendBranchAnnouncements: checked })}
        />
        <PermissionToggle
          checked={value.canAccessAssets}
          label="Demirbaş Yönetimi erişimi"
          onChange={(checked) => onChange({
            ...value,
            canAccessAssets: checked,
            assets: checked ? { ...value.assets, dashboardView: true } : { ...DEFAULT_ASSET_PERMISSIONS },
          })}
        />
      </div>

      {value.canAccessAssets && (
        <fieldset className="rounded-xl bg-cyan-950/25 p-3 ring-1 ring-cyan-700/40">
          <legend className="px-2 text-sm font-semibold text-cyan-300">Demirbaş Modülü Ayrıntılı Yetkiler</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ASSET_PERMISSION_ENTRIES.map(([key, label]) => (
              <PermissionToggle
                key={key}
                checked={Boolean(value.assets?.[key])}
                label={label}
                onChange={(checked) => onChange({
                  ...value,
                  assets: { ...value.assets, [key]: checked },
                })}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

const ASSET_PERMISSION_ENTRIES: Array<[keyof UserPermissions['assets'], string]> = [
  ['dashboardView', 'Dashboard görüntüleme'],
  ['cardsView', 'Demirbaş kartlarını gör'],
  ['cardsCreate', 'Demirbaş kartı oluştur'],
  ['cardsEdit', 'Demirbaş kartı düzenle'],
  ['cardsDelete', 'Demirbaş kartı sil'],
  ['assignmentsView', 'Zimmetleri gör'],
  ['assignmentsCreate', 'Zimmet oluştur'],
  ['assignmentsReturn', 'Zimmet iadesi al'],
  ['transfersView', 'Transferleri gör'],
  ['transfersCreate', 'Transfer oluştur'],
  ['transfersApprove', 'Transfer onayla'],
  ['countsView', 'Sayımları gör'],
  ['countsCreate', 'Sayım başlat'],
  ['countsScan', 'Mobil sayım okut'],
  ['countsReview', 'Sayım anındaki okutulanları gör'],
  ['countsCorrect', 'Sayım okutmalarını düzelt / kaldır'],
  ['countsComplete', 'Sayımı tamamla'],
  ['countsApprove', 'Sayım sonucunu onayla'],
  ['locationsView', 'Kişi / birim / lokasyon gör'],
  ['locationsManage', 'Kişi / birim / lokasyon yönet'],
  ['labelsView', 'Etiket şablonlarını gör'],
  ['labelsDesign', 'Etiket tasarla'],
  ['labelsPrint', 'Etiket ve QR bas'],
  ['documentsView', 'Zimmet / transfer evraklarını gör'],
  ['documentsPrint', 'Evrak yazdır / PDF oluştur'],
  ['reportsView', 'Demirbaş raporlarını gör'],
  ['reportsExport', 'Rapor dışa aktar'],
  ['integrationsView', 'Harici kaynakları gör'],
  ['integrationsManage', 'Harici kaynak yapılandır'],
];

function SectionPermissionEditor({ title, value, onChange, excelLabel = 'Excel içe / dışa aktarma' }: {
  title: string;
  value: SectionPermissions;
  onChange: (value: SectionPermissions) => void;
  excelLabel?: string;
}) {
  const entries: Array<[keyof SectionPermissions, string]> = [
    ['canView', 'Görüntüleme'],
    ['canCreate', 'Kayıt ekleme'],
    ['canEdit', 'Kayıt düzenleme'],
    ['canDelete', 'Kayıt silme'],
    ['canExcel', excelLabel],
  ];

  return (
    <fieldset className="rounded-xl bg-slate-800/40 p-3 ring-1 ring-slate-700">
      <legend className="px-2 text-sm font-semibold text-sky-300">{title}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([key, label]) => (
          <PermissionToggle
            key={key}
            checked={value[key]}
            label={label}
            onChange={(checked) => onChange({ ...value, [key]: checked })}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PermissionToggle({ checked, label, onChange }: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
