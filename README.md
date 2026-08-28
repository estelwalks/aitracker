# AITracker

[English](README.md) | [简体中文](docs/README_CN.md) | [日本語](docs/README_JA.md) | [한국어](docs/README_KO.md)

> **See at a glance how many tokens you use, how much you spend, and which agent tools work best for you.**

AITracker is an **open-source, local-first AI workspace**.

It automatically tracks tokens, costs, and usage trends across AI tools such as Claude Code, Codex, and Cursor; brings Skills and frequently used configurations into one place; distills Skills from real work and usage history; and builds a personal knowledge base and long-term memory. Every AI session can become a reusable capability for the next one.

**Open Source · Local · No Account Required**

> Note: The diagrams are preserved from the source document. Chinese text embedded inside the image files remains unchanged; all Markdown copy in this document is translated into English.

---

## Quick Start

AITracker is a desktop application built with Electron, TanStack Start, React,
and TypeScript. The repository includes the `skill-scanner` package it depends
on, so a fresh clone can be installed and built without a sibling repository.

### Requirements

- Node.js 22 or later
- npm 10 or later
- macOS or Windows for the complete desktop experience

```bash
git clone https://github.com/estelwalks/aitracker.git
cd aitracker
npm ci
npm run dev:desktop
```

To run the browser development server only, use `npm run dev`.

### Build and Test

```bash
npm run build:desktop       # Web app + Electron main/preload bundles
npm run typecheck           # App and bundled scanner
npm run lint                # App and bundled scanner
npm run test:all            # Unit, tooling, database, and scanner tests
npm run check:opensource-hygiene
```

Platform installers can be produced with `npm run dist:mac` or
`npm run dist:win:x64`. Signing and notarization credentials are not stored in
this repository.

See [Development Guide](docs/DEVELOPMENT.md) for the complete command matrix,
generated-file policy, and repository layout.

---

## Why AITracker?

The number of AI tools keeps growing.

Claude Code, Codex, Cursor, Cline, Gemini CLI, OpenCode…

As the number of tools increases, so do the questions:

- How much AI am I actually using?
- Where are my tokens and money going?
- Which tool or model is the best fit for me?
- Where are all my Skills and other configurations scattered?
- Do I have to configure everything again whenever I switch AI tools?
- Can I reuse a method that worked today the next time I need it?
- Can AI remember my projects and long-term working experience?

**AITracker brings all of this together in one place.**

From understanding your AI usage, to managing AI capabilities, to distilling Skills and building lasting knowledge and memory, AITracker turns AI from a one-off tool into an evolving system of reusable capabilities.

---

## 🌟 Core Capabilities

| Capability                   | Description                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI Usage Analytics**       | Automatically aggregates tokens, costs, models, projects, and usage trends across AI tools, so you know exactly how much AI you use and where your money goes |
| **AI Tool Analytics**        | Uses your real usage data to compare the frequency, consumption, and trends of different tools and models, helping you find the AI that suits you best        |
| **Skills Management**        | Automatically discovers and centrally manages Skills scattered across different AI tools, reducing repeated searching and maintenance                         |
| **Configuration Management** | Centrally manages commonly used AI configurations such as Rules, with cross-tool reuse being added progressively                                              |
| **Skills Distillation**      | Extracts reusable experience from real work, historical sessions, and methods that have already been proven to work, gradually turning it into Skills         |
| **Knowledge Base**           | Continuously organizes project materials, methods, experience, and valuable information into a personal knowledge base                                        |
| **Long-Term Memory**         | Continuously preserves project context, usage habits, and important experience, so your next AI session does not have to start from scratch                   |
| **Local First**              | Keeps core data and configurations on your computer whenever possible, with core capabilities available without an account                                    |

---

## Understand Your AI Usage

AITracker automatically collects usage data from AI coding tools on your computer and brings the scattered data together in one Dashboard.

You can view:

- Token usage
- Input / output / cache tokens
- Daily, weekly, and monthly costs
- Usage across different AI tools
- Usage across different models
- Project consumption
- Usage trends

No more guessing how much AI you use.

> **See how much you use, how much you spend, and which tool works best—all at a glance.**

---

## Manage Your AI Capabilities

What is becoming difficult to manage is not just the AI tools themselves, but also the configurations and capabilities scattered across them.

![AI tool network](docs/assets/en/01-ai-tools-network.png)

AITracker automatically discovers these configurations and provides a unified management entry point.

You no longer need to remember which directory contains a particular Skill, or reconfigure everything from scratch whenever you switch tools.

---

## Skills Distillation

A truly valuable Skill does not necessarily need to be written from scratch.

AITracker identifies experience worth reusing from your real work, historical sessions, and methods that have already worked, then gradually distills it into Skills.

![](docs/assets/en/02-skills-distillation.png)

Turn “I finally got it working this time” into “I can reuse this directly in the future.”

---

## Reuse Across Tools

A useful Skill should not belong only to Claude Code.

A configuration that works should not force you to start over when you switch to Codex, Cursor, or another tool.

AITracker aims to build a capability layer above different AI tools:

![](docs/assets/en/03-cross-tool-reuse.png)

Manage everything in one place, then continue using it across different AI tools.

---

## Knowledge Base and Long-Term Memory

AI generates a large volume of conversations every day, but only some of them are truly worth keeping.

For example:

- Important background about a project
- A method that has already been validated
- A troubleshooting process
- A useful prompt
- A Skill
- A Workflow
- An important technical decision

AITracker gradually turns this valuable information into a **knowledge base and long-term memory**.

![](docs/assets/en/04-knowledge-base-memory.png)

So AI no longer has to start from zero every time.

---

## Support for More AI Coding Tools

AITracker is designed for multiple AI tools and is gradually adapting to mainstream AI Coding Tools, including:

`Claude Code` · `Codex` · `Cursor` · `Cline` · `Gemini CLI` · `OpenCode` · ...

It currently covers **data collection and recognition scenarios for 36+ AI tools**, with more being added continuously.

---

## Local First

AITracker runs locally by default.

Your AI usage records, analytics data, Skills, Rules, knowledge, and memories are kept on your own computer whenever possible.

![](docs/assets/en/05-local-first.png)

**No account registration is required for the core features.**

Your data belongs to you.

---

## What Is AITracker Trying to Solve?

In the past, we were usually like this:

![](docs/assets/en/06-past-scattered-tools.png)

Now, it increasingly looks like this:

![](docs/assets/en/07-now-unified-platform.png)

AI tools are becoming more powerful—and more numerous.

But we lack a place that truly belongs to us, where we can **understand, manage, and accumulate these AI capabilities**.

That is what AITracker is trying to build.

> **Understand AI → Manage capabilities → Distill experience → Keep accumulating.**

---

## Contributing

Issues, feature proposals, documentation improvements, and pull requests are
welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a
change. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

AITracker is licensed under the MIT License. See [LICENSE](LICENSE) for the
full license text.

The bundled `packages/skill-scanner` component retains its MIT license; see its
own `LICENSE` and `NOTICE` files.

---

## Star

If AITracker has been helpful, please give the project a Star. Thank you.
