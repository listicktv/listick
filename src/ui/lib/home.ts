// What the home page's cards need from it: a fresh /api/summary after a change, and the title panel.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Ref } from './media';

export type HomeState = { reload: (ms?: number) => void; openTitle: (ref: Ref) => void };
export const HomeCtx = createContext<HomeState>({ reload: () => {}, openTitle: () => {} });
export const useHome = () => useContext(HomeCtx);

const phoneQ = () => matchMedia('(max-width: 800px)');
export const usePhone = () => useSyncExternalStore((cb) => {
  const m = phoneQ(); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb);
}, () => phoneQ().matches, () => false);
