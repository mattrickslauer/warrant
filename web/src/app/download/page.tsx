import type { Metadata } from "next";
import Link from "next/link";
import { Wrap, Rule } from "@/components";
import { AppShell } from "../shell/AppShell";
import {
  latestApk, megabytes, publishedOn, REPO, RELEASES_PAGE, type ApkRelease,
} from "@/server/releases";

// Where a judge, a technician or a curious stranger gets the Android build.
//
// There is no Play listing and there will not be one before the deadline, so this page has to
// do everything a store listing does: say what the thing is, say what it needs, hand over a
// file, and — because a sideload is the one install Android actively warns about — say plainly
// what the warning will look like BEFORE it appears, so nobody backs out at the scary screen
// thinking something is wrong.
//
// The facts about the app come from the source that decides them:
//   android/app/build.gradle.kts   minSdk 26, applicationId ink.warrant
//   android/README.md              what is real, what is scripted, what is not built
// If one of those changes, this page is wrong until it is changed too.

export const metadata: Metadata = {
  title: "Warrant — get the Android app",
  description:
    "Download the latest Warrant APK straight from the GitHub release. What it needs, how to install it, how to check the file, and how to build it yourself instead.",
};

// The release listing is cached for five minutes inside latestApk(); the page follows it, so a
// build published mid-demo appears without a redeploy and GitHub is asked at most twelve times
// an hour however many people are looking.
export const revalidate = 300;

/** Android 8.0. From `minSdk = 26` in android/app/build.gradle.kts. */
const MIN_ANDROID = "Android 8.0 (Oreo, API 26)";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="stack" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="manual__code">{children}</pre>;
}

function M({ children }: { children: React.ReactNode }) {
  return <span className="manual__inline">{children}</span>;
}

/** One fact about the file you are about to install. */
function Fact({ term, meta, note }: { term: string; meta?: string; note?: string }) {
  return (
    <div className="w-def">
      <div className="w-def__head">
        <span className="w-def__term">{term}</span>
        {meta ? <span className="w-def__meta">{meta}</span> : null}
      </div>
      {note ? <p className="w-def__note">{note}</p> : null}
    </div>
  );
}

/** The hex of a `sha256:…` digest, or null when GitHub did not compute one. */
function sha256(digest: string | null): string | null {
  if (!digest) return null;
  const [algorithm, hex] = digest.split(":");
  return algorithm === "sha256" && hex ? hex : null;
}

/** The build, when there is one: what it is, and the button that fetches it. */
function Offer({ release }: { release: ApkRelease }) {
  const when = publishedOn(release.publishedAt);
  return (
    <div className="stack">
      <div>
        <Fact
          term={release.title}
          // Only when it adds something. A release usually has no name of its own, and GitHub
          // then reports the tag as both — printing it twice reads as a rendering bug.
          meta={release.title === release.tag ? undefined : release.tag}
          note={
            release.prerelease
              ? "A pre-release. It is the newest build with an APK attached, and it is what the demo runs."
              : undefined
          }
        />
        <Fact term="Published" meta={when ?? "date unknown"} />
        <Fact term={release.apk.name} meta={megabytes(release.apk.bytes)} />
      </div>

      <div className="w-step__exits">
        {/* The stable URL rather than the asset's own, so this button, the QR code on a slide
            and a link somebody pasted last week all resolve to the same current build. */}
        <a className="w-btn" href="/download/apk" download>
          Download the APK
        </a>
        <a className="w-btn w-btn--ghost" href={release.pageUrl} rel="noreferrer">
          Release notes on GitHub
        </a>
      </div>

      {release.notes ? (
        <div className="manual__note">
          <b>What changed</b>
          <p style={{ whiteSpace: "pre-wrap" }}>{release.notes}</p>
          <p>
            <a href={release.pageUrl} rel="noreferrer">The release on GitHub</a>, where the
            notes are rendered as written.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** No build published yet. Say so, and hand over the thing that does work instead. */
function NoBuild() {
  return (
    <div className="manual__note">
      <b>There is no published build yet.</b>
      <p>
        Nothing is attached to a release on <M>{REPO}</M> that a phone could install. The
        source builds — <a href="#source">the two commands are below</a> — and this page will
        show the file the moment a release carries one, with no redeploy.
      </p>
    </div>
  );
}

/** GitHub did not answer. Never pretend that means there is no build. */
function Unreachable({ why }: { why: string }) {
  return (
    <div className="manual__note">
      <b>Cannot reach GitHub right now.</b>
      <p>
        {why} That says nothing about whether a build exists — go straight to{" "}
        <a href={RELEASES_PAGE} rel="noreferrer">the releases page</a> and take the newest
        <M>.apk</M> attached to the top entry.
      </p>
    </div>
  );
}

export default async function Download() {
  const found = await latestApk();
  const digest = found.state === "ok" ? sha256(found.release.apk.digest) : null;

  return (
    <AppShell tone="work" frame="app">
      <main className="page__body">
        <Wrap>
          <article className="manual stack stack--lg">

            <div className="stack">
              <p className="eyebrow">Android · installed from a file, not a store</p>
              <h1 className="hero">The app that makes the evidence.</h1>
              <p className="lede">
                Everything else in Warrant reads records. This is the surface that writes them —
                the camera, the on-device redaction, the Bluetooth instrument read, the gate that
                will not let a step past without the proof it asked for. It is a real Android
                app, and until it is on Play you install it the way you install any APK.
              </p>
            </div>

            <Rule />

            <Section id="get" title="The latest build">
              {found.state === "ok" ? <Offer release={found.release} /> : null}
              {found.state === "none" ? <NoBuild /> : null}
              {found.state === "unavailable" ? <Unreachable why={found.why} /> : null}
            </Section>

            <Rule />

            <Section id="install" title="Installing it">
              <p>
                Open this page <strong>on the phone</strong> and tap the button. Everything below
                happens once, and only for this browser.
              </p>
              <ol>
                <li>
                  The download lands in Downloads. Tap the notification, or open the file from
                  the Files app.
                </li>
                <li>
                  Android will say the browser <em>is not allowed to install unknown apps</em>.
                  That prompt is expected — it appears for every app not fetched from a store.
                  Tap <strong>Settings</strong>, turn on <strong>Allow from this source</strong>,
                  and come back.
                </li>
                <li>
                  Play Protect will offer to scan the file. Let it. It has never seen this app
                  before, so it may still warn you afterwards; <strong>Install anyway</strong> is
                  the button that continues.
                </li>
                <li>
                  On first run the app asks for the camera, and for nearby-devices if you are
                  pairing an instrument. Both are refusable — a step that needs one says so
                  rather than failing quietly.
                </li>
              </ol>
              <div className="manual__note">
                <b>Turn the permission back off afterwards.</b>
                <p>
                  <M>Settings → Apps → Special access → Install unknown apps</M>. Leaving a
                  browser able to install anything it downloads is a worse posture than the one
                  you started with, and this app does not need it again.
                </p>
              </div>
            </Section>

            <Rule />

            <Section id="check" title="Checking the file is the file">
              {digest ? (
                <>
                  <p>
                    GitHub publishes a SHA-256 for the asset it served. Compare it against what
                    landed on your machine — a mismatch means you did not get this file.
                  </p>
                  <Code>{`sha256sum ${found.state === "ok" ? found.release.apk.name : "app.apk"}\n${digest}`}</Code>
                </>
              ) : (
                <p>
                  A checksum appears here when the release carries one. Until then, the honest
                  check is the one below: build it yourself and install what you built.
                </p>
              )}
              <p>
                The build is unsigned by any authority you have reason to trust — there is no
                Play signature behind it and no notarisation. <strong>Install it because you
                read the source, or because you built it.</strong> That is the whole of the
                trust story, and this page is not going to dress it up.
              </p>
            </Section>

            <Rule />

            <Section id="needs" title="What it needs">
              <div>
                <Fact
                  term="Android version"
                  meta={MIN_ANDROID}
                  note="Below that it will not install at all — the platform refuses before the app runs."
                />
                <Fact
                  term="Camera"
                  note="Evidence capture and the on-device face redaction. Refusable; steps that need a photograph say so."
                />
                <Fact
                  term="Bluetooth and nearby devices"
                  note="Only to pair an instrument. Without it the app still runs — a value you type is asserted rather than measured, and the record says which."
                />
                <Fact
                  term="Network"
                  note="For the agents. Capture works offline; the verdicts do not."
                />
              </div>
            </Section>

            <Rule />

            <Section id="honest" title="What is real and what is scripted">
              <p>
                The app says this on screen too. A demo that looks like production is how
                somebody gets misled, so the fixture banner at the top of a job is not
                decoration.
              </p>
              <div className="manual__tablewrap">
                <table className="manual__table">
                  <tbody>
                    <tr>
                      <td>Real</td>
                      <td>
                        Camera capture, on-device face redaction, BLE scan / connect / GATT read,
                        driver decoding, the tier refusal, the Seal and the Gate
                      </td>
                    </tr>
                    <tr>
                      <td>Scripted</td>
                      <td>
                        Agent verdicts, their rationales and their costs — played from{" "}
                        <M>data/Fixtures.kt</M> on a clock
                      </td>
                    </tr>
                    <tr>
                      <td>Not built</td>
                      <td>
                        Google sign-in, the network layer, Play Integrity attestation, plate
                        redaction, speech-to-text on spoken reasons
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Rule />

            <Section id="source" title="Building it yourself instead">
              <p>
                Two commands, JDK 17 and an Android SDK with platform 35. <M>local.properties</M>{" "}
                points at the SDK and is not committed.
              </p>
              <Code>{`git clone https://github.com/${REPO}.git\ncd warrant/android\n./gradlew assembleDebug\nadb install -r app/build/outputs/apk/debug/app-debug.apk`}</Code>
              <p>
                The debug build installs alongside a downloaded one — its application id carries
                a <M>.debug</M> suffix — so you can hold both and compare them.
              </p>
              <div className="w-step__exits">
                <Link className="w-btn w-btn--ghost" href="/">Try a task in the browser</Link>
                <Link className="w-btn w-btn--ghost" href="/about">What this is for</Link>
              </div>
            </Section>

          </article>
        </Wrap>
      </main>
    </AppShell>
  );
}
