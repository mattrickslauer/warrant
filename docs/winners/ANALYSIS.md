# What the eight winning submissions have in common

Source material: the eight winners of the **Agent Development Kit Hackathon with Google
Cloud**, archived verbatim in `projects/`. That contest drew **10,352 participants** and
**476 submissions** — a 4.6% conversion from registration to entry.

**Read these as evidence, not as a rubric.** That contest scored Technical Implementation
50% / Innovation and Creativity 30% / Demo and Documentation 20%, and its grand prize was
$15,000. Ours is 40 / 30 / 30 with a $50,000 grand prize and a mandatory Google Cloud
deployment. The weights moved toward demo and documentation, so the bar on proof is
higher for us than it was for them.

| Project | Domain | Agents | Notable |
|---|---|---|---|
| SalesShortcut | Sales development | **34** | 5 Cloud Run microservices, A2A, ElevenLabs voice |
| Bleach | Developer tooling | meta-agents | Visual builder *for ADK itself* |
| Particle Physics Agent | Science | 6 | Validates against Particle Data Group via custom MCP |
| TradeSage AI | Finance | 6 | Cloud SQL + pgvector RAG |
| Energy Agent AI | Energy retail | 5 + marketing fleet | 100,000 **simulated** customers, 7 XGBoost models, SHAP |
| Edu.AI | Education | 8 | Solo builder; **stack ran locally** |
| GreenOps | Cloud FinOps / carbon | 7 | Publishes generated Docs and slide decks |
| Nexora-AI | Education | — | Interactive personalised lessons |

---

## The seven patterns

**1. A named cast of specialised agents is the centrepiece.**
Every single winner presents its agents as a list of narrow, legible roles —
`infra_scout_agent`, `ContradictionAgent`, `EssayEvaluatorAgent`, `safe_executor_agent`.
Five to eight is the common range; SalesShortcut's 34 is the outlier, not the norm. The
role name does the explaining. Nobody wins by describing a monolith that "uses AI."

**2. The first paragraph is a human problem, usually a personal one.**
SalesShortcut opens on a friend cold-calling businesses. Energy Agent AI opens on "7 years
as a data scientist in the retail energy sector." Edu.AI opens on 3.9 million Brazilian
students for whom one exam is the gateway out of poverty. None of them open with
architecture. The technology arrives in section three, every time.

**3. Numbers, even when the numbers are synthetic.**
"95%+ success rate." "150+ curated examples." "100,000 customers." "34 agents." "Sub-30s
generation." Energy Agent AI's hundred thousand customers were openly simulated and it won
anyway. Specificity reads as rigour whether or not the underlying data is real.

**4. Generated artifacts you can click.**
GreenOps links the actual Google Doc and the actual slide deck its agents produced. That
converts a claim into a thing a judge can open in one click. It is the cheapest credibility
in the entire set and only one of eight did it.

**5. Screenshots, in volume.**
Edu.AI ships nine images, Bleach eight, GreenOps five — architecture diagrams, agent-flow
diagrams, and product screens. The submissions are visually dense. Given our rules
explicitly require an architecture diagram and visible proof of Cloud deployment, this is
now a scored requirement rather than a nicety.

**6. Deployment completeness was not decisive.**
Edu.AI states plainly that "the whole stack runs locally for now." TradeSage says it failed
to deploy to Agent Engine and fell back to Cloud Run. Both won. **This is the pattern most
likely to mislead us**, because our rules make Cloud deployment proof mandatory in the
video and put 30% on Demo & Production Readiness. What carried them was the clarity of the
problem and the legibility of the agent cast — but we cannot copy their gap.

**7. Nobody had real users, real usage, or real outcomes.**
Across all eight, every claim is capability-shaped: what the system *can* do, demonstrated
on synthetic or self-supplied inputs. Not one reports a stranger using it, a real
transaction, or an outcome that happened in the world. This is the clearest open goal in
the entire dataset.

---

## Two observations that cut against conventional wisdom

**Thin can win if it serves the sponsor's platform.**
Bleach is by far the least substantial submission in the set — roughly 4,000 characters of
description, no metrics beyond "95%+ accuracy," and a stack listing only ADK, Gemini,
Python and React. No Cloud Run, no data layer. It won because it is a visual builder *for
Google's own ADK*: it makes the sponsor's platform easier to adopt. Alignment with the
sponsor's commercial interest is a real force in the scoring.

**The winners are not uniformly enterprise.**
Two of eight are education, one is academic physics, one is developer tooling. The claim
that only enterprise or professional-utility projects win is too strong. What is true is
that none of the eight is a creative, media, or cultural project — the closest thing to a
consumer product in the set is an exam-prep tool aimed at social mobility. The distinction
that seems to matter is **consequence**, not sector: every winner attaches to something
with real stakes for an identifiable person.

---

## What this implies for our submission

1. **Lead with the person and the stakes**, not the fleet. Architecture is section three.
2. **Name every agent, keep each role narrow**, and publish the cast as a table. Five to
   eight well-drawn agents beats a vague larger number; SalesShortcut earned its 34 with
   five deployed microservices behind it.
3. **Make the output clickable.** Whatever our system produces, a judge should be able to
   open a real one in a browser without running anything — and per the rules, they may
   never run anything.
4. **Ship the architecture diagram and Cloud Console proof**, because unlike this cohort we
   are scored on it explicitly.
5. **Quantify everything**, and mark plainly which numbers are measured and which are
   simulated. Being explicit about the difference is a differentiator in a field where the
   distinction went unmarked.
6. **Real-world results remain unclaimed territory.** Every winner in this set is a system
   that *can*. None is a system that *did*.
