import { useEffect } from 'react';
import { CheckCircle2, RefreshCw, Sparkles, X } from 'lucide-react';
import type { ReleaseInfo } from '@/lib/api';

interface Props {
  release: ReleaseInfo;
  clientUpdated: boolean;
  onClose: () => Promise<void> | void;
}

export default function ReleaseNotesModal({ release, clientUpdated, onClose }: Props) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="release-notes-backdrop fixed inset-0 z-[260] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) void onClose();
      }}
    >
      <section
        className="release-notes-modal flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-slate-950 text-white shadow-2xl ring-1 ring-emerald-400/35 sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
      >
        <header className="release-notes-header sticky top-0 z-10 shrink-0 border-b border-slate-700/80 bg-gradient-to-r from-emerald-950 via-slate-950 to-cyan-950 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="operis-rainbow-text text-lg font-black sm:text-xl">Operis Enterprise</div>
              <h2 id="release-notes-title" className="mt-1 break-words text-base font-black text-white sm:text-lg">
                Sürüm {release.version} · {release.name}
              </h2>
              <p className="mt-1 text-xs font-semibold text-slate-200 sm:text-sm">Güncelleme Bilgisi</p>
            </div>
            <button
              type="button"
              onClick={() => void onClose()}
              className="release-notes-close-button inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20 hover:bg-white/20"
              aria-label="Kapat"
            >
              <X className="h-5 w-5" />
              <span className="hidden sm:inline">Kapat</span>
            </button>
          </div>
        </header>

        <div className="release-notes-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
          <div className="space-y-3">
            {clientUpdated && (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/15 p-3 text-sm text-white ring-1 ring-emerald-400/35">
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <div>
                  <p className="font-black text-white">Bu bilgisayardaki Operis istemcisi güncellendi.</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-200">Yeni uygulama dosyaları ve önbellek otomatik olarak etkinleştirildi.</p>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-700 sm:p-4">
              <div className="release-notes-section-title mb-3 flex items-center gap-2 text-sm font-black text-white">
                <Sparkles className="h-4 w-4 text-amber-300" />
                Bu sürümün ana başlıkları
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {release.headlines.map(headline => (
                  <div
                    key={headline}
                    className="release-note-item flex items-start gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-semibold leading-5 text-white ring-1 ring-slate-700/80"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <span className="release-note-text break-words">{headline}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="release-notes-footer sticky bottom-0 z-10 shrink-0 border-t border-slate-700/80 bg-slate-950/98 p-3 backdrop-blur sm:p-4">
          <div className="flex items-center gap-3">
            <p className="hidden min-w-0 flex-1 text-xs font-medium text-slate-300 sm:block">
              Pencereyi kapatmak için Kapat düğmesini, Tamam düğmesini veya ESC tuşunu kullanabilirsiniz.
            </p>
            <button
              type="button"
              onClick={() => void onClose()}
              className="action-button primary-button min-h-11 w-full shrink-0 sm:w-auto sm:min-w-40"
            >
              <CheckCircle2 className="h-4 w-4" />
              Tamam ve Kapat
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
