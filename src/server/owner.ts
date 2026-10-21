// The owner: a fresh instance's first account (an admin), made on the first visit (/api/setup), or at start from
// LISTICK_OWNER_NAME / LISTICK_OWNER_PASSWORD while there are no users yet. Everyone else joins by the owner's invite links.
import { auth } from '@/lib/auth';
import { q } from './db';
import { setProfile } from './store';
import { env } from './util';

export const noUsers = async () => !(await q.one('select 1 from "user" limit 1'));
// Better Auth needs an email; without one the owner gets a placeholder (.invalid never delivers) to change in Settings
export const placeholderEmail = (name: string) => `${name.toLowerCase()}@listick.invalid`;
export async function ensureOwner() {
  if (!await noUsers()) return;
  const name = env('LISTICK_OWNER_NAME').trim(), password = env('LISTICK_OWNER_PASSWORD');
  if (!name || !password) { console.log('users: no account yet: the first visit makes the owner'); return; }
  if (!/^[\p{L}\p{N}_.-]{2,30}$/u.test(name)) throw new Error('LISTICK_OWNER_NAME: 2-30 letters, digits, . _ -');
  if (password.length < 8) throw new Error('LISTICK_OWNER_PASSWORD: at least 8 characters');
  const email = env('LISTICK_OWNER_EMAIL').trim() || placeholderEmail(name);
  await makeUser(name, email, password, true);
  console.log(`users: owner ${name} made from LISTICK_OWNER_NAME`);
}
// an account made for someone (the owner, or by an admin in Settings): made directly rather than through sign-up, so no
// confirmation email goes out and no session is opened; sign-up would also hand its session cookie to the request making it
// (nextCookies), signing the admin out
export async function makeUser(name: string, email: string, password: string, admin: boolean) {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ email, name, username: name.toLowerCase(), displayUsername: name, emailVerified: true }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password) });
  await setProfile(user.id, { is_admin: admin, tracking_since: Date.now() });
  return user.id;
}
