import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { App } from "@/ui/App";
// the fonts ship with the app (open licence, @fontsource-variable), so no visit asks another site for them
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";
import { BG_SL, PLAIN, hslHex } from '@/ui/lib/colors';

export const metadata: Metadata = {
  // the tab's title and the home-screen app's name follow APP_NAME at runtime (App.tsx, site.webmanifest)
  title: "Listick",
  description: "Track what you watch",
  icons: { icon: { url: "/icons/listick.svg?v=2", type: "image/svg+xml" }, apple: "/icons/listick-180.png?v=2" },
  manifest: "/site.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b1020" };

// this device's accent and background, applied before the first paint so the page doesn't flash the default
// (src/ui/lib/look.ts keeps them up to date afterwards)
const LOOK = `try {
  const l = JSON.parse(localStorage.getItem('dash.look') || '{}'), d = document.documentElement;
  if (l.accent) d.style.setProperty('--accent', l.accent);
  const P = ${JSON.stringify(Object.fromEntries(PLAIN))}, hslHex = ${hslHex.toString()};
  const bg = l.bg === 'custom' ? hslHex(l.bgHue ?? 230, ${BG_SL.join(', ')}) : P[l.bg || (l.wall === 'none' && l.plain)] || P.Navy;
  d.style.setProperty('--page-bg', bg);
} catch {}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK }} />
      </head>
      {/* the app lives here, not in each page, so it stays put (who's signed in, the data) as you move between pages; it reads
          the path, which a page of a row or a list (/row/<id>, /lists/<id>) only knows on request, so it waits in a Suspense */}
      <body><Suspense><App>{children}</App></Suspense></body>
    </html>
  );
}
