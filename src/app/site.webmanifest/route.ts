import { connection } from "next/server";
import { appName } from "@/server/util";

// the home-screen app: its name is a setting (APP_NAME), so this is made per request rather than at build time
export async function GET() {
  await connection();
  const name = appName();
  return Response.json({
    name, short_name: name, start_url: "/", display: "standalone", background_color: "#0b1020", theme_color: "#0b1020",
    icons: [
      { src: "icons/listick-app.svg?v=2", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "icons/listick-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/listick-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/listick-512-maskable.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "content-type": "application/manifest+json" } });
}
