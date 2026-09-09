import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentStack: '',
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Operis arayüz hatası:', error, info);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private reload = async (): Promise<void> => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
        <section className="w-full max-w-2xl rounded-3xl bg-slate-900 p-6 shadow-2xl ring-1 ring-red-500/40">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-500/15 p-3">
              <AlertTriangle className="h-7 w-7 text-red-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black">Operis arayüzü yüklenemedi</h1>
              <p className="mt-2 text-sm text-slate-300">
                Sayfa boş kalmak yerine hata ayrıntısı gösteriliyor. Aşağıdaki metni sistem yöneticisine iletin.
              </p>
            </div>
          </div>

          <pre className="mt-5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-black/40 p-4 text-xs text-red-200 ring-1 ring-white/10">
            {this.state.error.name}: {this.state.error.message}
            {this.state.componentStack ? `\n\n${this.state.componentStack}` : ''}
          </pre>

          <button type="button" onClick={() => void this.reload()} className="action-button primary-button mt-5 w-full">
            <RefreshCw className="h-4 w-4" />
            Önbelleği Temizle ve Yeniden Aç
          </button>
        </section>
      </div>
    );
  }
}
