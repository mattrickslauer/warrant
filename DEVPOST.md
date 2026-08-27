# Warrant — Devpost submission text

Everything here is true of the deployed build. Paste each block into the matching field.
Character-limited fields are marked with their length — do not edit them without recounting.

---

## Project title

**Warrant — maintenance records that are evidence, not paperwork**

Alternates, by what they lean on:

| Title | Leans on |
|---|---|
| Warrant — agents that make maintenance prove itself | the "All Things Agentic" theme |
| Warrant — the evidence layer under your work-order system | the enterprise framing |
| Warrant — the end of pencil whipping | the trade's own word; highest punch, lowest clarity to an outsider |

## Elevator pitch — 174 characters

A maintenance record is an unverified claim by the person being measured. Warrant makes it evidence — proof taken at the machine, as a gate, under the system you already run.

---

## Inspiration

Somewhere right now a technician is ticking a box that says the brake pads were replaced. Maybe they were. Probably they were. The record says so either way, because the record is a tick in a box — a claim by the person being measured, stored in a system built to accept it.

The trade has a word for it: pencil whipping. Filling in the paperwork without doing the work. It is common enough that aviation regulators treat it as falsification and revoke licences over it.

I spent 77 minutes interviewing a technician with thirty years across Air Force aircraft, locomotives, and industrial electrical work. Two things he said shaped this entire project. First, that in critical work you use the checklist — twenty years of experience buys you no exemption, you reference it, you do not go from memory. Second, that the systems companies buy are built for the planner, not for the person holding the wrench. So the record gets written afterwards, from memory or off a clipboard, hours after the machine was closed up.

Then there is the other half. Every time a courier drops a parcel, a stranger performs an unsupervised task and proves it in about four seconds. Arrived — the phone confirms it. Right address — confirmed. Left at the door — photograph, timestamped, attached. It costs pennies and it works, because the worker never has to decide what evidence to capture. The app asks, one step at a time.

Aviation set the standard for what a maintenance record should be. Parcel delivery worked out how to make proof cheap. Nobody had put the two together.

## What it does

Warrant turns a maintenance record from a claim into evidence.

You describe a job in plain language. An agent interviews you about it — what counts as done, what disqualifies it, what has to be measured, what the technician is allowed to decide alone — and turns your answers into a versioned procedure a machine can check.

The technician then works through it one step at a time on a phone. At each step they are asked for the specific proof that step needs: a photograph of the caliper with the wheel off, a torque reading, a measurement. The proof is a gate. The step does not go green until the evidence actually supports it.

Behind each capture, a small team of agents does different jobs. One reads the photograph against the written rule and either passes it, asks for something more specific, or escalates to a person. A second, which never sees the first one's answer, asks a different question entirely: does this evidence even belong to this job, this machine, this moment? Twelve identical bikes in a row look the same; a scuff on one fork tells them apart.

Numbers can come from the tools themselves. We built a small instrument that signs its own readings, so a measurement on the record is one that was measured rather than typed.

At the end you get a sealed record: what was done, by whom, against which version of which procedure, with the evidence attached and the decisions written down. Readable months later by someone who was not there.

It is not a replacement for the system a company already runs. It is the layer underneath it, so what reaches that system is evidence rather than assertion.

## How we built it

Seven agents, each with one job and one contract it has to answer under. They run on Google's Agent Engine, so they are deployed rather than sitting on a laptop — ask the running service for its roster and it lists all seven and what each one answers.

The judgements run on Gemini 3.5 Flash, always at temperature zero and always constrained to a fixed answer shape, so a verdict is a structured decision rather than a paragraph of prose.

Before any of that, every photograph gets looked at twice. First cheaply, by a smaller model, which answers exactly one question: is this frame so unusable that spending the real judge on it would be waste? That cheap model deliberately has no way to say "pass". The strongest thing it can do is send the picture on or ask for a retake. It cannot approve a step and it cannot release a machine. Putting the cheap model only where being wrong costs somebody twenty seconds is the whole reason it is safe to use one.

Photographs also go through a filter that looks for prompt injection first, because a photograph is untrusted input and a sticker with words on it is an instruction.

The web app and the phone app talk to the same service. Everything is stored per customer, and that separation is enforced by the database itself rather than by our code remembering to ask nicely — we prove it by running the rules in an emulator on every test run, rather than by asserting that they work.

The whole product runs offline against recorded fixtures. No cloud account, no credentials, no hardware. The agents have 72 scored scenarios that replay from recordings, so the suite runs free and offline and gives the same answer twice. Some of the adversarial test footage — the kind of fake evidence somebody would submit if they were trying to cheat — is generated with Veo.

## Challenges we ran into

The hardest problem was not technical. It was that the obvious version of this product is one that maintenance technicians would hate.

Look at what we are actually proposing: point a camera at a skilled tradesman and ask him to prove he did his job. Every technician we spoke to has already lived through a system installed by people who have never held a wrench — built for the planner and the auditor, experienced as a stopwatch. They do not log into those systems. Hands-on-the-machine time is already only about a quarter to a third of a shift, and anything that eats more of it gets worked around. Build the bird-watching version, where you photograph everything all day and somebody upstairs reviews it, and you do not get better records. You get exactly the same pencil whipping, with photographs attached.

So the rule we kept coming back to: the evidence has to be **for** the technician, not **about** him. The first person this protects is the one who did the job properly and cannot prove it when a dispute lands eight months later. That changed real decisions. We ask for the fewest captures we can get away with, and only where a step can genuinely go wrong. We never say "attach a photo" — the app asks for one specific thing, so nobody has to guess what will satisfy somebody else months from now. Steps that do not apply never appear at all. And when a step honestly cannot be done — the part is wrong, the bolt is rounded, the machine is still hot — that is a proper answer the system accepts and records, not a failure the technician has to explain away.

The second rule: it has to give something back on the same visit. A tool that only takes is a tool people route around. So it answers questions while your hands are busy, and it puts the right page of the procedure in front of you instead of making you go find it. If a technician would not choose to open it, nothing else we built matters — an unused tool produces no evidence at all.

We got this wrong before we got it right. The first version asked for more proof than it needed, because more evidence always looks safer when you are the one designing it and not the one standing at the machine at two in the morning. Cutting that back was the single most important design decision in the project.

## Accomplishments that we're proud of

The fleet is deployed and will answer for itself. Ask the live service what agents it has and it tells you, with the contract each one answers under. Nothing on our architecture diagram has to be taken on trust.

Two agents look at the same photograph and neither can see the other's conclusion — the second one's prompt does not even mention that the first exists. That is deliberate. Two people shown each other's answers agree, and the second opinion stops being one.

No agent can release a machine. The gate that decides whether a step passes is ordinary code, and a waiver requires a named person with the standing to give it. A model can recommend. It cannot sign.

And anyone can clone the repository and run the entire product, end to end, with no account and nothing at risk.

## What we learned

Put the cheap model where being wrong is survivable. Everyone wants to save money on inference. The saving is only safe if you first ask what happens when the cheap thing is wrong. Ours can waste twenty seconds of a technician's time. It cannot pass a step. That asymmetry, not the prompt, is what makes it safe — and it is enforced by the shape of the answer it is allowed to give, not by asking it nicely.

Do not let a model do arithmetic. Whether a torque reading falls between two numbers is a job for four lines of code. The model is only there for the part that genuinely needs eyes.

The unglamorous work is where the real risk lives. A security rule that was never switched on, a service running as an administrator, a missing entry in a list of four. None of it is clever. All of it mattered more than any prompt we wrote.

Ask someone who has done the job. Almost nobody building software for maintenance has ever done maintenance. An afternoon of listening changed what we built, who we think it is for, and how we talk about it.

## What's next for Warrant

The interview changed what this is.

John spent thirty years in maintenance and has long since run out of patience with software built for the planner rather than the person holding the wrench. When we walked him through Warrant he did not react the way people react to a demo. He started telling us where it would have saved him — and he kept coming back to the railroad.

Three shops, three sets of tools, three ways of doing the same job. A technician arrives at a locomotive holding procedure text written by somebody in another state who had different equipment on hand, and the gap between what the paperwork says and what is actually in front of him gets closed by memory and improvisation. Nothing about that is written down, so the next person inherits none of it. He thinks a procedure that is compiled once, proved wherever the work actually happened, and readable by the next shift is worth real money there — and he is far better placed to know that than we are.

So the next step is not a feature. It is a first customer.

We intend to build this out together: his thirty years and the trust the trade extends to someone who has done the job, our software. He knows the people who run these shops, and getting into that room is the part you cannot buy or engineer your way around. The plan is deliberately small — find one operation where a stopped machine costs money by the minute, run real jobs through Warrant for a month, and find out what breaks when actual technicians use it instead of when we demo it.

The roadmap follows from that rather than the other way around. Parts is the thing every technician raises unprompted: ordering them, waiting on them, and tracking the exact grade of fastener a job calls for. Instruments come next — one signed reading from a bench device proves the idea, but a torque wrench, a multimeter and a tyre gauge that all sign their own readings prove the product. And deeper integration with the systems these companies already run, because nobody is going to switch, and they should not have to.

Where this sells is clear: rail, aircraft, drill sites, plant — anywhere a stopped machine costs money by the minute, and where somebody already knows that number to the dollar. Where it does not sell is just as clear, and knowing that early is worth as much. The corner garage has no downtime clock and no budget for one. We would rather spend the next year in the shops where the problem is expensive enough to be worth solving.

---

# Additional info fields

## Which Google AI Models did you use? — 249 characters

Gemini 3.5 Flash — all seven agents, schema-constrained, temp 0. Gemini 3.5 Flash-Lite — the pre-screen on every capture; no PASS in its enum, so it can never release a machine. Veo 3.1 — adversarial fraud footage. Gemini 2.5 Flash Image — task art.

## Testing instructions — 252 characters

No cloud account or hardware — it runs on recorded fixtures. cd web && npm i && npm run dev → localhost:3000. ./scripts/smoke.sh runs a procedure end to end and proves tenant isolation in the emulator. Agents, offline: cd agents && python3 -m evals run

## The rest

| Field | Answer |
|---|---|
| Submitter type | Individuals |
| Country | United States |
| Category | Fortified Enterprise Fleet |
| Organization | n/a |
| Date started | 08-17-26 (first commit 2026-08-17) |
| Code repo | https://github.com/mattrickslauer/warrant — public, no need to share with testing@devpost.com |
| Reproducible testing instructions in README? | Yes |
| Hosted project URL | https://warrant-zq2l2kwg3q-uc.a.run.app |
| Which Google SDK | Google GenAI SDK (google-genai) only. **Not ADK** — it appears solely in research notes, never as a dependency |
| Google Cloud services | Cloud Run, Firestore. **Not Pub/Sub** — enabled but zero topics and nothing calls it |
| Architecture diagram | `docs/architecture/Warrant-architecture.pdf` (12 pages) |
| Sponsor / special prizes | Leave unchecked — Startup Excellence needs an incorporated organization |
| Startup prize fields | Blank |

Cold start on the hosted URL is about 6 seconds; load every page once before judging opens.

---

# Social

## X post

Include the hashtag or the bonus does not count. The post must be public.

> Most people building software for maintenance have never done maintenance.
>
> So I interviewed someone who has. 30 years: Air Force avionics, then locomotives, then county electrical.
>
> On checklists, downtime, and why "pencil whipping" is the trade's own word for it.
>
> #AllThingsAgentic Hackathon
> [youtube link]

## Content link (bonus points)

The interview, once uploaded: it must be **public, not unlisted**, and the description must say it was created for this hackathon. That line is already in `demo-video/bank/03-john/out/youtube-upload.md`.

---

# Sales

## Elevator pitch, spoken version

You already have a work-order system. The problem isn't that you lack one — it's that your technicians aren't really in it. The record gets written afterward, from memory or off a clipboard, and some of it gets pencil-whipped. Then you decide whether a machine is safe to run based on an unverified claim by the person being measured.

Warrant is the evidence layer underneath what you already run. The technician is asked for proof one step at a time, at the machine, while their hands are on it — and the proof is a gate, not a form field at the end. Aviation has done this for decades. It's affordable there because the airframe is worth tens of millions. We do it at the price of a delivery app.

## How to run it

- **Ask for their number, don't lead with yours.** "What does an hour of unplanned downtime cost you?" makes them build the business case out loud. Keep $1.7M/hour (Fluke/Censuswide, Oct 2025, manufacturing) as an anchor if they don't know, and attribute it.
- **Say "not another CMMS" early and unprompted.** Every buyer has survived a failed implementation and will pattern-match you to it within thirty seconds.
- **"Pencil whipping" is the pitch in two words.** It is the industry's own term and it tells them you have been in the shop.
- **Walk away from the corner garage.** No downtime clock, no urgency, no budget.

## Vertical variants

**Rail** — Kansas City does it one way, Roseville another, and the tech data was written by whoever was on shift. When a locomotive moves between shops the record has to mean the same thing in both. Warrant compiles the procedure once and proves it was followed wherever the work happened.

**Aviation / MRO** — You already live under signed-off task cards and parts certificates. You also know the form is downloadable and has been forged. We attach evidence to the task at the moment it is performed, so the signature has something underneath it.

**Oil & gas / drilling** — At your day rate, an hour of unplanned downtime is the whole conversation. The PM either happened or it did not, and right now the only thing between you and that answer is a tick in a box.
