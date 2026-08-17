# The Bible — All Things Agentic Hackathon

**The archived pages beside this file are the only authority.** Where anything in our own
documents, plans, or conversations disagrees with them, the archive wins. Every claim
below is traceable to a quoted line in `rules.md` or `overview.md`.

| File | What it is |
|---|---|
| [`rules.md`](rules.md) | Official Eligibility and Rules, §§1–13. The binding document |
| [`overview.md`](overview.md) | Public overview: requirements, categories, prizes, criteria |
| [`resources.md`](resources.md) | Resources tab — credits, workshops, guides |
| [`updates.md`](updates.md) | Organiser announcements |
| `raw/*.html` | Byte-for-byte source, in case an extraction dropped something |

Archived **2026-08-17** from `allthingsagentichackathon.devpost.com`. Re-fetch with
`./scripts/fetch_rules.sh` and diff before submission — the sponsor may change the rules.

---

## 1. Hard dates

| Event | When |
|---|---|
| Submission Period | 3 Aug 2026 09:00 PT → **31 Aug 2026 17:00 PT** |
| Google Cloud $150 credit request form | **28 Aug 2026 12:00 PT**, or while supplies last |
| Judging Period | 1 Sep – 1 Oct 2026 |
| Winners announced | on or around **8 Oct 2026** |

> "The Contest begins at 9:00 A.M. Pacific Time (PT) … on August 3, 2026 and ends at 5:00
> P.M. PT on August 31, 2026"

---

## 2. Mandatory stack — Stage One is pass/fail on this

> "**Mandatory for all categories:** 1) Gemini 3.5 or newer accessed through Gemini API or
> Vertex AI, 2) AND at least one Google Agent Framework: Google ADK, GenAI SDK,
> Antigravity SDK or GenKit 3) AND at least one Google Cloud infrastructure service (such
> as Cloud Run, Cloud SQL, Firestore, GKE, Pub/Sub)."

All three are compulsory. The infrastructure list is illustrative ("such as"), but the
named services are Cloud Run, Cloud SQL, Firestore, GKE and Pub/Sub — **AlloyDB is not
named.** If a datastore is our only claimed infrastructure service, we are relying on a
judge's generous reading. Run a named service as well.

> "The first stage will determine via pass/fail whether the Submission meets a baseline
> level of viability, in that the Submission includes all Submission requirements,
> reasonably addresses a Challenge, and reasonably applies the requirements."

---

## 3. The three categories, verbatim

Select **one**. The Sponsor and Administrator "reserve the right to reassign a Submission
from one category to another."

**1. Taskmaster** — "Build a Complete Workflow, Not Just a Chatbot. Don't just make an
agent that writes text. Make one that takes action. Find a messy, multi-step chore in your
job, classes, or personal life. Build an agent that handles the details, sends the right
info to the right places, and proves it can do the heavy lifting for you."

**2. Collaborative Partner** — "Build an agent that leads the way and takes notes. It
should ask clarifying questions, guide the user step-by-step, and have a clear way to
capture feedback, so it constantly adapts to the user's unique way of thinking."

**3. Fortified Enterprise Fleet** — "Build a scalable network of institutional agents that
hook into official enterprise infrastructure. Teams must demonstrate how agents are
cataloged for cross-department use, how they safely maintain context **across weeks of
asynchronous operations**, and how they interact with production data without violating
enterprise compliance, data sovereignty, or security policies."

FEF names its seven components explicitly:

| # | Component | Stated purpose |
|---|---|---|
| 1 | **Agent Registry** | publishing, versioning, discovering enterprise-approved agents |
| 2 | **Agent Runtime** | long-running, asynchronous background execution |
| 3 | **Memory Bank** | persistent, secure cross-session context over extended timelines |
| 4 | **Agent Identity** | zero-trust access control |
| 5 | **Agent Gateway** | unified routing and policy enforcement |
| 6 | **Model Armor** | inline guardrails — prompt injection, tool poisoning, PII leaks |
| 7 | **Agent Observability** | OpenTelemetry-compliant audit logs, end-to-end reasoning traces |

Recommended tech: **Gemini Enterprise Agent Platform**.

> **"Across weeks of asynchronous operations"** is the phrase that cannot be retrofitted in
> the last few days. Whatever we build has to start running early enough to have weeks
> behind it.

---

## 4. Scoring — the actual arithmetic

Three stages. Stage Two scores **1–5 per criterion, averaged across criteria**. Stage Three
adds bonus points.

> "Each Submission will receive a Final score from 1 to 6, with the highest possible Final
> score being 6."

The bonus is therefore worth **a full point out of six — 16.7% of the ceiling.**

### Stage Two — weighted criteria

**Innovation & Operational Utility — 40%**
> "Does the system eliminate real-world friction? Is the 'Twist' present? We are looking
> for high-value, autonomous execution over simple chat queries."

- *Taskmaster:* "Does the agent successfully intercept and complete a multi-step background workflow without human intervention? Did the team successfully utilize the **'Bring Your Own Friction' (BYOF)** mandate to solve a unique, personal problem?"
- *Collaborative Partner:* "Does the agent actively **synthesize or mutate data, rather than just reading it**? Did the team ingest **unusual, messy, or highly complex unstructured data streams**?"
- *Fortified Enterprise Fleet:* "Is the task complex enough to warrant a multi-agents system? Does the system **intelligently delegate tasks to specialized sub-agents**? Did they build this for an **'Unlikely Hero' outside of standard corporate roles**?"

**Architectural Discipline & Tech Stack — 30%**
> "We are evaluating your engineering decisions, not just your ability to call an API. How
> well did your team decouple systems, manage state, and design robust, failure-tolerant
> agentic systems?"

Its sub-bullets are keyed to three labels that **do not match the three categories** — "The
Continuous Action Engine", "The Evolving Knowledge Engine", "The Multi-Agent Nexus". Most
likely leftover text from another hackathon. Since we cannot tell which a judge will apply,
satisfy all three:

- clean, modularised, maintainable; explicit state management; tools "properly isolated and scoped for security"
- "intelligent schema design, efficient vector embedding strategies"; efficient management of massive context windows
- "clear, strictly enforced separation of concerns between agents"; failure-tolerant inter-agent routing — "how does the system recover if a worker agent loops or returns a hallucination?"

**Demo & Production Readiness — 30%**
> "The clarity of the technical documentation and the undeniable proof of execution in the
> video pitch."

- "**The Proof of Action:** Does the video show an **unedited, live execution** of the agent performing its task (via terminal logs, database updates, or UI changes)?"
- "**The Documentation:** Does the public GitHub repository feature a clean architecture diagram and reproducible setup instructions? Is there visual proof of Google Cloud deployment in the video?"

### Stage Three — bonus, up to 1.0

| Bonus | Max | Condition |
|---|---|---|
| Published content (blog, podcast, video) | **0.2** | Public, not unlisted; must state it was created for this hackathon |
| Social media post | **0.2** | X, LinkedIn, Instagram or Facebook; hashtag `#AllThingsAgenticHackathon` |
| Additional Google AI models | **0.6** | **0.2 each** — three additional models to reach the cap |

> "Earn 0.2 bonus points for each additional Google AI model successfully integrated (such
> as Gemma, Veo, or Lyria), up to a maximum of 0.6 total bonus points"

One extra model earns 0.2, not 0.6. All three bonus routes together are 1.0.

### How the Grand Prize is decided

> "The highest-scoring Submission for each category will be selected as the potential
> winner(s). **The highest-scoring Submission across all categories will win the Grand
> Prize.**"

Ties break criterion by criterion in the order listed — Innovation first — then a judge
vote. You do not enter the Grand Prize; you win it by being the highest-scoring submission
in the contest.

---

## 5. Prizes — 16 awards

| Prize | Cash | Credits | Qty | Eligibility |
|---|---|---|---|---|
| **Grand Prize** | **$50,000** | $5,000 | 1 | All eligible projects |
| The Taskmaster | $20,000 | $2,000 | 1 | That category |
| The Collaborative Partner | $20,000 | $2,000 | 1 | That category |
| The Fortified Enterprise Fleet | $20,000 | $2,000 | 1 | That category |
| Startup Excellence | $20,000 | $5,000 | 1 | **Incorporated organisation + corporate email address** |
| Individual/Hobbyist (Best Team/Solo Build) | $10,000 | $1,000 | **2** | All eligible individuals/teams |
| Best Architectural Design | $5,000 | $1,000 | **2** | Top scoring in that criterion |
| Best Multimodal UX | $5,000 | $1,000 | **2** | Top scoring in that criterion |
| Honorable Mentions | $2,000 | $500 | **5** | Runners up |

> **"Each Project is eligible for up to one (1) Prize."**

A category prize is not additive with the Grand Prize — it is one or the other.

---

## 6. Eligibility and originality

> "**New Projects Only:** Projects must be newly created during the Submission Period.
> Participants may use standard development tools, including frameworks, libraries,
> starter templates, and AI coding assistants, but **must disclose any other pre-existing
> code or work incorporated into the Project.** The work described and submitted must have
> been built during the Submission Period."

Concept and prior art are fine with disclosure. Pre-existing source is not, unless
disclosed — and the work itself must have been built in-window (3–31 Aug 2026).

Other binding conditions:

- **Ownership** — original work, solely owned, violating no third party's IP, publicity or privacy rights.
- **Third-party integrations** must be used in accordance with their terms and licensing.
- **No financial or preferential support** from Google or Devpost prior to the end of the Submission Period.
- **Testing access** — the project must be available free of charge and without restriction to the Sponsor, Administrator and Judges until the Judging Period ends; credentials must be supplied if private.
- **Multiple submissions** are permitted if "unique and substantially different."
- **Ineligible:** residents of Italy, Quebec, and the listed sanctioned territories; Google and Devpost employees, contractors and their households; anyone whose participation creates a conflict of interest.

---

## 7. The submission checklist

- [ ] **Project** meeting the mandatory stack (§2)
- [ ] **One category** selected
- [ ] **URL to hosted project** — "A hosted project is highly encouraged"
- [ ] **Text description** — summary of features and functionality, technologies used, data sources, and "your findings and learnings as you worked through the project"
- [ ] **Code repository URL** — public, or private with access granted to `testing@devpost.com` and `cloudhackathons@google.com`
- [ ] **Spin-up instructions** in `README.md` — "Even if the judges do not run it, these instructions prove the project is reproducible"
- [ ] **Architecture diagram** — "a clear visual representation of your system"
- [ ] **Demo video** — ≤ 4:00, publicly visible on YouTube or Vimeo, English or English-subtitled; covers the problem, the value proposition and a demo in action; and **must demonstrate the backend running on Google Cloud** (Cloud Console, Cloud Run dashboard, Vertex AI logs, a `.run` URL)
- [ ] Bonus: public build write-up; social post with `#AllThingsAgenticHackathon`; additional Google AI models

The submission must contain no third-party advertising, slogans, logos or trademarks, and
nothing that implies sponsorship or endorsement by a third party.

---

## 8. Two facts that should shape everything we write

**The judges may never run the code.**
> "Judges are not required to test the Project and may choose to judge based solely on the
> text description, images, and video provided in the Submission."

**The judge may not be a person.**
> "This process may utilize expert panels, peer review, **automated AI-driven analysis**,
> or any combination thereof, to ensure efficient, fair, and objective evaluation."

The panel is unnamed — "A qualified panel of Judges" — and the rules reserve the right to
change it before or during judging.

The consequence is that the **README, the text description and the video carry the score.**
They have to stand alone, state plainly what the system does and what it actually did, and
be checkable without running anything. Anything a generous human reader would infer in our
favour is something an automated scorer will not.

---

## 9. Maintaining this file

The rules can change. Before submission:

```bash
./scripts/fetch_rules.sh          # re-downloads and diffs against the archive
```

If the diff is non-empty, update this file and re-check every plan that depends on it.
