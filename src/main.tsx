import '@/lib/install';
import { configureServiceWorker } from '@/lib/serviceWorker';
import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SplashScreen from './components/SplashScreen';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

void configureServiceWorker();

const App = lazy(() => import('./App.tsx'));

function Bootstrap() {
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumSplashElapsed(true), 650);
    return () => window.clearTimeout(timer);
  }, []);

  if (!minimumSplashElapsed) {
    return <SplashScreen />;
  }

  return (
    <Suspense fallback={<SplashScreen />}>
      <App />
    </Suspense>
  );
}

const savedTheme = localStorage.getItem('yi-theme');
const normalizedTheme = savedTheme === 'turquoise' ? 'light' : savedTheme;
if (normalizedTheme === 'light' || normalizedTheme === 'spring' || normalizedTheme === 'gray' || normalizedTheme === 'dark' || normalizedTheme === 'black') {
  if (savedTheme === 'turquoise') {
    localStorage.setItem('yi-theme', 'light');
  }
  document.documentElement.classList.remove('theme-light', 'theme-spring', 'theme-dark', 'theme-gray', 'theme-turquoise', 'theme-black');
  document.documentElement.classList.add(`theme-${normalizedTheme}`);
  document.documentElement.style.colorScheme = normalizedTheme === 'light' || normalizedTheme === 'spring' ? 'light' : 'dark';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Bootstrap />
    </AppErrorBoundary>
  </StrictMode>,
);