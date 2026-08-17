# Energy Agent AI

> **Multi-agent AI transforming energy customer management**
>
> Winner, Agent Development Kit Hackathon with Google Cloud.
> Source: https://devpost.com/software/energy-agent-ai
> Archived 2026-08-17. Raw HTML: `../raw/energy-agent-ai.html`

---

*   * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/503/962/datas/original.png) __

_WattsWise AI_

## Inspiration

After 7 years as a data scientist in the retail energy sector, I've witnessed a persistent gap between what ML models can achieve and how their insights are actually used. While we build sophisticated models that deliver excellent predictions, the resulting actions often become generic and watered down. Marketing campaigns can't be super personalized because existing systems require simplicity and broad appeal. Most importantly, the people who could benefit from these insights aren't technical enough to extract maximum value from complex ML outputs.

With AI agents emerging as a solution, I realized we could finally bridge this gap. AI can handle the hard work of understanding ML concepts and technical details, allowing users to simply ask questions and get the best out of everything - at scale, at lower cost, with no information lost in translation.

## What it does

WattsWise AI is a comprehensive multi-agent system that transforms how energy companies manage their customers. Built with Google ADK, it orchestrates two sophisticated agent systems:

**Core Orchestrator System:**

  * **Portfolio Analysis Agent** : Analyzes customer segments using XGBoost models with SHAP explanations for business intelligence
  * **Personalized Sales Agent** : Predicts cross-sell/upsell opportunities and creates targeted campaigns
  * **Personalized Retention Agent** : Identifies churn risks and generates personalized retention strategies
  * **Energy Efficiency Agent** : Analyzes smart meter data and provides TOU plan recommendations
  * **Data Visualization Agent** : Converts natural language queries into sophisticated charts and analytics

**Marketing Agent System:**

  * Auto-routes between Email Marketing, Social Media, Direct Mail, and Landing Page specialist agents
  * Generates complete, downloadable marketing packages with professional content and visuals

The system manages 100,000 simulated customers on BigQuery, using 7 XGBoost models hosted on GCS with SHAP explanations to transform predictions into actionable, personalized customer strategies.

## How we built it

**Architecture** : Built entirely on Google Cloud using ADK for multi-agent orchestration, BigQuery for data management, GCS for ML model hosting, Gemini for AI intelligence, and Cloud Run for deployment.

**ML Pipeline** : Developed 7 specialized XGBoost models (churn, cross-sell, upsell predictions) with SHAP explanations, enabling agents to not just predict but explain _why_ customers behave certain ways.

**Agent Design** : Created intelligent SQL tools for BigQuery data access and ML Model tools for predictions, allowing agents to seamlessly combine data retrieval with machine learning insights.

**User Interface** : Built with Streamlit to provide an intuitive chat interface where users can ask natural language questions and receive comprehensive analysis, visualizations, and actionable recommendations.

**Integration** : Seamlessly connected portfolio analysis insights to marketing campaign generation, creating an end-to-end pipeline from customer intelligence to marketing action.

## Challenges we ran into

**Correlation is not causality** : The SHAP explanations are explaining the ML model prediction. They are not causal models and hence not always the causal actions to be taken from them. However it is still very useful as these lead to proactive solutions and the real root cause analysis

**Time Constraints** : With only weekend hours available, every development session had to be maximally productive. Balancing feature development with system integration proved challenging.

**UI Development** : Creating an intuitive interface that could handle complex multi-agent workflows while remaining user-friendly required multiple iterations and careful UX design.

**Synthetic Dataset** : Building a realistic 100,000-customer energy dataset with proper relationships, seasonal patterns, and business logic that would showcase the system's capabilities authentically.

**Agent Coordination** : Ensuring smooth communication between multiple agents, proper error handling, and maintaining context across complex multi-step workflows.

## Accomplishments that we're proud of

**Complete Google Cloud Integration** : Successfully implemented the full Google Cloud ecosystem - ADK, BigQuery, GCS, Gemini, and Cloud Run - working seamlessly together.

**Enterprise-Scale Architecture** : Built a system that genuinely handles enterprise-level complexity with 100K customers and real-time multi-agent coordination.

**Explainable AI** : Integrated SHAP explanations throughout the system, ensuring every prediction comes with actionable insights about contributing factors.

**End-to-End Automation** : Created a complete pipeline from customer data to marketing campaigns, demonstrating true business value beyond just technical capabilities.

**Professional Quality** : Delivered a polished, production-ready interface that energy industry professionals could actually use.

## What we learned

**ADK Simplicity** : Coming from a LangGraph background, I was amazed at how much easier Google ADK makes agent development. The framework handles complexity elegantly while providing powerful orchestration capabilities.

**Multi-Agent Potential** : The possibilities are truly limited only by imagination. Once the framework is in place, adding new agents and capabilities becomes surprisingly straightforward.

**Business-AI Gap** : This project reinforced my belief that the biggest opportunity in AI isn't just building better models, but creating systems that make sophisticated AI accessible to non-technical business users.

**Google Cloud Ecosystem** : The integration between Google Cloud services is exceptional - each component enhances the others, creating capabilities that exceed the sum of their parts.

## What's next for WattsWise AI

**Prospect Intelligence System** : Adding a comprehensive prospect component with a RAG agent that allows potential customers to compare all available market plans against their specific needs.

**Smart Meter Analysis for Prospects** : Enabling prospects to upload their smart meter data to receive exact cost calculations across all available plans, revealing hidden fees and true costs that marketing rates often obscure.

**Enhanced TOU Analysis** : Expanding Time-of-Use plan fitting and optimization for any prospect based on their actual usage patterns, providing personalized recommendations that go beyond generic rate comparisons.

**Competitive Intelligence** : Building agents that continuously monitor market rates and competitor offerings, ensuring recommendations always reflect the current landscape.

**Advanced Personalization** : Developing even more sophisticated personalization engines that can create truly unique customer experiences at scale.

The vision is to transform energy retail from a commodity business into a personalized service industry where every customer interaction is optimized by AI agents that understand both the technical details and human needs.

## Built With

  * adk
  * bigquery
  * cloudrun
  * [gemini](https://devpost.com/software/built-with/gemini)
  * [google](https://devpost.com/software/built-with/google--2)
  * [google-bigquery](https://devpost.com/software/built-with/google-bigquery)
  * [python](https://devpost.com/software/built-with/python)
  * vertex
