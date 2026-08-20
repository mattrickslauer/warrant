import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/auth/session-context";
import { getSessionSafe } from "@/auth/session";
import { Roboto, Google_Sans_Code } from "next/font/google";
import "./globals.css";

/**
 * The house faces, self-hosted at build time so no screen waits on a third party.
 *
 * Roboto carries everything a person wrote. Google Sans Code carries everything a machine
 * produced — readings, timestamps, tool ids — which keeps the product's mono/sans provenance
 * rule intact while both faces stay Google's own. Devices that ship Google Sans (Android,
 * ChromeOS) get it ahead of Roboto via the stack in design/tokens.json.
 */
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const googleSansCode = Google_Sans_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Warrant — maintenance records that are evidence, not paperwork",
  description:
    "A procedure compiles to a form. A technician fills it by capturing, not typing. Agents verify what arrives, and nothing is released until every step holds up.",
};

export const viewport: Viewport = {
  themeColor: "#131314",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Resolved on the server so the first paint already knows the tenant.
 *
 * Without this the masthead would flash "signed out" on every navigation while the client
 * SDK re-established itself, and a technician would see their tenant appear a beat late on
 * every screen. The session cookie is httpOnly, so this is the only place it can be read.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionSafe();

  return (
    <html lang="en" className={`${roboto.variable} ${googleSansCode.variable}`}>
      <body>
        <SessionProvider initial={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
