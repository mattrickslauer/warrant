"use client";

// The shell every screen sits inside: one bar, one menu, one place the tenant is stated.
//
// Before this existed the web surface had two half-shells — a `Masthead` with four marketing
// links that carried the only sign-in control in the product, and a bare `topbar` on the
// screens a technician actually uses, which carried nothing. So the pages where identity
// decides what you can do were the pages with no way to sign in, and the menu that android has
// had since its first commit had no web counterpart at all.
//
// This is that counterpart. The drawer is a port of android/…/ui/shell/Drawer.kt down to the
// gating rules, which both surfaces now read out of the same shape (nav.ts / Destinations.kt)
// rather than each deciding for itself what needs an account.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/auth/session-context";
import { activeDest, accountMenu, enabled, menu, reachNote, type DestId, type MenuItem } from "./nav";

/**
 * @param tone  which ground the page under the shell is on — the bar follows it.
 * @param frame `page` is a document: gutters, a body with breathing room, a footer. `app` is a
 *   full-bleed surface that owns its own layout — the picker, the fleet view, the manual — and
 *   gets the bar and the menu without having its content boxed.
 * @param footer false where the page continues past this shell — /library stacks a second
 *   ground underneath and carries its own footer, and two in a row reads as a mistake.
 */
export function AppShell({
  children,
  tone = "work",
  frame = "page",
  footer = true,
}: {
  children: React.ReactNode;
  tone?: "work" | "paper";
  frame?: "page" | "app";
  footer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const current = activeDest(pathname);

  // Navigating closes the drawer. Without this the menu stays open over the page it just
  // opened, which on a phone means the first thing you do after choosing is dismiss.
  useEffect(() => { setOpen(false); }, [pathname]);

  const chrome = (
    <>
      <TopBar onOpen={() => setOpen(true)} />
      <Drawer open={open} current={current} onClose={() => setOpen(false)} />
    </>
  );

  return (
    <div className={`w-ground w-ground--${tone}`}>
      {frame === "app" ? (
        <div className="app">{chrome}{children}</div>
      ) : (
        <div className="page">
          {chrome}
          <main className="page__body"><div className="w-wrap">{children}</div></main>
          {footer && <ShellFooter />}
        </div>
      )}
    </div>
  );
}

function TopBar({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="shellbar">
      <button type="button" className="shellbar__menu" onClick={onOpen} aria-label="Open the menu">
        <span aria-hidden />
      </button>
      <Link className="shellbar__logo" href="/"><i aria-hidden />Warrant</Link>
      <div className="shellbar__spacer" />
      <TenantChip />
    </header>
  );
}

/**
 * Who you are signed in as, in the bar, on every screen.
 *
 * It shows the ADDRESS, not the tenant id. The tenant id is the right thing to store and the
 * wrong thing to put in a bar: for a Workspace account it happens to be the domain and reads
 * fine, but for a personal account it is `u:{uid}` — a Firebase uid, which to the person
 * holding it is an unreadable string that tells them nothing about who they are signed in as.
 * A chip nobody can read is worse than no chip, because it looks like a bug.
 *
 * The tenant is still stated, at the two places where it is the actual subject: the drawer's
 * identity row, and /account, which explains what the tenant means and shows its id verbatim.
 * `data-kind` stays on this element so the border still separates a Workspace tenant from a
 * personal one from an unclaimed visitor — the distinction survives, the gibberish does not.
 *
 * Mono, because the address came from Google rather than from anything typed here — the same
 * provenance rule the rest of the product follows.
 */
function TenantChip() {
  const { session, configured } = useSession();
  if (!configured || !session) return null;

  // An anonymous visitor has no address at all, so there is nothing to show but the state.
  const who = session.email ?? session.name ?? "visitor — not signed in";

  return (
    <span
      className="shellbar__tenant tenant"
      data-kind={session.tenant.kind}
      title={`${who} · ${tenantLabel(session.tenant)}`}
    >
      <span className="tenant__id">{who}</span>
    </span>
  );
}

/**
 * The menu.
 *
 * Grouped by the role a person is in — work, author, operate, reference — rather than flattened
 * into eleven equal rows, because almost nobody is in more than one of those roles at a time
 * and a flat list makes you read all eleven to find your two.
 *
 * Signed out, the list does not change shape. The rows that need an account stay where they
 * are, dim, labelled, and still clickable — each one leads to the same sign-in gate, which then
 * lands you on the page you asked for rather than back at the beginning.
 */
function Drawer({
  open, current, onClose,
}: { open: boolean; current: DestId | null; onClose: () => void }) {
  const { session, configured, signIn } = useSession();
  const signedIn = Boolean(session) && !session?.anonymous;
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes it, and focus moves inside when it opens. A drawer you can only leave with
  // the mouse is a drawer a keyboard user is trapped behind.
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className={`drawer${open ? " drawer--open" : ""}`} aria-hidden={!open}>
      <button
        type="button"
        className="drawer__scrim"
        tabIndex={open ? 0 : -1}
        aria-label="Close the menu"
        onClick={close}
      />
      <div
        className="drawer__panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal={open}
        aria-labelledby={titleId}
      >
        {/* The same bar the page behind it has, so the ☰ does not move when the drawer opens —
            it is the same button, and it now closes what it opened. */}
        <div className="drawer__head">
          <button type="button" className="shellbar__menu" onClick={close} aria-label="Close the menu">
            <span aria-hidden />
          </button>
          <span className="drawer__title" id={titleId}>Warrant</span>
        </div>
        <div className="w-rule" />

        <nav className="drawer__body">
          {menu(signedIn).map((section) => (
            <div className="drawer__section" key={section.title}>
              <p className="drawer__sectiontitle">{section.title}</p>
              {section.items.map((item) => (
                <MenuRow key={item.dest.id} item={item} current={current === item.dest.id} />
              ))}
            </div>
          ))}
        </nav>

        {signedIn && session ? (
          <div className="drawer__foot">
            <div className="w-rule" />
            <Link className="drawer__identity" href="/account">
              {/* An initial, not a photo. Loading the avatar would mean a network call on the
                  one surface that has to open instantly. */}
              <span className="drawer__avatar" aria-hidden>
                {(session.name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="drawer__who">
                <span className="drawer__name">{session.name ?? session.email}</span>
                {/* Mono: a machine decided this — from the hd claim, not from anything typed. */}
                <span className="drawer__tenant w-mono">{tenantLabel(session.tenant)}</span>
              </span>
            </Link>
            {accountMenu(true).map((item) => (
              <MenuRow key={item.dest.id} item={item} current={current === item.dest.id} />
            ))}
          </div>
        ) : (
          // Signed out: the invitation stands in the free space rather than sitting at the
          // bottom, because it is the only thing down there and a lone button pinned to a
          // corner reads as an afterthought.
          <div className="drawer__cta">
            <p className="drawer__ctawhy">
              Running a procedure needs no account. Anything that belongs to somebody does.
            </p>
            {configured ? (
              // One button, not two: with Google there is no separate sign-up. The first
              // sign-in is what creates the tenant.
              <button
                type="button"
                className="w-btn signin__google"
                onClick={() => void signIn()}
              >
                <GoogleMark />
                Sign in with Google
              </button>
            ) : (
              <p className="drawer__ctanote w-mono">no project connected — fixture data</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One row, with a bar marking where you already are.
 *
 * A row you cannot use still says what it is and why — `soon` for what is not built, `sign in`
 * for what needs an account. A greyed row with no explanation is just a bug the user has to
 * guess at.
 */
function MenuRow({ item, current }: { item: MenuItem; current: boolean }) {
  const note = reachNote(item.reach);
  const body = (
    <>
      <span className="menurow__mark" aria-hidden />
      <span className="menurow__label">{item.dest.label}</span>
      {note ? <span className="menurow__note w-mono">{note}</span> : null}
    </>
  );

  if (!enabled(item)) {
    return <span className="menurow menurow--inert" aria-disabled>{body}</span>;
  }
  return (
    <Link
      className={`menurow${current ? " menurow--current" : ""}${item.reach === "needs-account" ? " menurow--gated" : ""}`}
      href={item.dest.route}
      aria-current={current ? "page" : undefined}
    >
      {body}
    </Link>
  );
}

function ShellFooter() {
  const { session } = useSession();
  return (
    <footer className="w-wrap footer">
      <span>Warrant</span>
      <span className="w-mono">
        {session ? `signed in · ${tenantLabel(session.tenant)}` : "not signed in · unclaimed work"}
      </span>
    </footer>
  );
}

export function tenantLabel(tenant: { id: string; kind: string }): string {
  if (tenant.kind === "workspace") return tenant.id;
  if (tenant.kind === "anon") return "Unclaimed — this browser only";
  return "Personal — just you";
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
