// email (Resend) and the address links in it point to; on once RESEND_API_KEY and MAIL_FROM are set
import { env } from './util';

export const mailOn = () => !!env('RESEND_API_KEY') && !!env('MAIL_FROM');
export async function sendMail(to: string, subject: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to, subject, text }) });
  if (!r.ok) throw new Error(`resend -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}
// APP_ORIGIN: the page's addresses, comma-separated, the public one first; links in emails go to that one
export const ORIGINS = env('APP_ORIGIN').split(',').map((o) => o.trim()).filter(Boolean);
export const LINK_ORIGIN = () => ORIGINS[0] || '';
