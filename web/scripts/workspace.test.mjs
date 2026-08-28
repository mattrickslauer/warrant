// The Workspace projection, in the parts that can be wrong without a network.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/workspace.test.mjs
//
// No emulator and no Google. Everything here is a pure function on purpose: the three things
// that would actually hurt somebody — a header injection in a purchase order, a ledger whose
// columns stopped matching its header, and a record document that reads as more confident than
// the record — are all decided before any API is called, so they are all testable without one.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { rawMessage, headerSafe, orderSubject, orderBody } =
  await import("../src/server/gmail.ts");
const { ledgerRow, LEDGER_HEADER } = await import("../src/server/drive.ts");
const { recordHtml } = await import("../src/server/workspace-sync.ts");

const order = {
  uid: "u1",
  supplierEmail: "parts@supplier.example",
  partNumber: "45105-MEE-006",
  grade: "A2-70",
  quantity: 4,
  assetLabel: "CB500X — WR12 ABC",
  rationale: "Two of the four caliper bolts are rounded and cannot be torqued to spec.",
  taskId: "approve_order__dec-99",
  recordUrl: "https://warrant.example/job/j1",
  shopName: "acme.com",
};

describe("a purchase order is a document, not a string concatenation", () => {
  test("a part number carrying CRLF cannot add a header", () => {
    // The attack: a part number is a string an agent read off a photograph of a label. If it
    // reaches a header unescaped, "\r\nBcc: someone@example.com" becomes a REAL Bcc on a real
    // purchase order, and the shop's orders quietly copy to a stranger.
    const hostile = { ...order, partNumber: "X-1\r\nBcc: attacker@example.com" };
    const subject = orderSubject(hostile);
    assert.ok(!subject.includes("\r"), "no CR survives into a subject");
    assert.ok(!subject.includes("\n"), "no LF survives into a subject");

    const decoded = Buffer.from(
      rawMessage({ to: "a@b.example", subject, body: "x" }), "base64url",
    ).toString("utf8");
    const headerBlock = decoded.split("\r\n\r\n")[0];
    assert.ok(!/^Bcc:/im.test(headerBlock), "the injected Bcc is not a header");
  });

  test("a leading tab cannot continue a header either", () => {
    // The same trick with different bytes: a leading tab makes a line a CONTINUATION of the
    // header above it, so a value beginning with one can extend a header it was never part of.
    assert.equal(headerSafe("\tX-Evil: yes"), "X-Evil: yes");
    assert.ok(!headerSafe("a\tb").includes("\t"));
  });

  test("the draft says what is being ordered, and for what", () => {
    const body = orderBody(order);
    assert.match(body, /45105-MEE-006/);
    // The grade of a fastener is the detail outsiders never think of and the one a shop is
    // most annoyed to receive wrong. It gets its own line or it is not in the order.
    assert.match(body, /A2-70/);
    assert.match(body, /CB500X/);
    assert.match(body, /caliper bolts are rounded/);
  });

  test("the draft tells the person that nothing has been sent", () => {
    // This sentence is the product's whole claim about agent authority, printed where the
    // person acting on it will read it. An order that did not say so would be an order that
    // looked like it had already gone out.
    assert.match(orderBody(order), /draft in your mailbox until you press send/);
  });

  test("an order with no supplier is still a draft, and says so", () => {
    const body = orderBody({ ...order, supplierEmail: null });
    assert.match(body, /No supplier address yet/);
    assert.match(body, /45105-MEE-006/);
  });

  test("the quantity defaults to one rather than to nothing", () => {
    assert.match(orderBody({ ...order, quantity: null }), /Quantity {6}1/);
  });
});

describe("the ledger", () => {
  const entry = {
    tenantId: "acme.com", uid: "u1", shopName: "acme.com",
    recordId: "rec-1", sealedAt: "2026-08-27T10:00:00Z",
    procedureTitle: "Front brake service", procedureVersion: 3,
    assetLabel: "CB500X", technician: "J. Tedesco",
    tier: "instrumented", machineReleased: false, deficiencies: 2,
    recordUrl: "https://warrant.example/r/abc", documentHtml: "<html></html>",
  };

  test("a row has exactly as many cells as the header has columns", () => {
    // The failure this catches is silent and permanent: a column added to the header without
    // one added to the row shifts every later value one cell left, for every seal from then
    // on, in a spreadsheet nobody re-reads until they need it in a dispute.
    assert.equal(ledgerRow(entry, null).length, LEDGER_HEADER.length);
  });

  test("a held machine reads as held, not as blank", () => {
    const row = ledgerRow(entry, null);
    assert.equal(row[LEDGER_HEADER.indexOf("Machine released")], "held");
    assert.equal(
      ledgerRow({ ...entry, machineReleased: true }, null)[
        LEDGER_HEADER.indexOf("Machine released")],
      "released",
    );
  });

  test("the document column is empty rather than 'null' when there is no document", () => {
    assert.equal(ledgerRow(entry, null)[LEDGER_HEADER.indexOf("Document")], "");
  });
});

describe("the record, as a stranger reads it in Drive", () => {
  const record = {
    id: "rec-1", job_id: "j1", tenant_id: "acme.com", public: false,
    sealed_at: "2026-08-27T10:00:00Z",
    ceiling_tier: "attested",
    ceiling_reachable: ["asserted", "inferred"],
    ceiling_unreachable: [{ class: "measured", reason: "No instrument was paired." }],
    deficiencies: [],
    machine_released: true,
    steps: [{ id: "o1", job_id: "j1", step_id: "remove-wheel", status: "performed" }],
    decisions: [],
    actors: [{ uid: "u1", display_name: "J. Tedesco", role: "technician" }],
  };
  const opts = { procedureTitle: "Front brake service", procedureVersion: 3,
                 assetLabel: "CB500X", shopName: "acme.com" };

  test("a held machine is stated in capitals, because it is the headline", () => {
    const html = recordHtml({ ...record, machine_released: false }, opts);
    assert.match(html, /HELD/);
    assert.ok(!/Released\. Every binding step passed/.test(html));
  });

  test("no deficiencies is a sentence, not an absent section", () => {
    // An omitted heading reads as an oversight. This sentence is a claim the record makes.
    assert.match(recordHtml(record, opts), /None\. Every binding step was settled by evidence\./);
  });

  test("what the evidence cannot support is printed, not just what it can", () => {
    assert.match(recordHtml(record, opts), /No instrument was paired\./);
  });

  test("the tier is described as earned rather than claimed", () => {
    assert.match(recordHtml(record, opts), /what the evidence EARNED, not what the job/);
  });

  test("the document says it is a copy and not the evidence", () => {
    // The one way this document could do harm: being mistaken for the record. A Google Doc is
    // editable by whoever holds it, so it must point at the thing that is not.
    assert.match(recordHtml(record, opts), /is not itself the evidence/);
  });

  test("a display name containing markup cannot inject into the document", () => {
    const html = recordHtml(
      { ...record, actors: [{ uid: "u1", display_name: "<script>x</script>", role: "tech" }] },
      opts,
    );
    assert.ok(!html.includes("<script>"), "the tag is escaped");
    assert.match(html, /&lt;script&gt;/);
  });
});

describe("the draft carries its own provenance", () => {
  test("the task id is on the message as a header", async () => {
    // Not for lookup — the task document holds the draft id for that — but so a person or a
    // Gmail filter can tell an order Warrant drafted from one a colleague wrote by hand.
    const decoded = Buffer.from(
      rawMessage({
        to: "a@b.example", subject: "s", body: "b",
        headers: { "X-Warrant-Task-Id": "approve_order__dec-99" },
      }),
      "base64url",
    ).toString("utf8");
    assert.match(decoded, /^X-Warrant-Task-Id: approve_order__dec-99$/m);
  });

  test("the body is separated from the headers by exactly one blank line", () => {
    // A malformed separator makes the whole body render as headers, or the headers as body.
    const decoded = Buffer.from(
      rawMessage({ to: "a@b.example", subject: "s", body: "the body" }), "base64url",
    ).toString("utf8");
    const [headers, ...rest] = decoded.split("\r\n\r\n");
    assert.match(headers, /^To: a@b\.example/);
    assert.equal(rest.join("\r\n\r\n"), "the body");
  });
});
