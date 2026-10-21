import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth's own endpoints stay closed: sign-up, sign-in and account changes go through src/server/api.ts, which checks
// the invite, the captcha, the sign-in limit and the page's origin. Only the link in a confirmation email opens here
const { GET: handler } = toNextJsHandler(auth);
export async function GET(req: Request) {
  return new URL(req.url).pathname === "/api/auth/verify-email" ? handler(req) : Response.json({ error: "not found" }, { status: 404 });
}
