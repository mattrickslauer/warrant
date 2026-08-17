# Nexora-AI

> **Next Gen Personalized Education with interactive lessons**
>
> Winner, Agent Development Kit Hackathon with Google Cloud.
> Source: https://devpost.com/software/teachai-upzofa
> Archived 2026-08-17. Raw HTML: `../raw/teachai-upzofa.html`

---

*   * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/438/datas/original.png) __

_Turn any topic into a complete course with interactive visualizations. AI agents collaborate to create personalized learning paths._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/500/datas/original.png) __

_From single query to complete course: AI creates structured chapters with custom visuals and interactive learning experiences._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/484/datas/original.png) __

_Create courses tailored to you._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/507/datas/original.png) __

_From text to interactive simulations: AI creates engaging course content that lets students experience concepts, not just read them._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/518/datas/original.png) __

_Beyond static courses: AI generates interactive content + provides real-time tutoring. Ask questions, get instant expert responses._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/566/datas/original.png) __

_Get instant dynamic feedback on your answers to the Quizzes._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/507/564/datas/original.png) __

_And of course you can also take notes on what you have learned._

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/508/094/datas/original.png) __

__

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/508/099/datas/original.png) __

__

  * [ ](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/508/098/datas/original.png) __

__

Nexora-AI: Revolutionizing Education with Multi-Agent LLMs and Dynamic React Visualizations

## 🎯 Inspiration

Traditional AI-generated educational content is static, text-heavy, and frankly boring. We've all seen LLMs produce walls of text that explain concepts without truly showing them. When we set out to build Nexora AI, we had a bold vision: create an AI-powered learning platform that doesn't just generate text-based courses, but produces rich, interactive educational experiences with dynamic visualizations, charts, and interactive components.

The Google Cloud Multi-Agents Hackathon challenged us to rethink fundamental assumptions about AI output. Why should AI be limited to text when it could generate entire interactive experiences?

## 🚀 What it does

Nexora AI transforms simple user queries like "I want to learn about the solar system" into comprehensive, interactive courses featuring:

  * **Dynamic 3D Visualizations** \- Watch planets orbit in real-time, explore Earth's layers, or see algorithm visualizations in action
  * **Interactive Charts & Graphs** \- Data comes alive with Plotly-powered scientific visualizations and Recharts components
  * **Adaptive Learning Path** s - AI-generated course structures that adapt to your learning style
  * **React-Powered Interactivity** \- Every explanation includes interactive components you can manipulate
  * **Smart Assessment** \- Quizzes that also use React components for engaging, visual problem-solving

**Live Demo** : [nexora-ai.de](https://nexora-ai.de)

## 🏗️ How we built it

### Revolutionary Multi-Agent Architecture

Nexora leverages the **Google Cloud Agent Development Kit (ADK)** to orchestrate multiple specialized agents:

  * **Course Planner Agent** \- Generates overall course structure and learning objectives
  * **Content Creator Agent** \- Produces chapter content with educational explanations
  * **Explainer Agent** \- Creates interactive React components with visualizations
  * **Quiz Generator Agent** \- Develops adaptive assessments using React components
  * **Interactive Chat Agent** \- Provides contextual support throughout learning
  * **Image Agent** \- Sources relevant visual content via external APIs

Agent Structure

### The Breakthrough: React Code as LLM Output

Instead of generating static text or markdown, we made a bold decision:

**Let the LLM output raw React code directly.**

Our agents generate React components using:

  * **Plotly** for complex scientific and mathematical visualizations
  * **Recharts** for data visualization and charts
  * **React-Flow** for flowcharts and algorithm visualizations
  * **LaTeX rendering** for mathematical equations
  * **Syntax highlighting** for code examples

### Tech Stack

**Backend** :

  * Python 3.12 with FastAPI
  * Google Cloud Agent Development Kit (ADK)
  * Multiple Gemini models (2.5-Pro, 2.5-Flash, 2.5-Flash-Lite)
  * MySQL + ChromaDB for data storage
  * Docker containerization

**Frontend** :

  * React with Vite
  * Mantine UI components
  * Tailwind CSS
  * Dynamic React component rendering

**Validation Pipeline** :

  * ESLint analysis for code quality
  * Security validation to prevent code injection
  * Multi-iteration feedback loops for code improvement

## 🔥 Challenges we ran into

  1. **Code Generation Reliability** \- Getting LLMs to consistently generate valid, executable React code was initially problematic. We solved this with a sophisticated validation pipeline and iterative feedback loops.
  2. **Agent Coordination** \- Managing state consistency across multiple agents while maintaining course coherence required careful orchestration through the ADK.
  3. **Security Concerns** \- Executing AI-generated code posed security risks. We implemented comprehensive validation and sandboxing.
  4. **Performance Optimization** \- Rendering complex visualizations while maintaining smooth user experience required significant optimization.
  5. **Context Management** \- Ensuring agents maintained context about the overall course while focusing on their specific tasks.

## 🏆 Accomplishments that we're proud of

  * **Mastered React Code Generation** \- We believe to successfully have LLMs generate production-ready React components at scale
  * **Seamless Multi-Agent Orchestration** \- The ADK enabled us to create a complex system that feels simple to users
  * **Visual Learning Revolution** \- Transformed abstract concepts into tangible, interactive experiences
  * **Production-Ready Platform** \- Built a fully functional platform deployed at nexora-ai.de
  * **Google ADK Innovation** \- Pushed the boundaries of what's possible with the Agent Development Kit

## 📚 What we learned

  1. **LLMs are more capable than expected** \- Modern language models can generate sophisticated, functional code when properly guided and validated
  2. **Multi-agent coordination is powerful** \- The ADK's orchestration capabilities enabled complexity that would be impossible with single-agent approaches
  3. **User experience is everything** \- Technical innovation means nothing without intuitive, engaging user interfaces
  4. **Validation is critical** \- Robust testing and validation pipelines are essential when dealing with AI-generated code
  5. **Visual learning works** \- Interactive visualizations dramatically improve comprehension compared to static text

## 🔮 What's next for Nexora

  * **Collaborative Learning** \- Multi-user courses and peer interaction features
  * **Advanced Analytics** \- Learning pattern analysis and personalized recommendations
  * **Mobile Applications** \- Native iOS and Android apps for learning on-the-go
  * **Enterprise Integration** \- B2B solutions for corporate training and education institutions
  * **Global Accessibility** \- Multi-language support and accessibility improvements
  * **Flash Cards** \- Utilise active recall for optimal memorisation

👥 Built with ❤️ by Team Nexora Markus Huber - Software Architect Luca Bozzetti - AI Engineer Jonas Hoerter - RAG Specialist Matthias Meierlohr - UI/UX Wizard

Try Nexora AI today: nexora-ai.de

Tags: #adkhackathon #GoogleCloud #AI #Education #React #LLM #MultiAgent

The future of AI isn't just about generating better text — it's about generating better experiences. And with tools like the ADK making multi-agent coordination seamless, we're just scratching the surface of what's possible.

## Built With

  * chromadb
  * [docker](https://devpost.com/software/built-with/docker)
  * fastapi
  * google-adk
  * [google-cloud](https://devpost.com/software/built-with/google-cloud)
  * [javascript](https://devpost.com/software/built-with/javascript)
  * [mysql](https://devpost.com/software/built-with/mysql)
  * [python](https://devpost.com/software/built-with/python)
  * [react](https://devpost.com/software/built-with/react)
  * vite
