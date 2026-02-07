import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useEffect } from 'react';

interface NetworkStore {
  // State
  isOnline: boolean;

  // Actions
  setOnline: (isOnline: boolean) => void;
}

export const useNetworkStore = create<NetworkStore>()(
  devtools(
    (set) => ({
      // State
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,

      // Actions
      setOnline: (isOnline) => set({ isOnline }, false, 'setOnline'),
    }),
    { name: 'NetworkStore' }
  )
);

/**
 * 네트워크 상태 모니터링 훅
 *
 * 브라우저 online/offline 이벤트를 리슨하여 store 업데이트
 */
export function useNetworkStatus() {
  const { isOnline, setOnline } = useNetworkStore();

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  return isOnline;
}
