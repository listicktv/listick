// This device's own storage (a look, a remembered picker): JSON in localStorage, quietly nothing where it can't be used.
export const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) || 'null') as T | null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  raw(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
};
