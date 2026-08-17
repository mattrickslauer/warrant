# Particle Physics Agent

> **A physics AI agent that converts natural language into validated Feynman diagrams**
>
> Winner, Agent Development Kit Hackathon with Google Cloud.
> Source: https://devpost.com/software/particle-physics-agent
> Archived 2026-08-17. Raw HTML: `../raw/particle-physics-agent.html`

---

*

## Inspiration

The complexity of particle physics often creates a barrier between theoretical knowledge and practical visualization. Researchers, educators, and students frequently struggle to create accurate Feynman diagrams—the fundamental visual language of particle physics. We were inspired by the potential to democratize physics education and research by building an AI system that could understand natural language descriptions and generate professional-quality diagrams. The recent release of Google's Agent Development Kit presented a unique opportunity to pioneer multi-agent collaboration in scientific applications, combining cutting-edge AI with authoritative physics knowledge.

## What it does

**Particle Physics Agent** transforms natural language descriptions into professional, compilable TikZ-Feynman LaTeX code. Users simply describe a particle interaction in English or Chinese (e.g., “electron-positron annihilation producing two photons”), and the system generates ready-to-use LaTeX diagram code. The system features six specialized AI agents working collaboratively to ensure both physics accuracy and LaTeX compilation success. It validates particle interactions against the Particle Data Group database, searches through 150+ curated examples, and includes automatic error correction with up to 3 refinement attempts, achieving a 95%+ success rate for generating compilable diagrams.

## How we built it

We architected a sophisticated multi-agent system using Google's Agent Development Kit (ADK) 1.0.0 with Gemini 2.0 Flash as the core language model. The system integrates six specialized agents:

  * `PlannerAgent`: Natural language parsing

  * `KBRetrieverAgent`: Vector-based knowledge search using Annoy indexing

  * `PhysicsValidatorAgent`: Physics rule enforcement via Model Context Protocol (MCP)

  * `DiagramGeneratorAgent`: TikZ code generation

  * `TikZValidatorAgent`: **Syntax checking only** for TikZ-Feynman code (not full compilation)

  * `FeedbackAgent`: Result synthesis and iterative refinement

We built custom MCP integrations with the `ParticlePhysics-MCP-Server` for real-time physics validation and created a curated knowledge base of 150+ professional diagram examples with vector embeddings for semantic search.

## Challenges we ran into

  * **LaTeX Complexity** : TikZ-Feynman syntax validation required building a robust local compilation environment with detailed error parsing and reporting mechanisms.

  * **Physics Accuracy** : Balancing comprehensive validation with runtime efficiency required careful design of MCP server calls and local rule checks.

  * **Multi-Agent Coordination** : Optimal sequencing and inter-agent communication was non-trivial; sequential validation loops significantly outperformed parallel processing.

  * **Unrelated Histories** : Integrating multiple Git branches from divergent development cycles created merge complexity.

  * **Multilingual Support** : Ensuring accurate technical translation between Chinese and English while maintaining physics fidelity posed unique challenges.

## Accomplishments that we're proud of

  * **Industry-First Implementation** : First known scientific use of Google’s ADK, pioneering multi-agent collaboration in physics tooling

  * **Exceptional Reliability** : 95%+ success rate for LaTeX-validated diagram generation

  * **Physics Integration** : Real-time validation using PDG data through custom MCP protocols

  * **Performance Excellence** : Sub-30s generation for multi-particle diagrams with high code quality

  * **Multilingual Breakthrough** : Accurate technical handling of both English and Chinese particle interaction descriptions

## What we learned

  * **Multi-Agent Architecture** : Sequential execution with validation loops yields better results for technical generation (95% vs 70% success rate over parallel)

  * **Vector Search Optimization** : Using curated example databases with semantic retrieval drastically reduces hallucinations

  * **MCP Protocol Advantages** : Provides clean standardization for connecting physics databases and logic validation tools

  * **Error Recovery Systems** : Iterative auto-correction mechanisms greatly enhance robustness and UX

  * **Scientific AI Viability** : With authoritative data and modular logic, AI agents can effectively handle specialized domains

## What’s next for Particle Physics Agent

  * **Expanded Physics Domains** : Add support for decay chains, nuclear interactions, energy level diagrams, etc.

  * **Interactive Capabilities** : Build real-time diagram editing and collaborative tooling

  * **Research Integration** : Enable batch generation for publications and automated figure embedding for arXiv/journal workflows

  * **Educational Platform** : Launch step-by-step explanation modules and curriculum integration for teaching

  * **Community Expansion** : Open-source more components, develop additional MCP servers, and help standardize physics-AI interoperability

## Built With

  * adk
  * [gemini](https://devpost.com/software/built-with/gemini)
  * [git](https://devpost.com/software/built-with/git)
  * [google-cloud](https://devpost.com/software/built-with/google-cloud)
  * [latex](https://devpost.com/software/built-with/latex)
  * [linux](https://devpost.com/software/built-with/linux)
  * macos
  * [markdown](https://devpost.com/software/built-with/markdown)
  * particlephysics-mcp-server
  * [python](https://devpost.com/software/built-with/python)
