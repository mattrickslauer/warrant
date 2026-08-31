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
| Warrant — the agent that writes the maintenance record for you | the Taskmaster track: the chore nobody wants |
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

Nobody has ever wanted to write the maintenance record. It is the part of the job that happens after the machine is closed up, from memory or off a clipboard, when the work is done and the technician wants to go home. It is also the part somebody's life depends on being true.

So Warrant writes it. Not afterwards from a summary — during, at the machine, one step at a time, and it will not write down anything it has not been shown.

Warrant turns a maintenance record from a claim into evidence.

You describe a job in plain language. An agent interviews you about it — what counts as done, what disqualifies it, what has to be measured, what the technician is allowed to decide alone — and turns your answers into a versioned procedure a machine can check.

The technician then works through it one step at a time on a phone. At each step they are asked for the specific proof that step needs: a photograph of the caliper with the wheel off, a torque reading, a measurement. The proof is a gate. The step does not go green until the evidence actually supports it.

Behind each capture, a small team of agents does different jobs. One reads the photograph against the written rule and either passes it, asks for something more specific, or escalates to a person. A second, which never sees the first one's answer, asks a different question entirely: does this evidence even belong to this job, this machine, this moment? Twelve identical bikes in a row look the same; a scuff on one fork tells them apart.

Numbers can come from the tools themselves. We built a small instrument that signs its own readings, so a measurement on the record is one that was measured rather than typed.

At the end you get a sealed record: what was done, by whom, against which version of which procedure, with the evidence attached and the decisions written down. Readable months later by someone who was not there.

It is not a replacement for the system a company already runs. It is the layer underneath it, so what reaches that system is evidence rather than assertion.

And the answers come out where the shop already works, not only inside our app. Nobody adopts a system by logging into it. A dated task becomes a calendar event. A sealed record lands in the company's own Google Drive as a document, next to a ledger that gains a row every time a job seals — sealed at, procedure, version, machine, technician, evidence tier, whether the machine was released, how many deficiencies, and the links. That ledger is theirs. A maintenance record is worth something years later, often to somebody who never had a login here, and a record that only exists inside a vendor's database has a dependency on that vendor still being in business.

And when the Foreman decides a part has to be reordered, the purchase order is drafted in Gmail — part number, grade, quantity, the machine it is for, and the Foreman's own reasoning — addressed to the supplier and not sent. Somebody with the standing to spend the money opens it, reads it, and presses send.

### What runs long

Very little of this happens inside one sitting, which is the whole reason it needs agents rather than a form.

A job opens when the machine arrives and seals when the evidence is complete, and those are often different days — a step can be answered honestly with *the part is wrong* or *the bolt is rounded*, and then the job waits on a part with a lead time nobody controls. The Foreman owns the job across that whole span and raises the order without being asked.

The Auditor works on a longer clock still. It reads sealed jobs against the procedure they were performed under, and it will not offer an opinion until at least three jobs have run on the same version — so its unit of work is weeks of shop history, not one capture. When it finds that a bound is wrong, what it produces is a revision handed back to a person.

None of it needs anyone watching: a scheduler wakes the deployed service every minute and nothing about that is manual.

It has not been clean the whole time, and the log is the honest version. On 26 Aug the sweep answered 500 on 344 of its firings against 42 that succeeded — a scheduler that looks like it is working, firing into an endpoint that was not. It has answered 200 on every firing since, 611 of them on the 27th with no failures. The architecture canvas carried that endpoint as **drift** in red for as long as it was true, and carries it as live now that it is. That is the same rule the product applies to a technician: the record says what happened, including the part nobody would have volunteered.

## How we built it

Seven agents, each with one job and one contract it has to answer under. They run on Google's Agent Engine, so they are deployed rather than sitting on a laptop — ask the running service for its roster and it lists all seven and what each one answers.

The judgements run on Gemini 3.5 Flash, always at temperature zero and always constrained to a fixed answer shape, so a verdict is a structured decision rather than a paragraph of prose.

Before any of that, every photograph gets looked at twice. First cheaply, by a smaller model, which answers exactly one question: is this frame so unusable that spending the real judge on it would be waste? That cheap model deliberately has no way to say "pass". The strongest thing it can do is send the picture on or ask for a retake. It cannot approve a step and it cannot release a machine. Putting the cheap model only where being wrong costs somebody twenty seconds is the whole reason it is safe to use one.

Photographs also go through a filter that looks for prompt injection first, because a photograph is untrusted input and a sticker with words on it is an instruction.

The web app and the phone app talk to the same service. Everything is stored per customer, and that separation is enforced by the database itself rather than by our code remembering to ask nicely — we prove it by running the rules in an emulator on every test run, rather than by asserting that they work.

The whole product runs offline against recorded fixtures. No cloud account, no credentials, no hardware. The agents have 69 scored scenarios that replay from recordings, so the suite runs free and offline and gives the same answer twice. Some of the adversarial test footage — the kind of fake evidence somebody would submit if they were trying to cheat — is generated with Veo.

The Workspace side is one consent covering Calendar, Gmail and Drive, and every scope in it is a **write** scope for something Warrant creates: `calendar.events`, `gmail.compose`, `drive.file`. Warrant cannot read a calendar, cannot read a mailbox, and cannot see a file it did not make — `drive.file` is per-file access to the app's own files, so the folder and the ledger are reachable and the rest of somebody's Drive is not. That is also why the ledger costs no extra permission: the Sheets API accepts the same scope for a spreadsheet the app created.

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

No agent can spend money either, and that one is enforced by the credential rather than by the prompt. The purchase order the Foreman raises is written with `gmail.compose`, a scope that can create a draft and cannot send one. An agent that decided to order forty thousand pounds of steel could not transmit it if it wanted to. "Drafted, never sent" is not an instruction we gave a model and hope it follows — it is a property of the token, and the authority to spend stays with the human because the API key does not carry it.

And anyone can clone the repository and run the entire product, end to end, with no account and nothing at risk.

## What we learned

Put the cheap model where being wrong is survivable. Everyone wants to save money on inference. The saving is only safe if you first ask what happens when the cheap thing is wrong. Ours can waste twenty seconds of a technician's time. It cannot pass a step. That asymmetry, not the prompt, is what makes it safe — and it is enforced by the shape of the answer it is allowed to give, not by asking it nicely.

Do not let a model do arithmetic. Whether a torque reading falls between two numbers is a job for four lines of code. The model is only there for the part that genuinely needs eyes.

The unglamorous work is where the real risk lives. A security rule that was never switched on, a service running as an administrator, a missing entry in a list of four. None of it is clever. All of it mattered more than any prompt we wrote.

Call the API before you write down why you didn't use it. We had a paragraph explaining why Agent Registry was not the right home for our agents. It was a good paragraph and it was not evidence, so we called the thing. `AgentService` turns out not to be served from any regional endpoint we could use, only from `global` — where it works, lists cleanly, and accepts exactly one value for `base_agent`: `antigravity-preview-05-2026`. It registers Antigravity agents. Ours are Python agents on Agent Engine, so registering them would publish a roster that was not the fleet actually serving traffic. The decision did not change. The reason went from taste to a status code, which is the only kind of reason this project is allowed to give.

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
| Category | **The Taskmaster** — see the note below |
| Organization | n/a |
| Date started | 08-17-26 (first commit 2026-08-17) |
| Code repo | https://github.com/mattrickslauer/warrant — public, no need to share with testing@devpost.com |
| Reproducible testing instructions in README? | Yes |
| Hosted project URL | https://warrant-zq2l2kwg3q-uc.a.run.app |
| Which Google SDK | Google GenAI SDK (google-genai) only. **Not ADK** — it appears solely in research notes, never as a dependency |
| Google Cloud services | Cloud Run, Firestore, Cloud Scheduler, Cloud Storage, Secret Manager, IAM Credentials. **Not Pub/Sub** — enabled but zero topics and nothing calls it |
| Google Workspace APIs | Calendar (`calendar.events`), Gmail (`gmail.compose`), Drive (`drive.file`) and Sheets — one incremental consent, every scope write-only for resources Warrant itself creates. It cannot read a calendar, a mailbox, or a file it did not make |
| Gallery thumbnail | `demo-video/deck/out/thumb-project.png` — 1200 × 800, the 3:2 Devpost asks for; re-render from `demo-video/deck/thumb.html?t=project` |
| Architecture diagram | **Submit `docs/architecture/Warrant-architecture-canvas.png`** — one page, 50 nodes and 62 links read live from `warrent-505918`, with a state legend (live / on the bench / provisioned / drift / dormant). The judging Q&A was explicit that the diagram must be readable at a glance: *"out of that one glance I know where are you deploying into, how are the components connected together… I've seen somebody whose architecture diagram is basically an essay. Try not to do that."* The 12-page `Warrant-architecture.pdf` is the essay — keep it in the repo as the long form, link it from the README, but do **not** make it the diagram field |
| Sponsor / special prizes | Leave unchecked — Startup Excellence needs an incorporated organization |
| Startup prize fields | Blank |

### Why The Taskmaster and not Fortified Enterprise Fleet

This was Fortified Enterprise Fleet until 27 Aug, and the security and tenancy work that
suited it is all still here and still true. Three things moved it.

**The panel said the quiet part out loud.** Asked about a project that had built its own
agent registry rather than adopting the platform's, the answer was: *"if we are picking the
winner we'll prefer somebody that has implemented with the agent registry inside our agent
platform."* Agent Registry, Memory Bank, Gateway and Identity are Fortified Enterprise
Fleet's own recommended stack. We adopt none of the four, on reasons we can evidence — see
the Architecture section of the README — but in that track those reasons are argued against
competitors who simply adopted them.

**That track is where everyone went.** Most of the projects that got airtime on the call
were Fortified Enterprise Fleet. Of Taskmaster, the judge said, unprompted: *"we're not
getting a lot of the questions from the taskmaster, surprisingly."*

**And the work fits.** Taskmaster is for agents that take on what a person does not want to
do, and that keep going over hours, weeks or months. Writing the maintenance record is
exactly the chore nobody wants, and the job outlives the visit — see *What runs long*.

The track brief asks for an agent that *"sends the right info to the right places"*, and that
is now literal rather than a reading. A scheduler wakes the fleet every minute; it seals the
jobs that finished, chases the steps that stalled, puts the next service in a calendar,
projects each sealed record into the shop's own Drive with a row in their ledger, and drafts
the purchase order for a part the Foreman called for — into a foreman's Gmail, with a scope
that cannot send it. Four destinations, no human in the loop until the one place where a
human has to be: the moment money leaves the business.

The downside is bounded. Rules §121: *"The Sponsor and Administrator reserve the right to
reassign a Submission from one category to another if applicable."* If the panel reads this
as an enterprise fleet, they can move it, which is what happened in the Q&A to a project
described in almost these words. Rules §107 permits more than one Submission only where each
is *"unique and substantially different"*, so entering the same build in both tracks is not
available and was not attempted.

Cold start on the hosted URL is about 6 seconds; load every page once before judging opens.

### It has to stay up until 1 October

Rules §101: the Project must be available *"free of charge and without any restriction, for
testing, evaluation and use by the Sponsor, Administrator and Judges **until the Judging Period
ends**"* — and the Judging Period runs 1 September to 1 October 2026. The submission is not the
finish line for the infrastructure.

So, after 31 August: leave billing on `warrent-505918`, leave the Cloud Run service and the
Firestore database alone, keep the `warrant.tools` registration and its DNS current, and leave
`youtu.be/i7RFqMTELgA` public. `warrant.tools` and `www.warrant.tools` are both authorised
sign-in domains — verified against the Identity Toolkit, not assumed — and pulling either one
breaks Google sign-in for a judge who typed the URL the film ends on.

The organisers' 24 August update puts the same point the other way round: *"once the deadline
passes, everything locks — don't touch your repo, video, or linked materials until after winners
are announced."*

---

# Social

## X post

Include the hashtag or the bonus does not count. The post must be public.

**Devpost spells the hashtag two different ways on its own pages** — `rules.md:157` has
`#AllThingsAgentic Hackathon` (with a space, which renders as the tag `#AllThingsAgentic`
followed by a loose word), while `rules.md:221`, `overview.md:106` and the live rules page all
have `#AllThingsAgenticHackathon`. Post both. Two tags cost nothing and either spelling of the
grep then finds us.

> Most people building software for maintenance have never done maintenance.
>
> So I interviewed someone who has. 30 years: Air Force avionics, then locomotives, then county electrical.
>
> On checklists, downtime, and why "pencil whipping" is the trade's own word for it.
>
> #AllThingsAgenticHackathon #AllThingsAgentic
> [youtube link]

## Content link (bonus points)

The interview, once uploaded: it must be **public, not unlisted**, and the description must say it was created for this hackathon. That line is already in `demo-video/bank/03-john/out/youtube-upload.md`.

---

# The demo video's own description

`https://youtu.be/i7RFqMTELgA` is public and 3:51, and **its description is empty.** A judge who
opens it on YouTube rather than inside Devpost is handed no repository, no live URL and no stack.
Editing the description does not touch the file, so the video keeps its URL and nothing has to be
re-uploaded. Paste this in:

> Warrant turns a maintenance record from a claim into evidence. A technician is asked for the
> specific proof each step needs, at the machine, while the work is happening — and the proof is a
> gate, not a form field at the end. The record will not say a machine was released unless the
> evidence says so.
>
> Built for the All Things Agentic Hackathon, category The Taskmaster.
>
> Live: https://warrant.tools
> Code: https://github.com/mattrickslauer/warrant
> Cloud Run: https://warrant-zq2l2kwg3q-uc.a.run.app
>
> Seven agents on Gemini 3.5 Flash via the Google GenAI SDK, deployed to Vertex AI Agent Engine,
> over Cloud Run and Firestore. Gemini 3.5 Flash-Lite screens every capture. Veo 3.1 generates the
> adversarial footage the Skeptic is tested against.
>
> The interview at 0:41 and 2:36 is John Tedesco — thirty years of maintenance across Air Force
> aircraft, locomotives, and county electrical work.
>
> #AllThingsAgenticHackathon #AllThingsAgentic

Not a bonus item — the published-content bonus is the interview, above. This is free ground on the
artifact the judges are most likely to open first.

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
