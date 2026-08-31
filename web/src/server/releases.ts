import "server-only";

// Where the Android build comes from.
//
// The APK is not on Play. It is a GitHub release asset, and this module is the one place that
// knows that. The download page renders whatever this returns; /download/apk redirects to the
// asset it names. Nothing else in the app hardcodes a release URL, so moving the artefact
// somewhere else later is a change to this file rather than a hunt through the surface.
//
// Failure is a state, not an exception. GitHub is a third party with a rate limit, and a
// download page that 500s because somebody else on the same egress IP made sixty requests this
// hour is worse than a page that says "we cannot reach GitHub, here is the release list".

/** `owner/repo`. Overridable so a fork does not have to patch source to point at itself. */
export const REPO = process.env.GITHUB_RELEASES_REPO ?? "mattrickslauer/warrant";

/** How long a release listing is trusted. A release is published once and then never edited. */
const TTL_SECONDS = 300;

export interface ReleaseAsset {
  readonly name: string;
  /** The direct download. Redirects to a signed object store URL when fetched. */
  readonly url: string;
  readonly bytes: number;
  /** `sha256:…` when GitHub computed one. Absent on older releases. */
  readonly digest: string | null;
}

export interface ApkRelease {
  readonly tag: string;
  readonly title: string;
  readonly prerelease: boolean;
  readonly publishedAt: string | null;
  /** The release notes, as authored. Markdown, rendered here as plain text. */
  readonly notes: string;
  readonly pageUrl: string;
  readonly apk: ReleaseAsset;
}

export type ReleaseLookup =
  /** A published release carries an APK. */
  | { readonly state: "ok"; readonly release: ApkRelease }
  /** GitHub answered, and no release has an APK attached yet. */
  | { readonly state: "none" }
  /** GitHub did not answer. The page says so rather than pretending there is no build. */
  | { readonly state: "unavailable"; readonly why: string };

/** The releases page for the repo — always offered, including when the lookup failed. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

interface GhAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
  digest?: string | null;
}

interface GhRelease {
  tag_name?: string;
  name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  body?: string | null;
  html_url?: string;
  assets?: GhAsset[];
}

/**
 * The newest published release that actually carries an APK.
 *
 * Deliberately NOT `/releases/latest`: that endpoint hides prereleases, and a hackathon build
 * is a prerelease more often than not — the page would say "no build yet" while a perfectly
 * installable one sat on the releases page. So the list is read and the first non-draft entry
 * with an `.apk` asset wins. GitHub returns the list newest-first.
 *
 * Drafts are skipped because their assets are not downloadable without a token, so offering
 * one is offering a 404.
 */
export async function latestApk(): Promise<ReleaseLookup> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects an unidentified caller on some paths, and asks for this on all of them.
    "User-Agent": "warrant-web",
  };
  // Optional. Unauthenticated is 60 requests an hour per egress IP, which the cache below
  // keeps us far inside; a token raises it to 5000 for a deployment that needs it.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=20`,
      { headers, next: { revalidate: TTL_SECONDS } },
    );
  } catch {
    return { state: "unavailable", why: "GitHub could not be reached." };
  }

  if (!response.ok) {
    const why = response.status === 403 || response.status === 429
      ? "GitHub is rate-limiting this server."
      : `GitHub answered ${response.status}.`;
    return { state: "unavailable", why };
  }

  let releases: GhRelease[];
  try {
    releases = (await response.json()) as GhRelease[];
  } catch {
    return { state: "unavailable", why: "GitHub sent something this page could not read." };
  }
  if (!Array.isArray(releases)) {
    return { state: "unavailable", why: "GitHub sent something this page could not read." };
  }

  for (const release of releases) {
    if (release.draft) continue;
    const apk = pickApk(release.assets ?? []);
    if (!apk) continue;
    return {
      state: "ok",
      release: {
        tag: release.tag_name ?? "untagged",
        title: release.name?.trim() || release.tag_name || "Latest build",
        prerelease: release.prerelease === true,
        publishedAt: release.published_at ?? null,
        notes: clamp((release.body ?? "").trim()),
        pageUrl: release.html_url ?? RELEASES_PAGE,
        apk,
      },
    };
  }

  return { state: "none" };
}

/**
 * Which asset is the app.
 *
 * A release may carry several — a mapping file, a checksum, a debug build, one APK per ABI —
 * and only one of them is the thing to hand a stranger. So the candidates are scored rather
 * than filtered: a `universal` build installs on any phone, an ABI-specific one installs on
 * some and fails confusingly on the rest, and a debug build is the last resort rather than the
 * first match. `.aab` and `.apk.idsig` are excluded by the suffix test — neither is something a
 * browser can install.
 */
function pickApk(assets: GhAsset[]): ReleaseAsset | null {
  const apks = assets
    .filter((a) => (a.name ?? "").toLowerCase().endsWith(".apk") && a.browser_download_url);
  if (apks.length === 0) return null;

  const score = (name: string): number =>
    (/universal/i.test(name) ? 4 : 0) +
    (/release/i.test(name) ? 2 : 0) +
    (/debug/i.test(name) ? -1 : 0);

  const best = apks.reduce((a, b) => (score(b.name ?? "") > score(a.name ?? "") ? b : a));
  return {
    name: best.name ?? "app.apk",
    url: best.browser_download_url as string,
    bytes: typeof best.size === "number" ? best.size : 0,
    digest: best.digest ?? null,
  };
}

/**
 * The release notes, cut to what a download page can carry.
 *
 * They are authored markdown and shown here as plain text, which is fine for the paragraph a
 * release usually is and hostile for the thousand-line changelog a release occasionally is.
 * Past the limit the reader is sent to GitHub, where it is rendered properly.
 */
const NOTES_LIMIT = 900;

function clamp(notes: string): string {
  if (notes.length <= NOTES_LIMIT) return notes;
  const cut = notes.slice(0, NOTES_LIMIT);
  const breakAt = cut.lastIndexOf("\n");
  return `${(breakAt > NOTES_LIMIT / 2 ? cut.slice(0, breakAt) : cut).trimEnd()}…`;
}

/** Megabytes, one decimal. The number a person is deciding about on mobile data. */
export function megabytes(bytes: number): string {
  if (bytes <= 0) return "unknown size";
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A published date a human reads, in UTC so the server and the reader agree. */
export function publishedOn(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
