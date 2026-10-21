// The user's country and services (Settings › Region & services, /api/region) and a country's services and age ratings
export type Country = { id: string; name: string };
export type Service = { id: number; name: string; logo: string | null };
export type Prefs = { countries: Country[]; country: string | null; services: number[]; lang: string | null };
export type RegionInfo = { services: Service[]; certs: string[] };

// a user who hasn't picked one starts with the region part of the browser's languages (fi-FI → FI), else the US
export function guessCountry() {
  for (const l of typeof navigator === 'undefined' ? [] : navigator.languages || []) { const m = l.match(/-([a-z]{2})$/i); if (m) return m[1].toUpperCase(); }
  return 'US';
}
