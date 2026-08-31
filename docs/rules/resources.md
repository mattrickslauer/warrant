> **Archived from Devpost 2026-08-31.** Source: https://allthingsagentichackathon.devpost.com/resources
> Verbatim extraction of the page's main content. Raw HTML: `raw/resources.html`.
> This is the authority. If anything in our own docs disagrees with this file, this file wins.

---

#### CREDITS

  * Free trial: [cloud.google.com/free](https://cloud.google.com/free)

  * $150 in Google Cloud credits for this hackathon — request via the [credit form](https://forms.gle/5PtXmw1dSbDnpYke9).

####

####  GET HELP

Join the [Devpost Discord](https://discord.gg/HP4BhW3hnp) to ask peers or get help from the community.

Post on the [Discussion Forum.](https://allthingsagentichackathon.devpost.com/forum_topics)

Still Stuck after this page? The [FAQs](https://allthingsagentichackathon.devpost.com/details/faqs) cover credits, required tech and questions about submissions.

Attend or watch a webinar.

Aug 11, 2026

  * 8:30 AM - 10:00 AM PT
  * 9:00 PM - 10:30 PM PT

|  [Architecting Multi-Agent Teams: Mastering the Three Orchestration Patterns of ADK 2](https://cloudonair.withgoogle.com/events/architecting-multi-agent-teams-mastering-three-orchestration-patterns-adk-2) From a single agent to a multi-agent system, and knowing which pattern to reach for.
---|---
Aug 13, 2026

  * 9:00 AM - 10:30 AM PT
  * 9:00 PM - 10:30 PM PT

|  [Build a Long-Running Agent: Persistent Workflows with Google ADK](https://cloudonair.withgoogle.com/events/build-long-running-agent-persistent-workflows-google-adk) Crash recovery, human approval, and the idempotency trap, why a resumable agent might order two laptops.
Aug 20, 2026

  * 9:00 AM - 10:30 AM PT
  * 9:00 PM - 10:30 PM PT

|  [Build a Self-Evolving Agent: Autonomous Self-Improvement](https://cloudonair.withgoogle.com/events/build-self-evolving-agent-autonomous-self-improvement) _Watch it rewrite its own instructions and climb the score, then catch it gaming the metric._
August 25th |  [Devpost Build Session Q&A with Google Cloud](https://youtu.be/DCXjvKmUIGY?si=2cIUetzcYdEnUFJe)
Aug 27, 2026

  * 9:00 AM - 10:30 AM PT
  * 9:00 PM - 10:30 PM PT

|  [Architecting Agent Memory: Session State, Vector Search, and Managed Cloud Memory](https://cloudonair.withgoogle.com/events/architecting-agent-memory-session-state-vector-search-managed-cloud-memory) Persistence is not memory, climb the whole hierarchy, from a forgetful goldfish to managed cloud memory.

####

#### EXPLORE THE TRACKS

##### The Taskmaster — in depth

  * **The focus:** An event-driven workflow with autonomous routing. Your system acts like a smart coordinator — watching for a change, figuring out what needs to happen next, and interacting with different apps to get the job done, from start to finish, without you guiding each step.
  * **Examples:** An "Automated Product Manager" that reads meeting transcripts, extracts action items, creates Jira tasks, and posts a summary to Slack. A "Freelance Pipeline" agent that watches your inbox for new inquiries, checks your calendar, drafts a proposal from your past work, and saves it for review.

##### The Collaborative Partner — in depth

  * **The focus:** Stateful, multi-turn dialogue with real-time context retrieval (RAG) and persistent memory, so your agent adapts and personalizes based on past interactions instead of starting over each time.
  * **Examples:** An expert guide that helps you understand a dense legal document, quizzes you as you go, learns which concepts you struggle with, and adapts future explanations. A UI/UX helper for non-designers that turns a vague idea into a wireframe and learns your brand preferences from your corrections.

##### The Fortified Enterprise Fleet — in depth

  * **The focus:** Corporate agent discovery, multi-agent orchestration at scale, long-term state persistence, runtime observability, and security posture enforcement. Show how an organization can discover your agents, audit their reasoning, trust their data handling, and scale them safely. Open to everyone — not just startups or enterprises.
  * **Recommended tech** **(Gemini Enterprise Agent Platform)** : Agent Registry (discovery/versioning); Agent Runtime (long-running async execution) + Memory Bank (persistent cross-session context); Agent Identity (zero-trust access), Agent Gateway (routing + policy), Model Armor (guardrails against prompt injection, tool poisoning, PII leaks); Agent Observability (audit logs + reasoning-chain traces).
  * **Example:** An "Enterprise Supply Chain Orchestrator" that a procurement manager finds in the internal Agent Registry to run a multi-week vendor onboarding cycle — monitoring delivery webhooks, remembering negotiation data via Memory Bank, securely querying private ERP inventory with Agent Identity, coordinating with a logistics sub-agent through Agent Gateway, and screening all external email with Model Armor.

####  START WITH GEAR (Gemini Enterprise Agent Ready)

Gemini Enterprise Agent Ready (GEAR) is Google's skilling program for learning to build and deploy enterprise-grade AI agents — and it's the ideal on-ramp for this hackathon. It's built for everyone, from non-coders to professional developers.

  * Is it free? Yes. completely free, as part of the Google Developer Program.

  * Any prerequisites? None. Anyone can join.

  * How do I sign up? Sign in to your [Google Developer Program profile](https://developers.google.com/program/gear) and claim the GEAR badge.

  * What do I get? 35 monthly learning credits on Google Skills to run hands-on labs in a no-cost sandbox, official ADK training, and skill badges you can earn on your Google Developer profile.

  * Where do I begin? Start with the [Introduction to Agents](https://www.skills.google/paths/3546) path, then move on to the Build and Deploy paths.

  * Questions? The [GEAR FAQ](https://developers.google.com/profile/help/gear) covers the details.

Different from GEAP tools listed for Fortified Enterprise Fleet category

####

#### Gemini Enterprise Agent Platform (GEAP) — for the Fortified Enterprise Fleet track

The Gemini Enterprise Agent Platform is Google Cloud's managed platform for building, deploying, governing, and scaling enterprise AI agents. It's the recommended toolkit for the Fortified Enterprise Fleet track and includes the Agent Registry (a central catalog to securely store, discover, and govern agents and tools), Agent Runtime (a fully managed, scalable runtime for long-running agents), and Memory Bank (long-term, cross-session memory that personalizes agent interactions), plus identity, gateway, guardrails, and observability.

  * [Platform overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview)

  * [Documentation home](https://docs.cloud.google.com/gemini-enterprise-agent-platform)

  * [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime)

  * [Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank)

  * [Announcement blog](https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform)

#####

#####

#### BUILD YOUR AGENT

  * [Gemini API](https://ai.google.dev) & [Google AI Studio](https://aistudio.google.com) — models, quickstarts, multimodal guides

  * [Agent Development Kit (ADK)](https://google.github.io/adk-docs) — the fastest way to build, evaluate, and deploy agents:  [github.com/google/adk-python](https://github.com/google/adk-python)

  * [Antigravity SDK](https://antigravity.google/docs/sdk) — a pre-packaged agent runtime tightly integrated with Gemini:

  * [Genkit](https://firebase.google.com/docs/genkit) — open-source framework for AI-powered apps (JS, Go, Python):

  * [Cloud Run](https://cloud.google.com/run) — deploy your agent with a URL; scales to zero when idle

  * [Firestore](https://cloud.google.com/firestore) — simple NoSQL datastore for agent state/memory

#####

#####

#### PRO TIPS TO KEEP YOUR COSTS DOWN

  * **Use Gemini Flash First:** Reserve Gemini Pro strictly for complex final reasoning.

  * **Scale to Zero (Pay Only When Used):** Keep minimum instances at 0 so your app "goes to sleep" when idle and you are never charged for inactive time.

  * **Start Small & Set Max Instance Caps: **Provision minimal initial RAM/CPU and set a strict ceiling on maximum copies running at once to block unexpected spikes.

  * **Use Serverless Vector Search:** Avoid dedicated, always-on database clusters.

  * **Keep Storage Footprints Light:** Store only essential state, compress long-term memories, and clean up temporary execution artifacts regularly.

  * **Set Budget Alerts:** Turn on billing alerts in the Google Cloud Console so you receive email warnings before crossing your target spend.

  * **Secure Your Endpoints:** Protect public Cloud Run URLs with API keys or authentication so unexpected web traffic can't drain your credits.

  * **Turn It Off After Demo:** Record proof that your agent worked on GCP for your demo video, then switch off services and delete unused resources immediately when finished.
