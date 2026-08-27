# The judging Q&A — what the panel said, and what it changed here

**Source.** *How to Win the All Things Agentic Hackathon: Judging Criteria Live Q&A — Devpost
Build Session*, streamed 26 Aug 2026: <https://www.youtube.com/watch?v=DCXjvKmUIGY>.
Google Cloud on the call: **Willie** (product marketing) and **Christina** (DevRel engineering
manager), who answers every scoring question and says plainly that she is one of the judges —
so the sentences below are a judge's, not a moderator's.

This file is the decision record. Where a claim in `README.md`, `DEVPOST.md`, `SCRIPT.md` or
`docs/architecture.md` changed because of something said on that call, the sentence that caused
it is quoted here with what we did about it. The rest of the transcript is a full copy of
someone else's recording and is deliberately **not** in this public repository — it is archived
at `~/warrant-research/judging-qa-2026-08-26/` with its provenance note.

Quotations are from YouTube's auto-caption track and are lightly repunctuated. The captions
mangle product names throughout, so nothing here is quoted as a spelling.

---

## The one that cost us the most to ignore

Answering a project that had built its own agent registry with a deterministic kernel — very
close to this system's shape:

> "We do prefer if you can use the agent registry from the agent platform inside Google Cloud.
> We do prefer you to do that… if we are picking the winner we'll prefer somebody that has
> implemented with the agent registry inside our agent platform."

**What we did.** `docs/architecture.md` still had Agent Registry under *still unverified* — the
API had never been called. It was called. `AgentService` is served from no regional endpoint we
could use and only from `global`, where it lists cleanly and is empty; it stays empty because
`Agent.base_agent` is required, immutable, and accepts only `antigravity-preview-05-2026`. It
registers Antigravity agents, and ours are `google-genai` agents on Agent Engine. The decision
did not change. The reason went from taste to a status code. See the Architecture section of
`README.md`.

## The warning worth taking personally

To a project describing an external deterministic authorisation plane, with the agent runtime
explicitly non-sovereign:

> "That would be a very core use case for us, but since this is a Google Cloud and Google Cloud
> funding hackathon… it's going to get to a point where it's really good, but I'm not sure
> you'll be winning the grand project. You're at this risk."

**What we did.** That is this product's thesis almost word for word — a model may recommend and
may not sign. We did not change the architecture, which is the best thing about the project. We
changed what the README leads with: the deployed Agent Engine and its real roster output first,
the four non-adoptions after the evidence rather than in front of it.

## They run the repository

> "We'll have a tool that runs it for you… look into how well it work and will it work."

and judging escalates rather than resting on one reader:

> "Your project won't be judged by just one single person."

**What we did.** `python3 -m evals run` — the command our own testing instructions hand a judge —
answered 46/70 with 19 errors and `scoper 0/14`. It now answers 61/69 with none.

## The README they want

> "A short description of your entire project and a description of how the folder was structured
> so we can quickly find things."

plus insights found while building, and things worth being proud of that the video had no room
for.

**What we did.** Added the *Where things are* section to `README.md`.

## The diagram they want

> "Out of that one glance I know where are you deploying into, how are the components connected
> together."

> "I've seen somebody that does architecture diagrams that has a lot of writing in it — it's
> basically an essay. Try not to do that."

AI-generated is acceptable **only if it is true**: *"It is okay if it's AI generated as long as
it reflects your actual architecture."*

**What we did.** The submission field pointed at the 12-page PDF. It now points at the
single-page canvas, which is read from the live project; the PDF stays as the long form.

## The video

- Four minutes is enforced, not advisory: *"We will only watch four minutes of it… everything
  that you put after four minutes, we will not watch."*
- *"Wowing them in the first like maybe 30 seconds will be very important."*
- Google Cloud has to be on screen. Asked whether a live UI plus the Cloud Run dashboard counts
  as proof of GCP execution, the answer was a flat *"Yes."*
- Unprompted, from the judge who scores presentation: *"Don't use AI voices. It feels less
  genuine to me."*
- Show the hard path: *"A happy path is great but probably not going to get you a lot of
  points — choose the one that's going to wow the judges."*
- Multimodal is explicitly encouraged: *"We encourage you to look at multimodal as well… we're
  thinking about live streamings, pictures, sounds — don't limit yourself on just the text."*
- A long-running agent does not have to be filmed running. Show the end state and scroll the
  logs; *"we will know by going through your code."*

**What we did.** These are quoted at the top of `SCRIPT.md`, where the edit happens.

## Track, and the shape of the field

Christina, unprompted, on submission mix:

> "We're not getting a lot of the questions from the taskmaster, surprisingly."

Fortified Enterprise Fleet took most of the questions on the call. Projects described in it
included governed multi-agent recovery with a deterministic gate and human approval, an
enterprise incident-response swarm, an autonomous SRE with a reviewer gate, and a governed
supplier-release fleet with replayable evidence — several of them using the platform components
this project declined. One of the closest analogues to Warrant's description was told *"it
sounds more like a taskmaster to me."*

**What we did.** Nothing yet, deliberately. Fortified Enterprise Fleet stays the category: its
*Unlikely Hero* sub-criterion is explicitly scored and the technician who cannot prove their own
work is exactly that, and Taskmaster gives no credit for the security and audit half of the
build. But the category prize is a harder field than `STRATEGY.md` assumed, and the grand prize
is scored across all categories anyway.

## Smaller answers that settled questions

| Asked | Answered |
|---|---|
| Mock or synthetic data where real data cannot be exposed? | Yes, explicitly fine — including for enterprise cases |
| A pre-existing model artifact trained before the window? | Fine if disclosed in the README |
| Does "sends the right info to the right places" require an external channel? | No — a web console is a delivery target if that is where the user is |
| Tooling — AI Studio, Antigravity, something else? | *"We don't care about the tools"* — what is scored is the Gemini model and the Google Cloud services |
| Bonus for reaching outside the system | *"If you can extend it to external action then that will give you extra bonus mark"* |

## Their closing advice

> "Just get it in there first. Submit first, and wherever you are we'll judge on based on what
> you have so far."
