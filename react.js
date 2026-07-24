import { useEffect } from 'react';
import { initI18nInspector } from './client.js';

export function useI18nInspector(options = {}) {
  const { enabled = true } = options;

  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV === 'production') return;
    if (!enabled) return;

    const cleanup = initI18nInspector(options);
    return cleanup;
  }, [enabled]);
}
