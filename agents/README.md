# The agents, and how we know they work

Seven agents, and one line drawn deliberately: a model is used where judgement is genuinely
required and nowhere else. The seal, the gate and the ledger are deterministic and are not
in this directory.

Six of them judge something and return a verdict a person can argue with. Wright is the
exception, and it is held to a stricter standard for a reason: a wrong verdict sits on the
record where somebody can dispute it, while a wrong driver mints wrong measurements
unattended — each one filed as `measured`, the strongest provenance class the product has.

| Agent | Decides | Why it cannot be code |
|---|---|---|
| **Scoper** | Interviews a shop until a procedure would run unambiguously, then compiles it | Open-ended natural language; it has to know what it has *not* yet asked |
| **Inspector** | PASS / ADD FIELD / ESCALATE on one field's evidence | Reading media, and composing the specific next request |
| **Skeptic** | Does this evidence belong to this job, this machine, this moment | Perceptual identity — same asset, does the wear match the history |
| **Instructor** | Turns "I can't do this one" into a structured blocker and a next action | Unbounded speech against the procedure in context |
| **Foreman** | Owns the job for its whole life and disposes of a step nobody could do | Long-horizon state and delegation under ambiguity |
| **Auditor** | Reads weeks of finished jobs and finds the defects in the procedure itself | Telling a broken form apart from a working one — a step that keeps failing is usually the rule catching real faults |
| **Wright** | Meets an unfamiliar instrument and works out how it speaks | Inferring an encoding from a GATT tree, and knowing when the honest answer is to refuse |

## The contract is the prompt

`contract/agents/*.schema.json` is not documentation that happens to match the code. The
same file is posted to Vertex as `responseSchema`, assembled into the system instruction,
and used to validate the answer. There is one statement of what an agent must return, and a
prompt cannot drift away from the rule that validates it because they are the same sentence.

What a schema *cannot* say is "`add_field_prompt` is required when and only when the verdict
is `ADD_FIELD`". That gap is where a plausible but useless answer lives, so each agent closes
it in `check_conditionals`, and every one of those rules is tested.

## Testing

The corpus is **62 scenarios across the seven agents**, each a genuinely different situation —
a different photograph, a different transcript, a different job history — because running
one case repeatedly measures sampling noise, not the agent.

```bash
pip install -r requirements.txt

python3 -m evals check              # every scenario loads and builds a prompt; calls nothing
python3 -m evals list --agent skeptic -v
python3 -m evals run                # replays recorded answers; offline and free
python3 -m evals run --live         # calls Vertex and records what came back
python3 -m evals run --live --agent scoper   # re-record just the agent you edited
python3 -m evals run --model gemini-2.5-pro  # the same corpus against a different model
python3 -m evals run --agent inspector --id torque -v
python3 -m evals diff runs/<a> runs/<b>
python3 -m pytest tests/ -q         # the harness's own tests
```

Recording is piecemeal and replay is whole. Edit one agent, re-record only that agent live,
then run `python3 -m evals run` with no flags: it replays everything from cassettes, costs
nothing, and writes the one complete artifact that `runs/latest` points at. That artifact is
what `web/scripts/sync-evals.mjs` freezes into `/model-tests`, so the page always shows the
whole corpus rather than whichever slice was recorded last.

### Two shapes of scenario

Most scenarios ask one question and check one answer, which is the right shape for an
Inspector: it really does see one field's evidence and decide. It is the wrong shape for the
Scoper, whose whole job is a sequence — knowing what it has not yet asked, and stopping only
when nothing material is unstated. A single-turn case can show the Scoper asks *a* sensible
question. It cannot show that twelve of them converge on a procedure.

So a scenario may set `"kind": "interview"`. The shop is then not a transcript but a sheet of
facts, played by a second model that talks freely about its own work and holds no figure that
is not on the sheet. The Scoper drives the conversation until it compiles or runs out of
turns, and what is judged is the procedure it produced.

Every interview withholds a figure the procedure needs. That is not an oversight in the
fixture — the Scoper's load-bearing refusal is declining to invent a tolerance, and you
cannot observe a refusal without giving it something to refuse.

The check that matters is `traceable`. Every bound in the compiled procedure is compared
against the numbers the shop actually said out loud, so "it did not make one up" is
arithmetic rather than an impression formed by reading the transcript:

```json
{
  "kind": "interview",
  "input": {
    "shop": { "trade": "motorcycle rental and workshop", "stakes": "..." },
    "facts": { "pad wear limit": "we bin the pads at 2 mm of friction material" },
    "max_turns": 12
  },
  "expect": {
    "is_true": ["compiled", "traceable"],
    "absent": ["invented_bounds"]
  }
}
```

`evals/shop.py` is the simulated shop, and it lives in `evals/` rather than `warrant/` because
it is not one of the seven agents and ships with nothing.

The first interviews are also what made the Scoper's real defect visible. Its contract asks it
to know what it has not yet asked, and nothing ever told it — so it did what anyone would and
followed the thread in front of it, spending ten of twelve turns on how you tell fork oil from
road grime while the pad wear limit, the figure the record is actually decided by, went unasked.
The fix is in `warrant/scoper.py`, not in the prompt: the classes of unknown it has used are
counted back to it each turn, along with how many turns are left. That block goes in the user
turn rather than the standing instruction because it is a fact about this conversation, not a
rule about the job.

### A scenario

```json
{
  "why": "61 Nm against a 27-33 bound. A clear, well lit, entirely legitimate photograph of
          the WRONG NUMBER — the case where good evidence must still fail.",
  "input": { "step": {...}, "field": {...}, "media": ["torque/display-61nm.png"] },
  "expect": {
    "not_in": { "verdict": ["PASS"] },
    "mentions_any": { "rationale": ["61", "over", "above", "exceed", "spec", "33"] }
  }
}
```

Assertions pin the part that **decides** something, never the whole answer. Exact-matching a
rationale would fail the first time it was reworded and the suite would be abandoned inside a
day. `mentions_any` on the reasoning is there for a narrower purpose: to catch an agent that
reached the right verdict for no reason, which is a bug that only surfaces later, on a case
that looks slightly different.

`why` is required on every scenario, and the report prints it next to every failure. A test
whose purpose nobody can reconstruct gets deleted the first time it fails inconveniently.

### Three statuses, not two

- **fail** — the answer parsed and conformed, and an assertion about its content did not hold.
- **off-contract** — it did not obey its own schema, or broke a conditional rule. Terminal:
  assertions about a field the model never returned would bury the one failure that matters.
- **error** — the agent was never properly asked. Missing media, no recording, an unparseable
  reply. **Never scored as a pass or a fail**, because an Inspector asked to judge a photograph
  it was never shown will confidently return something, and that answer would otherwise be
  marked against a scenario it never saw.

### Cassettes

Every call is keyed by the model, the instruction, the schema and the bytes of every
attachment, and recorded under `evals/cassettes/`. Re-running an unchanged suite costs
nothing and needs no network. Editing one agent's wording changes only that agent's keys, so
the scenarios it affects are exactly the ones that need `--live` again and the other forty
stay free. A prompt edit therefore *cannot* silently reuse a stale answer — the recording is
simply not found.

Never hand-write a cassette into that directory. A fabricated recording is indistinguishable
from a real one, and this suite is the thing that is supposed to tell you what the model
actually said. Point `WARRANT_CASSETTES` somewhere else for experiments.

### The evidence corpus

The Inspector and the Skeptic are tested against **18 real photographs**, listed with what
each one has to show in [`evals/media/SHOTS.md`](evals/media/SHOTS.md). `python3 -m evals media`
prints what is still outstanding and which scenario is waiting on it.

They are photographs rather than renders on purpose. Generated imagery is uniformly lit and
uniformly sharp — wrong in none of the ways a workshop phone is wrong — and half this corpus
is *defined* by a defect: glare across a label, focus missed by a hand still moving. Those are
properties of a camera in a workshop, not of a prompt.

More pointedly: **a generated instrument display is a fabricated reading**, in a product whose
entire claim is that a record is evidence. Every number in this corpus was pulled on a real
wrench.

One image is deliberately fake. `torque/photo-of-a-screen.jpg` is a photograph of a monitor
displaying a torque reading — the cheapest fraud available, staged so the Inspector can be
tested on refusing it. It is labelled as staged everywhere it appears.

## Running the agents

Nothing but the standard library, over the REST endpoint, with the same `gcloud` credential
the rest of the repo uses:

```bash
pip install -r agents/requirements.txt      # the GenAI SDK
gcloud auth login
export GCP_PROJECT=...
python3 -m evals run --live --agent foreman
```

Live calls go through the **Google GenAI SDK** against Vertex AI. Replaying the recorded
cassettes needs none of it: the SDK is imported lazily, inside the live branch only, so
`python3 -m evals run` works on the standard library alone.

The Gemini 3 family is served from the `global` endpoint, not a regional one. `model.py`
defaults to it; `GEMINI_LOCATION` overrides it for a model that is genuinely regional.

## Deploying the fleet to Agent Runtime

```bash
gcloud auth application-default login       # once, per machine
./infra/deploy-agents.py                    # create, or update the engine in place
./infra/deploy-agents.py --list             # what is deployed
./infra/deploy-agents.py --smoke            # ask the deployed engine what it is
```

`warrant/runtime.py` is the whole surface: one `query(case=…, agent=…)` and one `roster()`.
It keeps no job state between calls, and that is the design rather than an omission. Agent
Runtime caps a single execution at seven days; a Warrant job is a service interval or a
purchase-order lead time, which is longer. So the runtime hosts a **session** and the record
holds the **job** — the Foreman wakes, is shown a case, decides, and the decision is written
down by the caller. Anything this process remembered would be state that vanishes when the
runtime recycles.

Two things the local harness gets for free have to be arranged for the remote, both by
`infra/deploy-agents.py`:

- **The contract.** The fleet ships as the `warrant` package alone — there is no repo out
  there — so a verbatim copy of `contract/agents` and `contract/entities` is staged into the
  package as `_contract_data/`. It is copied at deploy time, never authored, so there is
  still exactly one statement of the contract. `contract.py` prefers the repo copy and falls
  back to the packaged one; `WARRANT_CONTRACT_DIR` overrides both.
- **The credential.** Deploying is an operator action, so the script deliberately ignores
  `GOOGLE_APPLICATION_CREDENTIALS` from `.env` — that points at the least-privilege
  `warrant-web` runtime identity, and authenticating the deploy as the running product
  produces a 403 that reads exactly like the API being unavailable.

The deployed fleet always calls live. A cassette answering on a deployed engine would mean
the thing under judgement was replaying a recording, which is the one thing it must not do.
