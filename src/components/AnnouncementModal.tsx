import { useEffect, useState } from 'react';
import { AlertTriangle, BellRing, ShieldAlert, X } from 'lucide-react';
import type { Announcement } from '@/lib/types';

interface Props {
  announcement: Announcement;
  onClose: (dontShowAgain: boolean) => Promise<void>;
}

export default function AnnouncementModal({ announcement, onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = async () => {
    setBusy(true);
    try {
      await onClose(dontShowAgain);
    } finally {
      setBusy(false);
    }
  };

  const Icon = announcement.priority === 'CRITICAL'
    ? ShieldAlert
    : announcement.priority === 'IMPORTANT'
      ? AlertTriangle
      : BellRing;

  const tone = announcement.priority === 'CRITICAL'
    ? 'announcement-priority-critical'
    : announcement.priority === 'IMPORTANT'
      ? 'announcement-priority-important'
      : 'announcement-priority-normal';

  return (
    <div className="announcement-modal fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <section className={`announcement-detail w-full max-w-xl rounded-3xl p-5 shadow-2xl ${tone}`}>
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-white/10 p-3">
            <Icon className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">Duyuru</div>
            <h2 className="mt-1 break-words text-xl font-black">{announcement.title}</h2>
            <div className="mt-1 text-xs opacity-70">
              {announcement.senderName}
              {announcement.senderDepartment ? ` · ${announcement.senderDepartment}` : ''}
              {' · '}
              {new Date(announcement.createdAt).toLocaleString('tr-TR')}
            </div>
          </div>
          <button type="button" onClick={() => void close()} disabled={busy} className="rounded-xl p-2 opacity-70 hover:bg-white/10 hover:opacity-100" aria-label="Duyuruyu kapat">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-black/20 p-4 text-sm leading-6 ring-1 ring-white/10">
          {announcement.body}
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-2xl bg-black/20 p-3 text-sm ring-1 ring-white/10">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={event => setDontShowAgain(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block font-bold">Bir daha gösterme</span>
            <span className="mt-0.5 block text-xs opacity-70">
              Bu seçeneği işaretlemezseniz duyuru her yeni oturum açılışında tekrar gösterilir.
            </span>
          </span>
        </label>

        <button type="button" onClick={() => void close()} disabled={busy} className="action-button primary-button mt-4 w-full">
          {busy ? 'Kaydediliyor…' : 'Duyuruyu Kapat'}
        </button>
      </section>
    </div>
  );
}
