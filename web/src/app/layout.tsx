import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/auth/session-context";
import { InstrumentProvider } from "@/instrument/session";
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

/**
 * Where this site is actually served from, which decides where a share card fetches its image.
 *
 * It is read from the environment rather than hard-coded to warrant.tools, because the domain
 * is mapped separately from the deploy: until DNS and the certificate are live, the canonical
 * origin is still the Cloud Run hostname, and pinning the wrong one silently breaks every
 * preview card — the image 404s against a host that is not serving yet. Set
 * NEXT_PUBLIC_SITE_URL at BUILD time — infra/deploy-web.sh passes it as a --build-arg, because
 * Next inlines NEXT_PUBLIC_* during the build and setting it on a running revision does nothing.
 *
 * `||` AND NOT `??`, and the difference is a broken deploy rather than a style preference.
 * Dockerfile.web declares this as an ARG with an empty default and promotes it to an ENV, so in
 * the image the variable is SET AND EMPTY rather than absent. `??` only falls back on null and
 * undefined, so it kept the empty string, `new URL("")` threw ERR_INVALID_URL, and the build
 * died collecting page data for /account. It passed locally because there the variable is
 * genuinely unset. Empty must mean "no domain yet", which is exactly what `||` reads it as.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://warrant-zq2l2kwg3q-uc.a.run.app";

const TITLE = "Warrant — maintenance records that are evidence, not paperwork";
const DESCRIPTION =
  "A procedure compiles to a form. A technician fills it by capturing, not typing. Agents verify what arrives, and nothing is released until every step holds up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Warrant",
  openGraph: {
    type: "website",
    siteName: "Warrant",
    url: SITE,
    title: TITLE,
    description: DESCRIPTION,
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: "Warrant — a torque wrench on a machine housing, over the words maintenance records that are evidence, not paperwork.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
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
        {/* The instrument sits INSIDE the session and above the router: a technician pairs a
            tool once and then walks several steps and several jobs with it in their hand, so the
            connection has to outlive every page it is used on. */}
        <SessionProvider initial={session}>
          <InstrumentProvider>{children}</InstrumentProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
