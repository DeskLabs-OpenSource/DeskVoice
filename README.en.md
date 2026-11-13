<div align="center">

[Português](README.md) · English · [Español](README.es.md)

<h1>
  <a href="https://deskvoice.com.br"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/deskvoice-logo-dark.svg">
    <img src="brand/deskvoice-logo-light.svg" alt="DeskVoice" height="76">
  </picture></a>
</h1>

**An open source phone system run by AI agents, installed on your own VPS.**

The agent answers the call, runs tools during the conversation, asks a human for approval when
it needs to, transfers the call, and leaves tasks running after the caller hangs up.

**[deskvoice.com.br](https://deskvoice.com.br)** (in Portuguese) · [Install](https://deskvoice.com.br/instalar) · [Guides](https://deskvoice.com.br/guias) · [Release notes](https://deskvoice.com.br/changelog)

[![Website](https://img.shields.io/badge/website-deskvoice.com.br-a2552f)](https://deskvoice.com.br)
[![CI](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml/badge.svg)](https://github.com/DeskLabs-OpenSource/DeskVoice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Self-hosted](https://img.shields.io/badge/self--hosted-your%20VPS-orange)](install/install.sh)

[Vision](VISION.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.en.md)

</div>

---

> **Project status: with published releases.** Installing, updating from the panel,
> backup, restore and the automatic rollback of a failed update have run on a real VPS, and a
> contributor has placed real calls with the OpenAI Realtime engine. What is proven, what is
> experimental and what is still a plan are kept apart in "What it does today". Nothing on the
> roadmap has a promised date.
>
> This page is a translation of [`README.md`](README.md). Most of the deeper documentation is
> written in Brazilian Portuguese. Translations are an open front in the roadmap.

## Install

> **Infrastructure partner: HostGator.** DeskVoice is free, with no paid version and no locked
> feature. What sustains the project is the partnership with HostGator, and the install kit was
> built with their VPS in mind: one command, a few questions, no variable to edit.
>
> **[Get the HostGator VPS through the partner link](https://www.hostgator.com.br/52708-141-3-52.html)**
>
> Using that link is how you support the project. Any other VPS with Docker works with the same
> command, with no difference in features.

### On your VPS

SSH into the server and run one line:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/get.sh | bash
```

It downloads DeskVoice into `~/DeskVoice` and opens the installer. Prefer to read before you run?
The same result, step by step:

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
| A VPS running Ubuntu 22.04 or newer (Debian 12+, AlmaLinux 9+ and Rocky Linux 9+ are also accepted. AlmaLinux 9 was installed on 12/11/2026 with the Docker service started by hand; the installer now starts it on its own, not yet run on a real machine. Rocky Linux 9 has not been proven) | The [HostGator VPS](https://www.hostgator.com.br/52708-141-3-52.html), the project's partner, is the recommended one. Any VPS with Docker works, with the same command. On memory, only what was measured: the install was proven on a VPS with 8 GB and 4 vCPU, and DeskVoice at rest uses about 380 MiB of memory and takes about 2.7 GB of disk (measured on 0.3.0, without WhatsApp). The smallest size the install fits in has not been measured yet. The published images are for x86_64 (amd64) processors; on ARM the install builds on the machine itself, with `--build` ([why](docs/decisions/0013-imagens-so-amd64.md)) |
| A domain pointing to the VPS | Optional for testing. Without a domain there is no HTTPS: the panel stays inside the VPS and you reach it through an SSH tunnel (the installer shows the command) |
| A SIP trunk with a number | From the telephony carrier of your choice. Authentication by registration or by IP |
| A voice AI key | Gemini (Google) or OpenAI. You pay the provider directly |

### Installing with an AI assistant

Using Claude Code, Codex, Cursor or another coding assistant? Paste this into it:

```text
Help me install DeskVoice: https://github.com/DeskLabs-OpenSource/DeskVoice
Read the repository's AGENTS.md and follow the deskvoice-instalar skill.
```

Its first question is whether you already have a server. If you do not, it tells you what machine
size is enough and shows the HostGator VPS link, the same one as in the block above, stating that
it is a partner link and that any other VPS with Docker works the same. Then it asks about the
VPS system, the ports, the domain, the SIP trunk and the AI key, and stays with you until the
first call. Passwords and keys do not go into the conversation: they are entered in the installer
or on screen.

Prefer a command to a conversation? On your own computer (macOS or Linux), before you have a
server:

```bash
curl -fsSL https://raw.githubusercontent.com/DeskLabs-OpenSource/DeskVoice/main/install/start.sh | bash
```

It only informs: what you need, the machine size, the partner link and the next command. It
installs nothing and collects nothing. Its output is in Brazilian Portuguese.

### See a call with no key and no trunk

The repository ships a simulated voice engine. It runs a whole call, with greeting, tool,
approval request, transfer and post-call task, without an AI key and without a carrier. On your
computer:

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install && pnpm demo   # needs Docker: starts a throwaway Postgres and removes it on exit
```

## What it does today

DeskVoice has published releases since 2026-11-11, and what changes in each one is in
[`CHANGELOG.md`](CHANGELOG.md) (in Portuguese). So nobody installs it expecting what has not been
proven yet, each capability below says how far the proof went:

- **Proven in simulation:** covered by an end-to-end test with the simulated engine, which walks
  through a whole call with no carrier and no key.
- **Proven on a real install:** it ran on a real VPS (the test ones, on 2026-11-11, or the
  partner's dedicated one, on 2026-11-12), in the way and as far as the row describes. Each proof,
  with its saved output, is in [`docs/fundacao/instalacao-real.md`](docs/fundacao/instalacao-real.md) (in Portuguese).
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
| Install on a VPS with the install kit | Proven on a real install, without a domain: Ubuntu 22.04 on two test VPSs and AlmaLinux 9 on the partner's VPS (there, before the installer started the Docker service on its own, with the service started by hand). Debian and Rocky Linux not yet proven |
| Panel and browser voice on the same address, Caddy's single entry point | Proven on a real install, without a domain |
| Talk to the agent by voice from the "Talk to the agent" screen | Proven on a real install with the OpenAI Realtime engine, by a test client that plays the browser's role with recorded speech. Not yet from a browser with a microphone |
| Panel with a domain and HTTPS | Awaiting real-world proof |
| Answer an inbound call from a carrier line (SIP trunk) | Awaiting real-world proof |
| Transfer the call to a person | Awaiting real-world proof (the Asterisk path was checked, without a carrier) |
| OpenAI Realtime voice engine | Proven on a real install, in the "Talk to the agent" conversation described above. A contributor placed real calls with it on their own install, and, with the cost fix ([#94](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/94)), DeskVoice's estimate matched the OpenAI invoice. The fix applies since 0.6.0 |
| Gemini Live voice engine | Awaiting real-world proof (tested against a fake server, without a key) |
| Send WhatsApp during the call, through a connector | Awaiting real-world proof |
| Connect a WhatsApp number by QR code (Settings → WhatsApp) and send the agent's notices and messages through it | The service does not come installed: you install it from the screen, and it costs about 323 MiB of memory with no number connected and 3.2 GB of disk (measured on 0.3.0, November 12, 2026). Routes tested with a real database and a fake WhatsApp service; installing and removing through the agent, with a simulated Docker. **Not yet proven with a real number:** no QR code was scanned and no message went out. It is an unofficial WhatsApp client; see the [guide](docs/guides/whatsapp-por-qr-code.md) (in Portuguese) |
| Connect the number to WhatsApp calls (Settings → WhatsApp, in the WhatsApp calls block), the first part of the capability | The service (WaCalls) does not come installed: you install it from the screen; memory and disk not measured yet. Routes tested with a real database and a fake WaCalls, through the real voice process; installing and removing through the agent, with a simulated Docker. **Not yet proven with a real number**, and no call is answered yet. Unofficial WhatsApp client; see the [guide](docs/guides/ligacao-pelo-whatsapp.md) (in Portuguese) |
| Call a webhook during the call | Awaiting real-world proof (without a real receiver) |
| Update, health check, backup and restore | Proven on a real install, on the partner's VPS: installer run twice without regenerating secrets, backup checked, a restore that brings back the backup's row counts, and the automatic rollback of a failed update. Restoring on another server, or across versions with a new migration, not yet proven |
| Update from the panel (Settings → System), through a kit agent on the server | Proven on a real install: twice on the partner's VPS (0.3.0 → 0.4.0 and 0.4.0 → 0.5.0), with nobody at the server's terminal, including the hand-off to the new version's updater and the removal of old images |
| Record the call audio, off by default and turned on from the panel (Settings → Privacy → Call recording) | Tested against a real database and on a browser call, in an end-to-end test. Not yet proven on a real install. Since 0.6.0 |
| Transcript retention period and export of what the organization keeps about a phone number (Settings) | Tested against a real database and checked on screen, on a panel against a throwaway database. Not yet proven on a real install. Since 0.6.0 |
| Calls placed by the agent | Awaiting real-world proof, and off by default. See "Outbound calls" |

If you answer a call through a carrier line, tell us how it went in an issue: inbound calls over
a SIP trunk have no public record yet, and that is the most valuable contribution right now.

What does **not** exist yet: several
companies on one screen, a visual flow builder, answering calls over WhatsApp, voice IVR, call queues.
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

## Contacts the install makes on its own

DeskVoice has no telemetry: no usage, call or install data goes to the project. These are all
the outside contacts the install makes without you asking:

| Who | With whom | When | What it sends |
|---|---|---|---|
| Panel | GitHub's public releases API (`api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases`) | When someone opens Settings → System or confirms an update. The answer is kept for 10 minutes (1 minute if the lookup failed) | A read request with no credential and no body, with two fixed headers, the same on every install: `accept: application/vnd.github+json` and `user-agent: deskvoice-panel`. No version, address or identifier of the install |
| Update agent | The repository on GitHub, through `git fetch --tags` | The agent runs every minute and looks up versions at most every 10 minutes, when the install is on a published version and came from a clone of the repository | git's request to fetch the tags, with no credential. git identifies itself with its own version (`git/2.x`); nothing about the install goes along |
| Caddy, only with a domain | The certificate authority Caddy uses (Let's Encrypt, by default) | On install and then, on its own, to renew the certificate before it expires | The domain, to prove it points to the VPS. DeskVoice sets no e-mail in that request |

When you ask for it, the install also talks to the outside:

- **Installing and updating** (from the terminal or the screen) downloads the code from GitHub and
  the images: DeskVoice's on `ghcr.io` (panel, voice and routines) and third-party ones on Docker
  Hub (Postgres, Caddy, Asterisk). Docker identifies itself as in any image download (its version,
  the kernel's and the architecture); DeskVoice adds nothing.
- **Installing without giving the IP** (`DESKVOICE_PUBLIC_IP`): the installer finds the VPS public
  IP by asking `api.ipify.org`, `ifconfig.me` and `icanhazip.com`, one at a time, until one
  answers. The request carries nothing; the service sees the VPS IP, which is the answer.
  `install/diagnose.sh` makes the same lookup.
- **Installing without Docker:** after asking, the installer downloads the official script from
  `get.docker.com`.
- **Installing WhatsApp from the screen:** the agent downloads the WAHA image from Docker Hub, and
  tries again every 10 minutes if the download fails.
- **Building on the machine itself** (`--build`): downloads the Node base from Docker Hub, pnpm and
  the packages from the npm registry.

In use, DeskVoice talks to what you configured: the voice AI provider (Google or OpenAI) during
calls, with your key; the SIP trunk carrier; WhatsApp, through WAHA, if you connected it; and the
addresses of the tools and webhooks you registered. With the call outcome turned on (Settings →
Artificial intelligence, off by default), the routines process also sends the text transcript to
the same provider, after the call, through its text API (`/chat/completions` on OpenAI,
`:generateContent` on Google).

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
and is built in public, with the community. There are already outside contributions: the fences
and security work from [webtecnica](https://github.com/webtecnica) are in the published releases. On `main`, shipping in
the next release, are the rights of callers (retention period and export), also from webtecnica,
and the OpenAI cost checked against the invoice, the farewell before hanging up and call
recording, from [aliffstefano](https://github.com/aliffstefano). DeskcommCRM, where the contribution workflow used
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
