// small helpers shared by the server modules
export const env = (k: string) => process.env[k] || '';
// what this instance calls itself (page title, home-screen app, emails, the sign-in card)
export const appName = () => env('APP_NAME').trim() || 'Listick';
export const HOUR = 3600000;
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
// a failed fetch's reason: the network error's code (ENOTFOUND, ECONNRESET), else its name (TimeoutError)
export const netErr = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code || (e as Error).name;
// fn's answer, or null when it threw (and logged)
export const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn(); } catch (e) { console.error(msg(e)); return null; } };
export const present = <T>(x: T | null | undefined): x is T => !!x;
