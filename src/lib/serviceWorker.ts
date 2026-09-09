const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const canUseServiceWorker = 'serviceWorker' in navigator && (window.location.protocol === 'https:' || isLocalhost);

export async function configureServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  if (!canUseServiceWorker) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('Service Worker kaydı başarısız:', error);
    });
  });
}
