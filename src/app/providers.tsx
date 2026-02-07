import { useEffect } from 'react';
import { initEventBridge, destroyEventBridge } from '@/lib/event-bridge';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  useEffect(() => {
    initEventBridge();
    return () => destroyEventBridge();
  }, []);

  return <>{children}</>;
}
