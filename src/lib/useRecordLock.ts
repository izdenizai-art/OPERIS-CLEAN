import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { RecordLock } from './types';

export function useRecordLock(
  module: RecordLock['module'],
  recordId: string | null | undefined,
  enabled: boolean,
) {
  const [lock, setLock] = useState<RecordLock | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const lockRef = useRef<RecordLock | null>(null);

  useEffect(() => {
    let cancelled = false;
    let heartbeat: number | undefined;

    const release = async () => {
      const current = lockRef.current;
      lockRef.current = null;
      if (current?.ownedByCurrentUser) {
        await api.releaseRecordLock(current.id).catch(() => undefined);
      }
    };

    if (!enabled || !recordId) {
      void release();
      setLock(null);
      setError('');
      return;
    }

    setLoading(true);
    api.acquireRecordLock(module, recordId)
      .then(acquired => {
        if (cancelled) {
          return api.releaseRecordLock(acquired.id).catch(() => undefined);
        }
        lockRef.current = acquired;
        setLock(acquired);
        setError('');
        heartbeat = window.setInterval(async () => {
          const current = lockRef.current;
          if (!current) return;
          try {
            const renewed = await api.heartbeatRecordLock(current.id);
            lockRef.current = renewed;
            setLock(renewed);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Düzenleme kilidi yenilenemedi.');
            lockRef.current = null;
            if (heartbeat) window.clearInterval(heartbeat);
          }
        }, 30_000);
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Düzenleme kilidi alınamadı.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (heartbeat) window.clearInterval(heartbeat);
      void release();
    };
  }, [module, recordId, enabled]);

  return {
    lock,
    error,
    loading,
    editable: !enabled || Boolean(lock?.ownedByCurrentUser),
  };
}
