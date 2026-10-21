import { after } from "next/server";
import { handle } from "@/server/api";
import { flushCalls } from "@/server/sources";

// every /api path except Better Auth's own (/api/auth/*) and /api/health goes to src/server/api.ts. The outside API calls a
// request made are counted once its answer is out
async function route(req: Request) {
  after(() => flushCalls().catch((e) => console.error("api-calls:", e)));
  return handle(req);
}
export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
