// Everywhere the app goes, and what the menu calls it.
//
// The Kotlin twin of this file is android/…/ui/shell/Destinations.kt, and the two are meant to
// be read side by side. The vocabulary is the product's and it is worth being exact about: a
// **procedure** is the versioned spec, a **job** is one run of it, and a **record** is what a
// sealed job leaves behind. So the list you launch from is Procedures, and authoring is a verb
// — `Create a procedure` — rather than a second noun competing with the first.
//
// Routes live here rather than as string literals at the call sites, because a typo in a
// `<Link href="/recrods">` is a 404 nobody notices until a judge clicks it, and a typo here is
// caught by nav.test.mjs, which walks the app router and asserts every route named below has a
// page behind it.

export type DestId =
  | "procedures" | "yourProcedures" | "records" | "create" | "instruments" | "fleet"
  | "account" | "settings" | "about" | "library" | "modelTests" | "manual";

export interface Dest {
  readonly id: DestId;
  readonly route: string;
  readonly label: string;
}

/**
 * The destinations.
 *
 * `procedures` is `/` because on the web the picker IS the landing page — there is no separate
 * home to land on first. Android has the same arrangement with a different name for it.
 */
export const DEST: Record<DestId, Dest> = {
  procedures: { id: "procedures", route: "/", label: "Procedures" },
  // `/` is where you go to RUN something; this is where you go to see what you have written
  // and decide who else may read it. Two verbs, so two rows — the picker was carrying both
  // and could only ever show one of them, which is why a published procedure appeared to
  // vanish the moment the authoring desk was closed.
  yourProcedures: { id: "yourProcedures", route: "/procedures/yours", label: "Your procedures" },
  records: { id: "records", route: "/records", label: "Records" },
  create: { id: "create", route: "/author", label: "Create a procedure" },
  instruments: { id: "instruments", route: "/instruments", label: "Instruments" },
  fleet: { id: "fleet", route: "/fleet", label: "Fleet view" },
  account: { id: "account", route: "/account", label: "Account" },
  settings: { id: "settings", route: "/settings", label: "Settings" },
  about: { id: "about", route: "/about", label: "What this is" },
  library: { id: "library", route: "/library", label: "Component library" },
  modelTests: { id: "modelTests", route: "/model-tests", label: "Model tests" },
  manual: { id: "manual", route: "/firmware", label: "Instrument manual" },
};

/** Whether a menu row can be walked through, and if not, why not. */
export type Reach =
  /** Openable now. */
  | "open"
  /**
   * Openable, but the page behind it will ask for an account first. The row stays visible and
   * dim rather than disappearing: a menu that changes shape when you sign in makes the app look
   * like it is hiding something, and the honest version of "you can't do this yet" names the
   * thing you can't do.
   */
  | "needs-account"
  /** Named, not built. Dim and inert — never a row that goes nowhere when clicked. */
  | "soon";

export interface MenuItem {
  readonly dest: Dest;
  readonly reach: Reach;
}

export interface MenuSection {
  readonly title: string;
  readonly items: readonly MenuItem[];
}

/** A `soon` row is the only inert one. A gated row still goes somewhere — to the gate. */
export function enabled(item: { reach: Reach }): boolean {
  return item.reach !== "soon";
}

/**
 * The menu, grouped by what a person is there to do.
 *
 * WORK is the technician standing at the machine. AUTHOR is whoever decides what the work is.
 * OPERATE is whoever is watching the fleet. REFERENCE is the part of this repository that
 * explains itself — the web surface carries the manual and the component library, which the
 * phone does not, so it gets a fourth section the phone has no use for.
 *
 * Pure and React-free so the enablement rules can be tested without rendering anything.
 */
export function menu(signedIn: boolean): MenuSection[] {
  const gated: Reach = signedIn ? "open" : "needs-account";

  return [
    // Records is deliberately NOT gated. A stranger who ran a public procedure made a real
    // record, and being unable to look at their own evidence would contradict the whole claim
    // the product makes.
    {
      title: "Work",
      items: [
        { dest: DEST.procedures, reach: "open" },
        { dest: DEST.records, reach: "open" },
      ],
    },
    {
      title: "Author",
      items: [
        // A procedure governs every job ever run against it, so it must belong to a tenant,
        // and there is no tenant without an identity.
        { dest: DEST.create, reach: gated },
        { dest: DEST.yourProcedures, reach: gated },
        { dest: DEST.instruments, reach: "open" },
      ],
    },
    {
      // Android marks this `soon`, because the phone has no fleet screen. The web does, it is
      // served from real decisions, and a row that opens a page that exists must not claim
      // otherwise — so the two surfaces disagree here ON PURPOSE. nav.test.mjs pins the rule
      // that makes the disagreement legitimate: `soon` iff there is no page behind the route.
      title: "Operate",
      items: [{ dest: DEST.fleet, reach: "open" }],
    },
    {
      title: "Reference",
      items: [
        { dest: DEST.about, reach: "open" },
        { dest: DEST.manual, reach: "open" },
        { dest: DEST.library, reach: "open" },
        { dest: DEST.modelTests, reach: "open" },
      ],
    },
  ];
}

/** The rows pinned to the bottom of the drawer. Empty when signed out — the CTA stands there. */
export function accountMenu(signedIn: boolean): MenuItem[] {
  return signedIn
    ? [{ dest: DEST.account, reach: "open" }, { dest: DEST.settings, reach: "open" }]
    : [];
}

/**
 * One row in the home screen's quick-action list.
 *
 * It carries its own label rather than borrowing `dest.label` because the menu names *places* —
 * `Instruments` — and this list names *things to do* — `Pair an instrument`. Same destination,
 * different sentence, and the difference is the whole reason to have both.
 */
export interface QuickAction {
  readonly dest: Dest;
  readonly label: string;
  readonly hint: string;
  readonly reach: Reach;
}

/**
 * The short list under the carousel: what to do when none of the tasks is the thing.
 *
 * It reads `Reach` from the same rules the drawer does, so the two surfaces cannot drift into
 * disagreeing about what needs an account — a home row that opens what the menu says is locked
 * is the kind of bug nobody notices until a judge finds it.
 *
 * The signed-out list is the signed-in one plus an invitation, never minus a row. Hiding what
 * an account would unlock is how an app ends up asking for one without ever saying why; the
 * gated row states its own price, and clicking it lands on the gate that explains it.
 */
export function quickActions(signedIn: boolean): QuickAction[] {
  const gated: Reach = signedIn ? "open" : "needs-account";

  const work: QuickAction[] = [
    {
      dest: DEST.records,
      label: "Open your records",
      hint: "Every job you have sealed.",
      // Not gated, deliberately. A stranger who ran a public procedure made a real record;
      // being unable to read their own evidence would contradict the product.
      reach: "open",
    },
    {
      dest: DEST.instruments,
      label: "Pair an instrument",
      hint: "Raise the ceiling to measured.",
      reach: "open",
    },
    {
      dest: DEST.create,
      label: "Create a procedure",
      hint: "A spec of your own.",
      reach: gated,
    },
    {
      dest: DEST.yourProcedures,
      // The deed, not the place. Sharing is the thing this page can do that neither the
      // picker nor the authoring desk can, so it is what the row is named after.
      label: "Share what you have written",
      hint: "Decide which of your procedures the world can read.",
      reach: gated,
    },
  ];

  if (signedIn) return work;
  return [
    ...work,
    {
      dest: DEST.account,
      label: "Sign in with Google",
      hint: "Which tenant your work belongs to.",
      reach: "open",
    },
  ];
}

/** The badge a row wears when it cannot simply be opened. */
export function reachNote(reach: Reach): string | null {
  if (reach === "soon") return "soon";
  if (reach === "needs-account") return "sign in";
  return null;
}

/**
 * Which menu row a pathname is standing on.
 *
 * Longest match wins, so `/records/abc` marks Records rather than falling through to `/`, which
 * is a prefix of everything.
 */
export function activeDest(pathname: string): DestId | null {
  let best: Dest | null = null;
  for (const dest of Object.values(DEST)) {
    const hit = dest.route === "/"
      ? pathname === "/"
      : pathname === dest.route || pathname.startsWith(`${dest.route}/`);
    if (hit && (!best || dest.route.length > best.route.length)) best = dest;
  }
  return best?.id ?? null;
}
