import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { getOfflinePosQueue, syncQueuedPosSales } from '../lib/offline-pos.ts';
import { useAuth } from '../context/AuthContext.tsx';

export function OfflineIndicator() {
  const { activeTenantId } = useAuth();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refreshCount = () => {
      if (activeTenantId) {
        setQueuedCount(getOfflinePosQueue(activeTenantId).length);
      }
    };
    refreshCount();

    const handleOnline = async () => {
      setIsOnline(true);
      if (activeTenantId && getOfflinePosQueue(activeTenantId).length > 0) {
        setSyncing(true);
        await syncQueuedPosSales(activeTenantId).finally(() => setSyncing(false));
        refreshCount();
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', refreshCount);
    const interval = window.setInterval(refreshCount, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', refreshCount);
      window.clearInterval(interval);
    };
  }, [activeTenantId]);

  if (isOnline && queuedCount === 0) return null;

  const handleManualSync = async () => {
    if (!activeTenantId || !isOnline) return;
    setSyncing(true);
    try {
      await syncQueuedPosSales(activeTenantId);
      setQueuedCount(getOfflinePosQueue(activeTenantId).length);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-amber-950/75 border-b border-amber-400/40 px-4 py-2 text-xs text-amber-100 no-print">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <CloudOff className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
          <span>
            {!isOnline
              ? 'Offline Mode — POS continues using cached catalogue and queues checkouts locally.'
              : `${queuedCount} offline POS checkout(s) pending server sync.`}
          </span>
        </div>
        {isOnline && queuedCount > 0 && (
          <button
            type="button"
            disabled={syncing}
            onClick={handleManualSync}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-400 text-[#021324] rounded text-xs font-bold hover:bg-amber-300 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Queued Sales'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
