import type { Metadata, Viewport } from "next";
import "./globals.css";
import { STORE_NAME } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: `${STORE_NAME} Admin`,
  description: "Private NEXTVO store management dashboard.",
  applicationName: `${STORE_NAME} Admin`,
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "NEXTVO Admin", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }] }
};

export const viewport: Viewport = { themeColor: "#080b12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
