import { useEffect } from 'react';
import { initI18nInspector } from './client.js';

export function useI18nInspector(options = {}) {
  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV === 'production') return;

    const cleanup = initI18nInspector(options);
    return cleanup;
  }, []);
}
