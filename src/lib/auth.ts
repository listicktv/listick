import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { LINK_ORIGIN, sendMail } from "@/server/mail";
import { appName } from "@/server/util";

// users, sessions and accounts live in our own Postgres (src/db/auth-schema.ts), so they move with the database. The base
// address is APP_ORIGIN's public one (BETTER_AUTH_URL, if set, wins), never the request's Host, which a client could forge
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || LINK_ORIGIN() || undefined,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: { expiresIn: 180 * 24 * 3600 },   // sign-ins last 180 days
  emailAndPassword: {
    enabled: true,
    // the page's own reset form (/?reset=<token>) takes the link
    sendResetPassword: async ({ user, token }) => {
      await sendMail(user.email, "Reset your password",
        `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your password for ${appName()}. Choose a new one here (the link works for an hour, once):\n\n${LINK_ORIGIN()}/?reset=${token}\n\nIf it wasn't you, ignore this email; your password stays as it is.\n`);
    },
    revokeSessionsOnPasswordReset: true,
  },
  // new accounts come from an invite or the owner's settings, so they use the page at once; a changed email gets a confirmation
  // link (api.ts), which signs you in and lands on the page
  emailVerification: {
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 3600,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(user.email, `Confirm your email for ${appName()}`,
        `Hi ${user.name},\n\nConfirm your email to start using ${appName()} (the link works for 24 hours):\n\n${url}\n\nIf you didn't sign up, ignore this email and no account will be used.\n`);
    },
  },
  // usernames: 2-30 letters (any script), digits, . _ -
  plugins: [username({ minUsernameLength: 2, maxUsernameLength: 30, usernameValidator: (n) => /^[\p{L}\p{N}_.-]{2,30}$/u.test(n) }), nextCookies()],
});
