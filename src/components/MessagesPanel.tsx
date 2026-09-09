import { useEffect, useMemo, useState } from 'react';
import { BellRing, Inbox, Mail, MailOpen, Plus, Send, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { AnnouncementMailboxItem, AppMessage, BranchInfo, SessionUser } from '@/lib/types';
import BranchRecordSelector, { defaultRecordBranch } from './BranchRecordSelector';

interface Props {
  currentUser: SessionUser;
  users: SessionUser[];
  messages: AppMessage[];
  branches: BranchInfo[];
  onSend: (recipientId: string, subject: string, body: string, branchCode: string) => Promise<void>;
  onRead: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAnnouncementSend: (input: {
    branchCode: string;
    title: string;
    body: string;
    priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
    audienceType: 'TEAM' | 'ALL' | 'DEPARTMENT' | 'USERS';
    audienceValue: string;
  }) => Promise<{ recipientCount: number }>;
}

type MailboxView = 'inbox' | 'sent' | 'announcement-inbox' | 'announcement-sent';

export default function MessagesPanel({ currentUser, users, messages, branches, onSend, onRead, onDelete, onAnnouncementSend }: Props) {
  const [compose, setCompose] = useState(false);
  const [selected, setSelected] = useState<AppMessage | null>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementMailboxItem | null>(null);
  const [view, setView] = useState<MailboxView>('inbox');
  const [recipientId, setRecipientId] = useState('');
  const [messageBranchCode, setMessageBranchCode] = useState(() => defaultRecordBranch(branches));
  const [announcementBranchCode, setAnnouncementBranchCode] = useState(() => defaultRecordBranch(branches));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementPriority, setAnnouncementPriority] = useState<'NORMAL' | 'IMPORTANT' | 'CRITICAL'>('NORMAL');
  const [audienceType, setAudienceType] = useState<'TEAM' | 'ALL' | 'DEPARTMENT' | 'USERS'>('TEAM');
  const [audienceValue, setAudienceValue] = useState('');
  const [announcementBusy, setAnnouncementBusy] = useState(false);
  const [announcementInbox, setAnnouncementInbox] = useState<AnnouncementMailboxItem[]>([]);
  const [announcementSent, setAnnouncementSent] = useState<AnnouncementMailboxItem[]>([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);

  const announcementBranches = useMemo(
    () => currentUser.isAdmin ? branches : branches.filter(branch => branch.permissions.canSendBranchAnnouncements),
    [branches,currentUser.isAdmin],
  );
  const canAnnounce = currentUser.isAdmin || announcementBranches.length > 0;
  const departments = useMemo(() => Array.from(new Set(users.map(user => user.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr-TR')), [users]);
  const recipients = useMemo(() => users.filter(u => u.id !== currentUser.id && u.active), [users, currentUser.id]);
  const visible = messages.filter(message => message.direction === view);

  const loadAnnouncementMailboxes = async () => {
    setAnnouncementLoading(true);
    try {
      const [inbox, sent] = await Promise.all([
        api.getAnnouncementInbox(),
        canAnnounce ? api.getAnnouncementSent() : Promise.resolve([]),
      ]);
      setAnnouncementInbox(inbox);
      setAnnouncementSent(sent);
    } finally {
      setAnnouncementLoading(false);
    }
  };

  useEffect(() => {
    void loadAnnouncementMailboxes();
  }, [currentUser.id, canAnnounce]);

  const open = async (message: AppMessage) => {
    setSelected(message);
    if (message.direction === 'inbox' && !message.readAt) await onRead(message.id);
  };

  const openAnnouncement = async (announcement: AnnouncementMailboxItem) => {
    setSelectedAnnouncement(announcement);
    if (announcement.direction === 'inbox' && !announcement.seenAt) {
      const result = await api.markAnnouncementSeen(announcement.id);
      setAnnouncementInbox(items => items.map(item => item.id === announcement.id ? { ...item, seenAt: result.seenAt, readCount: 1 } : item));
      setSelectedAnnouncement({ ...announcement, seenAt: result.seenAt, readCount: 1 });
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!messageBranchCode) {
      alert('Mesajın gönderileceği şubeyi seçin.');
      return;
    }
    await onSend(recipientId, subject, body, messageBranchCode);
    setCompose(false);
    setRecipientId('');
    setSubject('');
    setBody('');
    setView('sent');
  };

  const mailboxButton = (target: MailboxView, label: string, icon: React.ReactNode, count?: number) => (
    <button onClick={() => setView(target)} className={`action-button ${view === target ? 'primary-button' : 'secondary-button'}`}>
      {icon} {label}{typeof count === 'number' ? ` (${count})` : ''}
    </button>
  );

  const priorityLabel = (priority: AnnouncementMailboxItem['priority']) =>
    priority === 'CRITICAL' ? 'Kritik' : priority === 'IMPORTANT' ? 'Önemli' : 'Normal';

  const priorityClass = (priority: AnnouncementMailboxItem['priority']) =>
    priority === 'CRITICAL' ? 'announcement-priority-critical' : priority === 'IMPORTANT' ? 'announcement-priority-important' : 'announcement-priority-normal';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">Mesajlar ve Duyurular</h2>
          <p className="text-xs text-slate-500">Kişisel mesajlar aynı şube içinde veya şubeler arasında gönderilebilir. Duyurular şube bazlı ya da Genel (tüm şubeler) olabilir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAnnounce && <button onClick={() => {
            if(currentUser.isAdmin&&!announcementBranchCode)setAnnouncementBranchCode('ALL');
            if(!currentUser.isAdmin&&!announcementBranches.some(branch=>branch.code===announcementBranchCode)){
              setAnnouncementBranchCode(defaultRecordBranch(announcementBranches));
            }
            setAnnouncementOpen(true);
          }} className="action-button secondary-button"><BellRing className="h-4 w-4" /> Duyuru Gönder</button>}
          <button onClick={() => setCompose(true)} className="action-button primary-button"><Plus className="h-4 w-4" /> Yeni Mesaj</button>
        </div>
      </div>

      <div className={`grid gap-2 ${canAnnounce ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
        {mailboxButton('inbox', 'Mesaj Gelen', <Inbox className="h-4 w-4" />)}
        {mailboxButton('sent', 'Mesaj Giden', <Send className="h-4 w-4" />)}
        {mailboxButton('announcement-inbox', 'Duyuru Gelen', <BellRing className="h-4 w-4" />, announcementInbox.length)}
        {canAnnounce && mailboxButton('announcement-sent', 'Duyuru Giden', <BellRing className="h-4 w-4" />, announcementSent.length)}
      </div>

      {(view === 'inbox' || view === 'sent') && (
        visible.length === 0 ? <div className="panel-card text-center text-slate-400">Bu klasörde mesaj yok.</div> :
          <div className="space-y-2">{visible.map(message => (
            <button key={`${message.direction}-${message.id}`} onClick={() => void open(message)}
              className={`w-full rounded-xl p-3 text-left ring-1 transition ${message.direction === 'inbox' && !message.readAt ? 'bg-sky-500/10 ring-sky-500/40' : 'bg-slate-900/40 ring-slate-700'}`}>
              <div className="flex items-start gap-3">
                {message.direction === 'inbox' && !message.readAt ? <Mail className="mt-0.5 h-4 w-4 text-sky-400" /> : <MailOpen className="mt-0.5 h-4 w-4 text-slate-500" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{message.subject || 'Konu yok'}</p>
                  <span className="record-branch-badge mt-1">{message.branchCode || '---'}</span>
                  <p className="text-xs text-slate-400">{message.direction === 'sent' ? `Alıcı: ${message.recipientName}` : `Gönderen: ${message.senderName}`}</p>
                </div>
                <span className="whitespace-nowrap text-[10px] text-slate-500">{new Date(message.createdAt).toLocaleString('tr-TR')}</span>
              </div>
            </button>
          ))}</div>
      )}

      {(view === 'announcement-inbox' || view === 'announcement-sent') && (
        announcementLoading ? <div className="panel-card text-center text-slate-400">Duyuru kutusu yükleniyor…</div> :
          (view === 'announcement-inbox' ? announcementInbox : announcementSent).length === 0
            ? <div className="panel-card text-center text-slate-400">Bu klasörde duyuru yok.</div>
            : <div className="space-y-2">{(view === 'announcement-inbox' ? announcementInbox : announcementSent).map(announcement => (
              <button key={`${announcement.direction}-${announcement.id}`} onClick={() => void openAnnouncement(announcement)}
                className={`announcement-mail-item ${priorityClass(announcement.priority)} ${announcement.direction === 'inbox' && !announcement.seenAt ? 'announcement-unread' : ''}`}>
                <div className="flex items-start gap-3">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold">{announcement.title}</p>
                      <span className="record-branch-badge">{announcement.branchCode==='ALL'?'GENEL':(announcement.branchCode || '---')}</span>
                      <span className="announcement-priority-badge">{priorityLabel(announcement.priority)}</span>
                    </div>
                    <p className="mt-1 text-xs">
                      {announcement.direction === 'sent'
                        ? `Alıcı: ${announcement.recipientCount} kişi · Okuyan: ${announcement.readCount}`
                        : `Gönderen: ${announcement.senderName}${announcement.senderDepartment ? ` · ${announcement.senderDepartment}` : ''}`}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-[10px]">{new Date(announcement.createdAt).toLocaleString('tr-TR')}</span>
                </div>
              </button>
            ))}</div>
      )}

      {compose && <Modal onClose={() => setCompose(false)} title="Yeni Mesaj">
        <form onSubmit={send} className="space-y-3">
          <BranchRecordSelector
            branches={branches}
            value={messageBranchCode}
            onChange={setMessageBranchCode}
          />
          <select required value={recipientId} onChange={e => setRecipientId(e.target.value)} className="form-control">
            <option value="">Alıcı seçin</option>{recipients.map(u => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}
          </select>
          <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={160} placeholder="Konu" className="form-control" />
          <textarea required rows={6} value={body} onChange={e => setBody(e.target.value)} maxLength={5000} placeholder="Mesajınız" className="form-control resize-y" />
          <button className="action-button primary-button w-full"><Send className="h-4 w-4" /> Gönder</button>
        </form>
      </Modal>}

      {announcementOpen && <Modal onClose={() => setAnnouncementOpen(false)} title="Yeni Duyuru">
        <form onSubmit={async event => {
          event.preventDefault();
          setAnnouncementBusy(true);
          try {
            if (!announcementBranchCode) {
              alert('Duyurunun gönderileceği şubeyi seçin.');
              return;
            }
            const result = await onAnnouncementSend({
              branchCode: announcementBranchCode,
              title: announcementTitle,
              body: announcementBody,
              priority: announcementPriority,
              audienceType,
              audienceValue,
            });
            alert(`Duyuru ${result.recipientCount} kullanıcıya gönderildi.`);
            setAnnouncementOpen(false);
            setAnnouncementTitle('');
            setAnnouncementBody('');
            setAnnouncementPriority('NORMAL');
            setAudienceType('TEAM');
            setAudienceValue('');
            await loadAnnouncementMailboxes();
            setView('announcement-sent');
          } finally {
            setAnnouncementBusy(false);
          }
        }} className="space-y-3">
          {currentUser.isAdmin ? (
            <label className="block text-xs font-semibold text-slate-300">
              Duyuru Kapsamı
              <select
                value={announcementBranchCode}
                onChange={event=>setAnnouncementBranchCode(event.target.value)}
                className="form-control mt-1"
              >
                <option value="ALL">Genel — Tüm Şubeler</option>
                {branches.map(branch=><option key={branch.code} value={branch.code}>{branch.code} — {branch.name}</option>)}
              </select>
            </label>
          ) : (
            <BranchRecordSelector
              branches={announcementBranches}
              value={announcementBranchCode}
              onChange={setAnnouncementBranchCode}
            />
          )}
          <input required value={announcementTitle} onChange={event => setAnnouncementTitle(event.target.value)} maxLength={180} placeholder="Duyuru başlığı" className="form-control" />
          <textarea required rows={7} value={announcementBody} onChange={event => setAnnouncementBody(event.target.value)} maxLength={10000} placeholder="Duyuru metni" className="form-control resize-y" />
          <select value={announcementPriority} onChange={event => setAnnouncementPriority(event.target.value as typeof announcementPriority)} className="form-control">
            <option value="NORMAL">Normal</option>
            <option value="IMPORTANT">Önemli</option>
            <option value="CRITICAL">Kritik</option>
          </select>
          <select value={audienceType} onChange={event => { setAudienceType(event.target.value as typeof audienceType); setAudienceValue(''); }} className="form-control">
            <option value="ALL">{announcementBranchCode==='ALL'?'Tüm OPERİS Kullanıcıları':'Şubedeki Tüm Kullanıcılar'}</option>
            <option value="TEAM">Kendi Birimim</option>
            <option value="DEPARTMENT">Seçili Birim</option>
            <option value="USERS">Seçili Kullanıcılar</option>
          </select>
          {audienceType === 'DEPARTMENT' && <select required value={audienceValue} onChange={event => setAudienceValue(event.target.value)} className="form-control">
            <option value="">Birim seçin</option>
            {departments.map(department => <option key={department} value={department}>{department}</option>)}
          </select>}
          {audienceType === 'USERS' && <select required multiple value={audienceValue ? audienceValue.split('|') : []} onChange={event => setAudienceValue(Array.from(event.target.selectedOptions).map(option => option.value).join('|'))} className="form-control min-h-40">
            {users.filter(user => user.active).map(user => <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>)}
          </select>}
          {!currentUser.isAdmin&&<div className="announcement-info-box">
            Duyuru yalnız duyuru yetkinizin bulunduğu seçili şube içinde dağıtılır. Genel — Tüm Şubeler duyurusu yalnız Admin tarafından gönderilebilir.
          </div>}
          <button disabled={announcementBusy} className="action-button primary-button w-full"><BellRing className="h-4 w-4" /> {announcementBusy ? 'Gönderiliyor…' : 'Duyuruyu Gönder'}</button>
        </form>
      </Modal>}

      {selected && <Modal onClose={() => setSelected(null)} title={selected.subject || 'Konu yok'}>
        <div className="mb-3 space-y-1 text-xs text-slate-500">
          <p>{selected.direction === 'sent' ? `Alıcı: ${selected.recipientName}` : `Gönderen: ${selected.senderName}`}</p>
          <p>Gönderim: {new Date(selected.createdAt).toLocaleString('tr-TR')}</p>
          {selected.direction === 'sent' && <p>Okunma: {selected.readAt ? new Date(selected.readAt).toLocaleString('tr-TR') : 'Henüz okunmadı'}</p>}
        </div>
        <p className="message-content whitespace-pre-wrap text-sm leading-6 text-slate-200">{selected.body}</p>
        <button onClick={async () => { await onDelete(selected.id); setSelected(null); }} className="action-button mt-5 w-full bg-red-500/15 text-red-300 ring-1 ring-red-500/30">
          <Trash2 className="h-4 w-4" /> Mesajı Sil
        </button>
      </Modal>}

      {selectedAnnouncement && <Modal onClose={() => setSelectedAnnouncement(null)} title={selectedAnnouncement.title}>
        <article className={`announcement-detail ${priorityClass(selectedAnnouncement.priority)}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="announcement-priority-badge">{priorityLabel(selectedAnnouncement.priority)}</span>
            <span className="text-xs">{new Date(selectedAnnouncement.createdAt).toLocaleString('tr-TR')}</span>
          </div>
          <div className="mb-4 space-y-1 text-xs">
            {selectedAnnouncement.direction === 'sent' ? <>
              <p>Alıcı sayısı: <b>{selectedAnnouncement.recipientCount}</b></p>
              <p>Okuyan kullanıcı: <b>{selectedAnnouncement.readCount}</b></p>
            </> : <>
              <p>Gönderen: <b>{selectedAnnouncement.senderName}</b></p>
              {selectedAnnouncement.senderDepartment && <p>Birim: <b>{selectedAnnouncement.senderDepartment}</b></p>}
            </>}
          </div>
          <p className="message-content whitespace-pre-wrap text-sm leading-6">{selectedAnnouncement.body}</p>
        </article>
      </Modal>}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
    <div className="theme-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 ring-1 sm:rounded-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold">{title}</h3>
        <button onClick={onClose} className="theme-modal-close p-2" aria-label="Kapat"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </div>;
}
