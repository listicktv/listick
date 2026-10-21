// Alerts for whoever runs Listick: an error the web app or the worker hit, sent to ALERT_WEBHOOK (an incoming webhook that
// takes { content }, like Discord's) at most once an hour per kind, so a failing source doesn't flood the channel. Without
// a webhook they're only in the logs.
import { env, HOUR } from './util';

const sent = new Map<string, number>();
export async function alert(kind: string, text: string) {
  const url = env('ALERT_WEBHOOK');
  if (!url || Date.now() - (sent.get(kind) || 0) < HOUR) return;
  sent.set(kind, Date.now());
  const who = env('LISTICK_ROLE') || 'web';
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ content: `**Listick ${who}** · ${kind}\n${text}`.slice(0, 1900) }) }).catch((e) => console.error(`alert: ${e}`));
}
