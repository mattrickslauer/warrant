// Who may change who works here.
//
// The standing model was fully built and completely unreachable: `setRole` had no caller,
// `listMembers` had no caller, and `disabled` — which `session.ts` and `bearer.ts` each pay a
// lookup per request to honour — was written `false` at creation and never again. So these tests
// are about a rule that until now had no way to be exercised at all.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canChangeMember, standingFor, mayWaive } from "../src/auth/members.ts";

const owner = { uid: "owner_1", role: "owner", disabled: false };
const owner2 = { uid: "owner_2", role: "owner", disabled: false };
const tech = { uid: "tech_1", role: "technician", disabled: false };

describe("only an owner administers a shop", () => {
  test("a technician cannot promote anybody, including themselves", () => {
    const v = canChangeMember(tech, owner, { role: "viewer" }, [owner.uid]);
    assert.equal(v.ok, false);
    assert.equal(v.status, 403);
  });

  test("a DISABLED owner is not an owner", () => {
    // The flag exists so access ends without the document being deleted. Honouring it
    // everywhere except here would make it decorative.
    const v = canChangeMember({ ...owner, disabled: true }, tech, { role: "foreman" }, []);
    assert.equal(v.ok, false);
    assert.equal(v.status, 403);
  });

  test("an owner may promote a technician", () => {
    assert.equal(canChangeMember(owner, tech, { role: "foreman" }, []).ok, true);
  });

  test("an owner may disable a departed technician", () => {
    assert.equal(canChangeMember(owner, tech, { disabled: true }, []).ok, true);
  });

  test("a uid that is not a member of this tenant resolves to nothing", () => {
    const v = canChangeMember(owner, null, { role: "foreman" }, []);
    assert.equal(v.ok, false);
    assert.equal(v.status, 404);
  });

  test("a change that changes nothing is refused rather than written", () => {
    assert.equal(canChangeMember(owner, tech, {}, []).ok, false);
  });
});

describe("nobody acts on themselves", () => {
  test("an owner cannot change their own role", () => {
    const v = canChangeMember(owner, owner, { role: "viewer" }, [owner.uid, owner2.uid]);
    assert.equal(v.ok, false);
    assert.equal(v.status, 409);
  });
  test("nor disable themselves", () => {
    const v = canChangeMember(owner, owner, { disabled: true }, [owner.uid, owner2.uid]);
    assert.equal(v.ok, false);
  });
});

// THE LOCKOUT. `ensureMember` only makes somebody an owner when the member collection is EMPTY,
// so a tenant that loses its last owner can never grow another one from inside the product —
// nothing could be published and no waiver above a technician's standing could ever be signed.
describe("never the last owner", () => {
  test("demoting the only other owner is refused", () => {
    const v = canChangeMember(owner, owner2, { role: "technician" }, [owner2.uid]);
    assert.equal(v.ok, false);
    assert.equal(v.status, 409);
    assert.match(v.error, /only owner left/);
  });

  test("disabling the only other owner is refused", () => {
    const v = canChangeMember(owner, owner2, { disabled: true }, [owner2.uid]);
    assert.equal(v.ok, false);
  });

  test("but demoting one of two owners is fine", () => {
    const v = canChangeMember(owner, owner2, { role: "foreman" }, [owner.uid, owner2.uid]);
    assert.equal(v.ok, true);
  });

  test("an already-disabled owner is not one of the owners being counted", () => {
    // Demoting somebody who already holds no access cannot cost the tenant its last owner.
    const dormant = { uid: "owner_3", role: "owner", disabled: true };
    assert.equal(canChangeMember(owner, dormant, { role: "viewer" }, [owner.uid]).ok, true);
  });

  test("promoting somebody TO owner is never a lockout", () => {
    assert.equal(canChangeMember(owner, tech, { role: "owner" }, []).ok, true);
  });
});

// Standing is recomputed from the role and never passed in, so the two cannot drift apart.
describe("standing follows the role", () => {
  test("a promotion carries the waiver limit with it", () => {
    assert.equal(standingFor("foreman").may_waive_to_strictness, 2);
    assert.equal(standingFor("technician").may_waive_to_strictness, 1);
    assert.equal(standingFor("viewer").may_waive_to_strictness, -1);
  });

  test("a disabled member may waive nothing, whatever their standing says", () => {
    assert.equal(mayWaive({ standing: standingFor("owner"), disabled: true }, 1), false);
    assert.equal(mayWaive({ standing: standingFor("owner"), disabled: false }, 3), true);
  });
});
