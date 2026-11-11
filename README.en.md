<div align="center">

[Português](README.md) · English · [Español](README.es.md)

# DeskVoice

**An open source phone system run by AI agents, installed on your own VPS.**

The agent answers the call, runs tools during the conversation, asks a human for approval when
it needs to, transfers the call, and leaves tasks running after the caller hangs up.

[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Self-hosted](https://img.shields.io/badge/self--hosted-your%20VPS-orange)](install/install.sh)

[Vision](VISION.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.en.md)

</div>

---

> **Project status: a foundation under construction.** What is ready, what is experimental and
> what is still a plan are kept apart in "What it does today". Nothing on the roadmap has a
> promised date.
>
> This page is a translation of [`README.md`](README.md). Most of the deeper documentation is
> written in Brazilian Portuguese. Translations are an open front in the roadmap.

## Install

### On your VPS

SSH into the server and run:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice && bash install/install.sh
```

The installer checks the machine and the network, asks a few questions (domain, company name,
your name, e-mail and password), generates every secret, starts the services, creates the first
user and shows the panel address. If Docker is missing, it asks and installs it. You do not edit
environment variables by hand. Running it again breaks nothing.

From there, everything is configured on screen: the SIP trunk, the number, the AI key and the
agent. No feature requires SSH to be turned on.

| What you need | Notes |
|---|---|
| A VPS running Ubuntu 22.04 or newer | We recommend [HostGator](https://www.hostgator.com.br/52708-141-3-52.html), the project's infrastructure partner (partner link). Any VPS with Docker works, with the same command. 2 GB of memory or more is recommended |
| A domain pointing to the VPS | Optional for testing. Without a domain, the panel opens by IP and without HTTPS |
| A SIP trunk with a number | From the telephony carrier of your choice. Authentication by registration or by IP |
| A voice AI key | Gemini (Google) or OpenAI. You pay the provider directly |

### See a call with no key and no trunk

The repository ships a simulated voice engine. It runs a whole call, with greeting, tool,
approval request, transfer and post-call task, without an AI key and without a carrier. On your
computer:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # needs Docker: starts a throwaway Postgres and removes it on exit
```

## What it does today

DeskVoice is a freshly launched foundation. So nobody installs it expecting what has not been
proven yet, each capability below says how far the proof went:

- **Proven in simulation:** covered by an end-to-end test with the simulated engine, which walks
  through a whole call with no carrier and no key.
- **Awaiting real-world proof:** implemented and tested against fake servers and a real Asterisk,
  but no call has been placed through a real carrier yet.

| Capability | How far it was proven |
|---|---|
| Call conversation: greeting, turns, tools, hang-up | Proven in simulation |
| Notify a human and ask for approval mid-call, with a deadline and a default answer | Proven in simulation |
| Per-call timeline, event by event, with cost | Proven in simulation |
| Work that continues after the call (summary, notices, follow-up tasks) | Proven in simulation |
| Cost and duration ceiling per call | Proven in simulation |
| Web panel in Portuguese, English and Spanish | Routes tested against a real database; screens checked in Portuguese |
| Answer an inbound call from a carrier line (SIP trunk) | Awaiting real-world proof |
| Transfer the call to a person | Awaiting real-world proof (the Asterisk path was checked, without a carrier) |
| Gemini Live and OpenAI Realtime voice engines | Awaiting real-world proof (tested against a fake server, without a key) |
| Send WhatsApp during the call, through a connector | Awaiting real-world proof |
| Installer, update, health check, backup and restore | Tested against a simulated Docker; backup and restore checked by hand on a real Postgres; VPS install awaiting real-world proof |
| Calls placed by the agent | Awaiting real-world proof, and off by default. See "Outbound calls" |

If you place the first real call, tell us how it went in an issue: it is the most valuable
contribution right now.

What does **not** exist yet: audio recording (the foundation stores the transcript), several
companies on one screen, a visual flow builder, calls over WhatsApp, voice IVR, call queues.
Part of this is on the [roadmap](ROADMAP.md), open to the community.

## How it works

```
        SIP trunk (carrier)
               │ SIP + RTP (UDP)
        ┌──────▼──────┐
        │  Asterisk   │  telephony edge; never talks HTTP to the internet
        └──┬───────┬──┘
   ARI (WS)│       │AudioSocket (TCP, PCM16 8 kHz)
        ┌──▼───────▼──┐        ┌──────────────────┐
        │  apps/voice │◄──────►│ voice engine     │ Gemini Live / OpenAI Realtime / simulated
        │             │        └──────────────────┘
        │  tools      │──► notify a human, ask for approval, transfer, webhook, WhatsApp
        └──────┬──────┘
               │ events + tasks
        ┌──────▼──────┐   LISTEN/NOTIFY   ┌──────────────┐
        │  Postgres   │◄─────────────────►│ apps/routines │ post-call tasks
        └──────▲──────┘                   └──────────────┘
               │
        ┌──────┴──────┐
        │  apps/panel │  Next.js: panel + API; published by Caddy
        └─────────────┘
```

The carrier delivers the call to Asterisk. Asterisk hands control and audio to the voice
process, which talks to the AI model and runs the tools the agent asks for. Everything that
happens becomes an event in Postgres, and the panel builds the call timeline from those events.
When the call ends, a third process carries on with the work.

Stack: Node 22, TypeScript, pnpm, Next.js, Postgres 17 inside the VPS, Asterisk 20, Docker
Compose and Caddy. The path of a call, step by step, is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Relationship with DeskcommCRM

DeskVoice is a sibling of [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM), by the same
creator.

- **DeskcommCRM already has a calls module, and it stays.** The public 500-star goal was met
  there.
- **DeskVoice is an independent system in which telephony is the center.** You do not need
  Deskcomm to use DeskVoice, or the other way around.
- **Later on, the Deskcomm module becomes a connector to DeskVoice.** This is roadmap, with no
  date.

The reasoning is in
[`docs/decisions/0001-fronteira-com-o-deskcomm.md`](docs/decisions/0001-fronteira-com-o-deskcomm.md).

## Costs

The software is free. There is no paid version and no locked feature. You pay three things, all
directly to the supplier:

1. **The VPS.**
2. **Telephony.** It depends on the trunk you contract.
3. **Voice AI.** With direct voice engines, the estimate is in the range of a few US cents per
   minute, depending on the model.

These are estimates, and prices change. The panel shows the measured cost of every call, and
each agent has a cost ceiling per call. See [`docs/guides/custos.md`](docs/guides/custos.md).

## Outbound calls

The agent can place calls. **The feature ships turned off.** The owner of the installation
turns it on from the screen, after declaring the purpose, and from then on these apply:

- a daily cap of calls per line;
- a do-not-call list;
- a time window;
- a limit of attempts per person;
- a recording notice at the start of the call.

The reason: in Brazil, the regulator (Anatel) blocks lines with a pattern of mass short calls,
and telemarketing regulation is changing. DeskVoice was not built for mass dialing and does not
accept contributions that make it easier. Whoever operates the installation is responsible for
how it is used. If you operate outside Brazil, check the rules of your own country. See
[`docs/guides/conformidade-brasil.md`](docs/guides/conformidade-brasil.md).

## Contributing

The project is set up so that a first PR goes well:

- Open the repository in your coding assistant (Claude Code, Codex, Cursor, Antigravity). The
  skills in `.agents/skills/` guide the contribution, and [`AGENTS.md`](AGENTS.md) is the
  authority they all read.
- A tool, a voice engine and a routine each live in their own file and are discovered by folder.
  Your PR does not fight another PR over a central list.
- When CI goes red, it says whether the cause is your PR.

Start with [`CONTRIBUTING.en.md`](CONTRIBUTING.en.md).

## Roadmap

The horizon and the fronts open to the community, each with a size and an entry point in the
code, are in [`ROADMAP.md`](ROADMAP.md).

## Who builds it

DeskVoice was created by Rafael Melgaço ([@melgarafael](https://www.youtube.com/@melgarafael))
and is built in public, with the community. DeskcommCRM, where the contribution workflow used
here comes from, has received PRs from more than 250 people.

Credit is a rule, not a courtesy: contributors keep authorship of their commits and are named
in the release notes. What this project owes to other projects is in [`CREDITS.md`](CREDITS.md).
Who decides what is in [`GOVERNANCE.md`](GOVERNANCE.md).

## License

[MIT](LICENSE). © 2026 Rafael Melgaço and contributors.

Asterisk, used as a separate service at the telephony edge, is distributed by its authors under
GPLv2 and is not embedded in DeskVoice's code.

## Support and responsibilities

- **Questions and ideas:** [GitHub Discussions](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions).
- **Bugs:** [open an issue](https://github.com/DeskLabs-OpenSource/DeskVoice/issues).
- **Vulnerabilities:** private report, as described in [`SECURITY.md`](SECURITY.md). Never in a public issue.

What is yours, because this is a self-hosted installation:

- **The VPS and the data.** Firewall, system updates and off-machine backups are up to you.
- **The keys and the contracts.** The accounts with the AI provider and the carrier are yours,
  and so are the bills.
- **The use.** Recording, personal data and outbound calls have legal rules. The project
  delivers the controls and does not offer legal advice.

The software is provided as is, without warranty, under the terms of the MIT license.
