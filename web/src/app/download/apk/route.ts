import { NextResponse } from "next/server";
import { latestApk } from "@/server/releases";

// One URL that always means "the current Android build": /download/apk.
//
// It exists so the thing you put on a slide, a QR code, a business card or a text message
// never has to name a version. GitHub's own asset URLs carry the tag, so a printed one is
// stale the moment the next release is cut; this one resolves at click time.
//
// When there is no build to hand, it lands on /download rather than returning a 404 — a person
// who scanned a code deserves the page that explains what happened, not a browser error.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const found = await latestApk();

  if (found.state !== "ok") {
    return NextResponse.redirect(new URL("/download", request.url), 302);
  }

  const response = NextResponse.redirect(found.release.apk.url, 302);
  // Never let a CDN or a browser pin this redirect to one release. The whole point of the URL
  // is that it moves when a new build is published.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
