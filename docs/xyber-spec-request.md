# The figures we need from Segway, and why we cannot proceed without them

**Status: drafted, not sent.** Sending is a decision for a person, not for the build.

## Why this document exists

Warrant compiles a maintenance procedure by interviewing whoever does the job, and it has one
rule it will not break: **it never states a figure nobody gave it.** A tolerance invented by a
model enters every future record indistinguishable from one a person set, and no one reading
that record later can tell which is which — which would destroy the only thing the product is
for.

That rule has now produced a concrete, reproducible refusal. Asked to compile a front brake pad
replacement for the Segway Xyber, the Scoper interviewed the rider, established the job, the
wear check, the disqualifier and the bedding-in — and then declined to compile, because the
caliper bolt torque exists nowhere it can reach. The scenario is in the corpus at
`agents/evals/scenarios/scoper/interview-home-brake-pads-blocked-on-a-figure-nobody-has.json`
and it asserts that the refusal happens.

**This is the system working, not failing.** But it does mean the Xyber cannot carry a complete
brake procedure until Segway supplies the numbers, and no amount of engineering on our side
substitutes for that. Hence this request.

## What we are asking for

Everything below is a figure a competent owner cannot obtain by looking at the machine. Where a
value is already printed on the vehicle or moulded into a component we are not asking for it —
tyre pressure, for instance, comes off the sidewall and our procedures read it there.

| Figure | Why the procedure stops without it |
|---|---|
| **Front and rear brake caliper mounting bolt torque**, with tolerance | The step that fails silently. An under-torqued caliper bolt backs out under braking heat and the caliper moves; over-torquing strips an alloy mount. There is no safe way to infer this. |
| **Brake pad minimum friction material thickness** | Decides when a pad is finished. Riders currently judge by eye. |
| **Brake disc minimum thickness and maximum runout** | Decides whether a disc is serviceable or scrap, which new pads cannot fix. |
| **Brake fluid specification** — mineral oil or DOT, and which grade | Mineral and DOT are not interchangeable; the wrong one swells every seal in the system and the brake fails days later. If this is stamped on the lever or reservoir we will read it there instead — please say if it is. |
| **Front and rear axle / wheel fastener torque** | Required to record a wheel refit as anything better than "done up by feel". |
| **Any fastener on the brake or wheel assembly that is single-use** | A bolt that must be replaced rather than reused is a parts requirement, not a torque figure, and omitting it is its own failure. |

If a service manual exists that covers these, that is the better answer than a list — we would
rather cite a published document than a message, because a procedure that cites its source can
be audited by whoever reads the record years later.

## What we will do with them

The figures go into a **catalogue** the Scoper is permitted to look up rather than ask for, and
each compiled bound records where it came from. A record produced against the procedure states
the figure, the source, and the reading that was measured against it. Nothing is republished as
though it were ours.

If Segway would prefer these not be redistributed, say so and we will hold them in the
catalogue as a private reference, cited by name and version rather than reproduced.

## If the answer is no, or there is no answer

The honest fallback is the one the system already produces: the Xyber brake procedure ships
**incomplete, with the missing figure named**, and any record run against it says plainly that
the caliper bolts were tightened by feel and by whom. That is a worse procedure and a better
record than a plausible number nobody can trace, and it remains what we will do rather than
invent one.
