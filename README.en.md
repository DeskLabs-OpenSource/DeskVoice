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
| A VPS running Ubuntu 22.04 or newer (Debian 12+, AlmaLinux 9+ and Rocky Linux 9+ are also accepted; what was proven on each one is in [`install/README.md`](install/README.md#sistemas-aceitos), in Portuguese) | The [HostGator VPS](https://www.hostgator.com.br/52708-141-3-52.html), the project's partner, is the recommended one. Any VPS with Docker works, with the same command. On memory, only what was measured: the install was proven on a VPS with 8 GB and 4 vCPU, and DeskVoice at rest uses about 380 MiB of memory and takes about 2.7 GB of disk (measured on 0.3.0, without WhatsApp). The smallest size the install fits in has not been measured yet. The published images are for x86_64 (amd64) processors and, starting with 0.12.0, also for 64-bit ARM (arm64), with the same command; there is no proof on a real ARM machine yet ([why](docs/decisions/0017-imagens-para-amd64-e-arm64.md)). On ARM, the installer checks whether the version has the image: if it does not, it stops and says so, and the install builds on the machine itself, with `--build` |
| A domain pointing to the VPS | Optional for testing. Without a domain there is no HTTPS: the panel stays inside the VPS and you reach it through an SSH tunnel (the installer shows the command) |
| A SIP trunk with a number | From the telephony carrier of your choice. Authentication by registration or by IP; by IP, with one or more numeric addresses or blocks from the carrier, up to /16 on IPv4 and /32 on IPv6 |
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
| Per-call timeline, event by event, with cost. Since 0.45.0, on the OpenAI Realtime and Gemini Live engines, the timeline ends with how long the agent took to answer: the wait in half of the turns, the slowest one and how many turns were counted, counting from the end-of-speech notice the provider sends (on Gemini Live, the transcript, which arrives a little after the real end) to the agent's first sound. Turns with a tool, the turn where DeskVoice acted because the agent stayed silent and the system's own lines are left out; the line counts only the turns where DeskVoice acted. It stays in the install's database, with nothing sent out | Proven in simulation. Per-turn latency, since 0.45.0, was checked with a test engine and a fake server; not yet on a real call, how far the provider's end-of-speech notice is from the real end was not measured on either engine, and the stretch between DeskVoice and the caller's ear (network, Asterisk) is not counted |
| On each call's screen, the earlier calls from the same number (date, agent, outcome and link) and its open follow-ups; the transfer notice and the `notify_human` notice say how many times the number has called. None of this reaches the call's agent, except, since 0.21.0, the titles of the open follow-ups, when the caller's memory switch is on (row below the notes) | Tested with a real database, including isolation between companies and that the agent's instructions do not change; the screen test runs in CI, but the screen was not seen in a real browser. Performance with many calls from the same number was not measured, and the same number stored another way (with and without the ninth digit) counts as a different one; what the phone line delivers was not checked. Since 0.14.0 |
| Agent notes about the caller (the `remember_caller_note` tool), which the team sees in the "This number" block on the call screen; off by default and turned on from the agent screen. Up to 10 notes per call, kept for 90 days, adjustable from 30 to 365 in Settings, and included in the export and in the erasure at the caller's request. Since 0.21.0, the agent can receive them on the next call, with the switch described in the row below. Since 0.16.0, each note has a "Delete" button on the call screen, and the owner or an admin can "Forget this number" in Settings → Privacy: the number's notes and closed follow-ups go; the calls, the speech and the open follow-ups stay | Tested with a real database, including isolation between companies, the 10-note ceiling, the retention period and erasure; the screen test passed in CI. How the real model uses the tool, and whether it avoids noting sensitive data, was not checked. Delete and "Forget" were tested with a real database and by a screen test in CI; the race with a live call from the same number was not measured. Since 0.15.0 |
| The caller's memory on the call: with the "Give the agent the caller's memory" switch on (Settings, Privacy panel), the agent starts each call, inbound or placed by the system, with the notes kept about the number (up to 10) and the titles of its open follow-ups (up to 5), in a block of up to 1,500 characters, received as data and not as instructions. The summary and the turns of earlier calls never go in, and the timeline shows only how many notes and follow-ups went in. The switch comes off, only the owner or an admin changes it, and the screen warns that the number shown may be spoofed | Tested against a real database, including isolation between companies, the retention period, erasure and the switch off in both directions; the switch was seen in a browser, on a local panel. Still no real call with the switch on, no measurement of the token cost at a provider and no proof that the model does not repeat the notes to someone who insists. Since 0.21.0 |
| Work that continues after the call (summary, notices, follow-up tasks) | Proven in simulation |
| Cost and duration ceiling per call. Since 0.47.0, when the caller stays silent after the agent speaks, after 10 seconds the agent asks whether the caller is still there, reminds once more 10 seconds later and, 8 seconds after that, says goodbye and ends the call; any sound from the caller resets the count, and it does not run while the agent speaks, while a tool is in progress or during a transfer. It applies to phone, WhatsApp and browser calls, and not to the keypad menu or the voicemail; the end reason says the caller stayed silent, and this ending does not open a follow-up on its own. The deadlines are not configurable. **Already installed: the guard comes on for every agent, new and existing.** To keep the old behaviour, turn off "End the call when the caller goes silent" on the agent screen, under Limits per call | Proven in simulation. Ending on silence, since 0.47.0, was tested with the manual engine; no deadline was measured with people, still no call with a real engine, and it was not checked whether the engine says the reminders, which are sent in Portuguese, in the language of an agent set to another language |
| Per-call ceiling on the tools that record or notify: 5 follow-ups, 5 bookings, 5 webhook calls, 3 team notices and 3 approval requests; above it, the tool does not run and the agent says the request was not recorded | Tested with a real database, including parallel calls, which do not go over the ceiling. Not yet with a real carrier call. Since 0.13.0 |
| Web panel in Portuguese, English and Spanish | Routes tested against a real database; screens checked in Portuguese |
| Install on a VPS with the install kit | Proven on a real install, without a domain: Ubuntu 22.04 on two test VPSs and AlmaLinux 9 on the partner's VPS (there, before the installer started the Docker service on its own, with the service started by hand). Debian and Rocky Linux not yet proven |
| Panel and browser voice on the same address, Caddy's single entry point | Proven on a real install, without a domain |
| Talk to the agent by voice from the "Talk to the agent" screen | Proven on a real install with the OpenAI Realtime engine, by a test client that plays the browser's role with recorded speech. Not yet from a browser with a microphone |
| Panel with a domain and HTTPS | Awaiting real-world proof |
| Answer an inbound call from a carrier line (SIP trunk) | Awaiting real-world proof |
| Inbound filter per line: each line only accepts calls from the addresses the screen shows in "Accepts calls from". On an IP line, the server and the extra addresses, and it always filters; on a registration line, the server's IP or the addresses its name returned in the last 24 hours (up to 16), plus the extras, recalculated every 5 minutes. On a registration line the filter is turned on and off on the screen; one that already existed before 0.29.0 keeps accepting from any address until someone turns the filter on, and one added later is born filtered. While the name of a registration line has never resolved, its filter stays off, and the screen says so. Port 5060 stays published as before. Since 0.41.0, on an install with more than one organization, saving a line whose address overlaps the range of a line of another organization, which takes IP lines offline, asks for confirmation before saving; the warning does not say which line, of which organization or at which address, and changing only the name never asks | Tested against a real database and with name resolution simulated; in the screen test, a SIP probe that presents itself as the line from another address is accepted with the filter off and refused with it on. Measured on a test install on 2026-11-17 with the same probe (OPTIONS): the registration line that already existed was left without a filter by the update, and turning the filter on and off on the screen refused and then accepted again. Still no real call (INVITE with audio) nor real carrier, and the screen text was not seen in a browser. The range warning was tested against a real database and in the CI screen test, with the server's response simulated; still no proof on a real install with more than one organization. The list on the screen since 0.20.0; the filter since 0.29.0; the range warning since 0.41.0 |
| Transfer the call to a person. Since 0.46.0, when nobody answers (45 seconds ringing, busy or unavailable), the phone call goes back to the same agent, which says nobody could answer and offers to take a message or log a callback request, without transferring again; while it rings, the voice engine stays closed and does not charge. **Already installed: the return comes on for every agent, new and existing.** To keep the old behaviour, turn off "If nobody answers the transfer, go back to the agent" on the agent screen | Awaiting real-world proof (the Asterisk path was checked, without a carrier). The return, since 0.46.0, was tested against a real database and a fake ARI; not yet with the real Asterisk together with the voice process, with a real engine on the return leg, or with a carrier. Since 0.9.0, a transfer nobody answers shows as unanswered and creates a panel notice asking for a callback, tested against a real database and simulated telephony |
| Follow-up opened on its own when the call ends with no next step: the voice engine dropped or was not ready, the transfer failed and nobody was notified, the caller hung up waiting for an approval, or the WhatsApp message did not go out and nobody opened a follow-up. A review by fixed rules after each call, with no artificial intelligence, no spending and without reading what was said; at most one per call, never for the simulated call nor for the call with no number, and with no switch | Tested against a real database, including reviews in parallel (only one remains), isolation between companies and erasure at the caller's request. Still no call through a real carrier, and the follow-up was not seen on the Follow-ups screen in a browser. Since 0.19.0 |
| Follow-up or message when the call drops mid-conversation: on the agent screen, "When the call drops" chooses between "Do nothing" (the default, and the setting of every agent that already existed), "Open a follow-up for someone to call back" and, since 0.27.0, "Send a WhatsApp message to the caller". It counts as a drop when an inbound, answered call is one in which the system failed, in which the caller was left without an answer beyond the silence guard's deadline and hung up (including someone who heard the agent ask them to repeat and hung up without speaking again), or in which the line dropped during an agent action; it does not count when the caller says goodbye and hangs up, when they hang up while the agent is speaking, for the call with no number, nor for the one in which someone already took the next step (transfer, message taken, follow-up, notice or WhatsApp sent). One follow-up per call, for the owner of the agent's follow-ups, and the timeline says what happened; on a simulated call, it says what would have happened and nothing is opened. The message is a fixed text written by whoever configures it, of up to 300 characters, with nothing from the conversation, and it only works with WhatsApp connected and "Trust the number shown on the call" on; the screen warns that it writes first to a number that may never have spoken to the business line, which can lead to the number being restricted or blocked. A number on the do-not-call list does not receive it; each number receives at most one every 24 hours, and the organization at most 3 per hour and 20 every 24 hours; above that, or if the message does not go out, a follow-up is opened. Since 0.39.0, there is a fourth option, "Call back": the system schedules a single call-back 30 minutes after the drop, through the same check as every outbound call (policy on, hours, ceiling, attempts and do-not-call list), without pushing it to the next window if it falls outside hours, with at most one call-back per number every 24 hours; when it does not go out or nobody answers, it opens the follow-up, except for a number on the do-not-call list. It can only be chosen with outbound calls on | Tested against a real database and with the simulated engine, including the request to repeat followed by hanging up and the call recorded before the change. Still no call with a real voice engine nor through a carrier, no measurement of how often this happens, and the screen was not opened in a browser; the message option was only seen by the automated screen test, and the message has not yet gone out to a real number. The call-back was tested against a real database, including two drops at the same time for the same number, and has not yet dialed a real number. Since 0.26.0 (the message, since 0.27.0; call back, since 0.39.0) |
| Hand the call off from one agent to another mid-conversation: on the agent screen, "Can hand the call off to" checks the destinations (it comes empty), and the timeline shows the handoff, with the reason and the summary. At most 3 handoffs per call; handing off does not reset the time or the cost, and the shortest duration and the lowest ceiling among the agents the call went through apply | Proven in simulation, including the second agent's ceiling and someone hanging up in the middle of the switch; the list on the agent screen and the API tested against a real database and by a screen test in CI; the card on the timeline, only by a component test, without a browser. On a real install, on 2026-11-16, a handoff was made with the OpenAI Realtime engine, in a browser call driven by a script, with synthetic speech, without a carrier and without going through the panel ([record](docs/fundacao/instalacao-real.md#primeira-passagem-entre-agentes-com-motor-de-voz-real-na-vps-da-parceira-2026-11-16), in Portuguese). On the first attempt, the agent wrote the destination with the label and the handoff was refused; 0.19.2 accepts that way of writing it, and with it the same proof passed on the first attempt ([record](docs/fundacao/instalacao-real.md#a-mesma-passagem-refeita-com-a-0192-2026-11-16), in Portuguese). Each agent's costs in the ledger added up to the call's total, but were not checked on the screen. Still no call through a real carrier nor with a person's speech. If the provider refuses the next agent's session, the current agent stays on the line (proven in simulation). Since 0.17.0. Since 0.18.0, the cost of each leg appears with the agent the call was on, in Costs (in the "By agent" panel, and each engine's minutes per leg in the "By voice engine" panel) and on the call screen, when it went through more than one agent; the leg of an agent that was deleted goes back to whoever answered. The cost per agent was tested against a real database, without changing the total; the screens were not checked in a browser |
| Voicemail: a call through the phone line to a number with no agent, or with the agent turned off, is answered with a recorded notice and a beep, and the message stays on the call itself; off by default, turned on in Settings → Calls, and it only works with recording on. Calls through WhatsApp still have no voicemail | Tested with a real database and with a test transport that takes the time to play the notice. Not yet with a real carrier call, and the screens were not checked in a browser. Since 0.12.0 |
| OpenAI Realtime voice engine | Proven on a real install, in the "Talk to the agent" conversation described above. A contributor placed real calls with it on their own install, and, with the cost fix ([#94](https://github.com/DeskLabs-OpenSource/DeskVoice/pull/94)), DeskVoice's estimate matched the OpenAI invoice. The fix applies since 0.6.0 |
| Gemini Live voice engine | Awaiting real-world proof (tested against a fake server, without a key) |
| Pipeline voice engine (speech becomes text, a brain answers and a voice speaks, each piece chosen separately), since 0.50.0 with its first real real-time transcription: OpenAI's (`gpt-4o-mini-transcribe`, a provisional piece), which uses the OpenAI Realtime engine key and only works after the confirmation of where the audio goes, in the "Pipeline" block of the agent screen. Since 0.51.0, the Pipeline and its pieces are chosen and saved on the agent screen. The Voice engine field offers the Pipeline when the organization has the three pieces ready: the transcription with its key and the audio consent confirmed, a brain that chats with an accepted key, and a voice with its key and consent confirmed. If one is missing, it shows "Pipeline (off)" and says which one and where to fix it. In the block, you choose the transcription, the brain and the model (only those that chat and have a known price), and pick a voice from your ElevenLabs account with "Use … in the Pipeline", next to the Listen button, which plays ElevenLabs' own sample without spending credit. Saving stores the choice on the agent; going back to another engine clears it. No agent changes on its own. The screen says that the OpenAI transcription is provisional: the final one comes with the transcription measurement. The block also shows the response time, which stays at "Not measured yet" while no call goes through the pipeline. Since 0.52.0, while the voice is still generating the agent's reply, a stretch from the caller that only has agreement words ("uh-huh", "yes", "okay", in the list for the agent's language: Portuguese, English or Spanish) does not cut the reply; it goes into the transcript and reaches the brain on the next request. One word outside the list, such as "no" or "wait", cuts as before, and a language without a list cuts on everything | Proven in simulation: a full call through the simulated pipeline on every change. The OpenAI transcription was tested with a fake server in place of OpenAI, and the confirmation against a real database. No real call has gone through the pipeline, and no real OpenAI or ElevenLabs key has been tested with it. The CI screen test checks the Listen warning when the sample does not play and that, without the pieces ready, saving the agent does not carry Pipeline. Choosing on the screen, since 0.51.0, was tested by component tests and by the CI screen test: choosing and saving, the missing voice, the refusal from the real server with the piece's sentence, and going back to another engine. An accepted save with all five pieces was not seen on the screen (the CI has neither the prices nor the consents; acceptance through the API is tested against a real database), and no call has gone through a Pipeline chosen on the screen. Agreement, since 0.52.0, was tested with simulated transcription (the "uh-huh" that does not cut, the "yes, but" and the "no" that do, the list per language). It was not measured how many real agreements still cut nor how many interruptions the list swallows, and the English and Spanish lists have not been reviewed by native speakers. The end of the speech is outside the rule: after the voice finishes generating the reply, the audio still plays to the caller, and an "uh-huh" said then becomes a turn, and the agent answers it. How long that end lasts was not measured |
| Send WhatsApp during the call, through a connector | Awaiting real-world proof |
| Connect a WhatsApp number by QR code (Settings → WhatsApp) and send the agent's notices and messages through it | The service does not come installed: you install it from the screen, and it costs about 323 MiB of memory with no number connected and 3.2 GB of disk (measured on 0.3.0, November 12, 2026). Routes tested with a real database and a fake WhatsApp service; installing and removing through the agent, with a simulated Docker. **Not yet proven with a real number:** no QR code was scanned and no message went out. It is an unofficial WhatsApp client; see the [guide](docs/guides/whatsapp-por-qr-code.md) (in Portuguese) |
| Have the agent answer calls made to the number on WhatsApp (Phone line, in the WhatsApp calls block: connect the number and pick the agent) | The service (WaCalls) does not come installed: you install it from the screen; memory and disk not measured yet. **Proven with a real number** in four incoming calls on 12 and 13/11/2026 (the longest lasting 2 min 7 s), with audio both ways and transcription, and no transfer to a human on this channel. The agent answers 0.6 to 2.4 s after the caller stops talking (nine answers measured on the recordings of two calls on 13/11; before the fix that fills in the silence WhatsApp does not send, it was 4 to 5 s). When WhatsApp hides the number (`@lid`, now the common case), the phone number the call itself reports is used, unconfirmed by WhatsApp, passed on by the WaCalls image the kit uses (a fork with the fix, until the authors publish it). **Proven on a real call with a hidden number** on 13/11/2026: the number reached the call timeline with nothing written to the WaCalls store. Unofficial WhatsApp client; see the [guide](docs/guides/ligacao-pelo-whatsapp.md) (in Portuguese) |
| Call outcome (booked, callback requested, message taken, not interested, info only), classified by the engine after the call; off by default, turned on in Settings → Outcome, analysis and transcription | Tested against a real database and a simulated provider response, with the cost counted against the spending cap and failures on the timeline. Not yet proven on a real install or against a real OpenAI or Gemini. Since 0.8.0 |
| End-of-call analysis, in the same paid request as the outcome: the score, which is always the sum of a five-criterion rubric with the line of speech behind each one when it appears in the conversation, the caller's temperature, objections with the agent's answer, and the next step; off by default, turned on in Settings → Outcome, analysis and transcription, and the score shows in the call list | Tested against a real database and simulated provider responses: cost counted once in the ledger and under the ceiling, the reason on the timeline when the analysis is not done, no speech text left after erasure at the caller's request. The screen was checked on a panel against a throwaway database, with analyses written straight to the database. Not yet proven on a real install or against a real OpenAI or Gemini. Since 0.11.0 |
| Outcome and analysis on an OpenAI-compatible provider (DeepSeek, Qwen, OpenRouter, Groq), with its own endpoint, model and key in Settings → Artificial intelligence; the provider must accept `json_schema` responses; if nothing is set, nothing changes. The cost on the configured provider is not estimated: it shows as zero and does not count toward the agent's ceiling | Tested against a real database and simulated provider responses, including refusal of internal addresses and of an endpoint without its own key. Not yet proven against a real compatible provider. Since 0.11.0 |
| Brains (Settings → Brains): whoever configures pastes the Anthropic, OpenAI, Gemini, DeepSeek or OpenRouter key and sees the test result and the list of text models the key reaches, with the input and output price per million tokens, with source and date, or "no known price". The key is stored encrypted, does not come back to the screen and is separate from the voice engine key. Since 0.23.0, a brain can read the call (row below) | Tested against a real database and with simulated provider responses, including the refused key, the key change and the read limit. Still no real provider key, and the screen was not opened in a browser. Since 0.22.0 |
| Call outcome and analysis read by a chosen brain: with the key saved in Brains, the `calls.analysis_brain` setting chooses the brain and the model, and the outcome and the analysis start coming from it, ahead of the voice engine and the compatible provider. Since 0.24.0, the choice has a screen: in Settings, in the analysis section, "Who reads the call" chooses the brain and a model from its list, searchable by name. The ledger gains the billed model; a model with no known price only goes in with confirmation, only reads calls from agents with a cost ceiling and is marked in the ledger as unmeasured cost. Since 0.24.0, Costs and the call screen show "Not measured" instead of a zero cost, and the screen warns before saving a model with no price; since 0.25.0, the Calls list and the end of the test call too. If the brain is left without a key or the model leaves the list, the call is not read and the timeline says why. Since 0.39.0, each agent can have its own choice, in the "This agent's brains" block: same as the organization (the default), the agent's voice engine, or a brain and a model from the list; the agent's choice stands on its own, without falling back to the organization's, and the ledger shows the agent's model and cost. With no choice, nothing changes | Tested against a real database and with simulated provider responses, including the unmeasured cost and the brain that disappears. Still no real call to any provider, and the 0.24.0 and 0.25.0 screens were not opened in a browser. The per-agent choice was tested against a real database, including the model that leaves the list and the cost against the agent's ceiling, and the screen was not opened in a browser. Since 0.23.0 (the screen, since 0.24.0; per agent, since 0.39.0) |
| Speech filter (Settings → Speech filter), off by default: Jev, from TypeSafe, reads the call's text and marks on the timeline what may be background speech and the likely reading of a vocabulary term, without changing the speech, which stays as it was heard. Only the owner or an admin saves the key and turns it on; turning it on asks for the confirmation "The call's text goes to TypeSafe.", after a notice that says only what TypeSafe's policy says: it keeps the text for as long as reasonably necessary to provide the service or for its business purposes, with no defined period; on request, it deletes it or keeps it without identifying the person when it is no longer reasonably necessary, unless legally required; hosting in the United States, and each confirmation leaves a receipt in the Record on the Privacy screen. The cost of a request that is late, has no network or gets a response out of shape is estimated and marked as an estimate, and a request refused by TypeSafe with an error has no cost; the guide `docs/guides/filtro-de-fala.md` (in Portuguese) says how to ask TypeSafe for deletion | Tested against a real database and with a fake server in place of TypeSafe, including the receipt that stays after turning it off. No real Jev key was tested, the screen was not opened in a browser and nobody confirmed that TypeSafe's contact handles deletion requests. Since 0.31.0 |
| Live analysts (Settings → Analysts), turned on agent by agent in the "Analyst" field (it comes set to "None"): the analyst reads the call with a decision model, measures the caller's temperature (1 to 5, a badge on the call detail), recognizes registered objections and hands the agent the written guidance for each one, without it becoming speech. With Jev, the same notice and the same confirmation as the speech filter apply. With the Gemini Live engine, the analyst measures but does not guide, and the screen warns. In Costs, the analyst's requests have their own row | Tested against a real database, with the simulated engine and with the timeline render; the guidance goes in through the simulated engine and, on OpenAI Realtime, was only tested against a fake server, with no measurement on a real call. The screen was not opened in a browser, and no analyst has read a real call. Since 0.31.0 |
| Caller environment, normal or noisy, on the agent screen: in Noisy the agent is less sensitive to noise before it starts listening. On OpenAI Realtime and Gemini Live; when an agent switches to another engine, the screen warns and offers to go back to Normal | A Noisy session was accepted by OpenAI Realtime on a real install, without a call. Gemini Live accepted a Noisy session, alone and together with the vocabulary, without a call and without input audio. The screen was checked on a panel against a throwaway database. The effect on speech recognition has not been measured. Since 0.11.0 |
| "Names and terms" on the agent screen: names of people, of the company, of products and terms callers often say, one per line, up to 50 terms of up to 60 characters. The list goes to the voice provider as a hint to recognize those words, and the provider may not follow the hint; the error appears next to the field, without saving. Whoever does not fill it in sees no difference | Tested against a real database, in the screen render and in the CI screen test. On a test install, on 2026-11-17, Gemini Live accepted the session with a short list; the full list (50 terms of 60 characters) was proven neither on Gemini nor on OpenAI Realtime, and if a provider refuses it the agent's session with terms does not open. Whether recognition improves was not measured. Since 0.33.0 |
| Agent tests, since 0.48.0 (since 0.52.0, in the Tests tab of each agent's screen, which now has five tabs: Agent, Tools, After the call, Tests and Advanced; the old tests address opens that tab): whoever can edit the agent writes a conversation in a form, without JSON (what the caller says on each turn, the tools the agent must call and the fields checked, the reply each one returns in the test and the passages the agent's speech must or must not contain) and runs one test or all of them, one at a time; the screen shows "passed" or "failed" and the conversation turn by turn, with the expected next to what came back. The test checks what the agent decides, in text, not how it hears and speaks, and no tool actually runs. A run uses the agent's engine with the organization's key, only through the button and never on its own, and the cost goes into the ledger, the monthly ceiling and a "Tests" row on the Costs screen. It runs on OpenAI Realtime; on Gemini Live, for now, the button comes disabled, with the reason. Whoever can only view the agent sees the tests and the results, but cannot create or run them. Apart from the tab, an existing install sees no change until someone creates a test | Tested against a real database and with fake OpenAI and Gemini servers: the full run, the refusals without spending (monthly ceiling, engine that does not run tests, missing key, another test running), the run's cost ceiling and that the test builds the same session as the call, in text. The screen was opened in an automated browser by a two-case probe, without a real engine. Still no run against the real OpenAI: it is not known whether the registered model accepts replying in text only, nor how much a test costs (the estimate, not measured, is US$ 0.02 to US$ 0.08) |
| ElevenLabs voice (Settings → Voice): stores the ElevenLabs key encrypted, tests the key without spending a character and shows the voices the account already has, with language and sample. Saving the key asks for confirmation that the text the agent speaks on the call goes to ElevenLabs and may repeat what the person said, such as name, address and phone number; the notice says what ElevenLabs' pages say (history until deleted, plus 30 days in backup, logs that may be kept with no stated period, no retention only on the Enterprise plan, data stored in the United States, where it is processed not stated), and who confirmed stays in the Record on the Privacy screen. The agent does not speak with this voice yet: choosing the voice on the agent comes later | Tested against a real database and with a fake server in place of ElevenLabs, including the receipt that stays after deleting the key. No real key was tested, the screen was not opened in a browser, and ElevenLabs' Terms of Service and data agreement were not read. Since 0.34.0 |
| End-of-call notice on the operator's WhatsApp, with a fixed text (no speech or phone number of the caller); off by default, turned on in Settings → WhatsApp | Tested against a real database and a fake WhatsApp. Not yet proven with a real number. Since 0.8.0 |
| Call a webhook during the call. Since 0.42.0, when the integration does not answer within the deadline, the agent does not treat it as an error: it hears that nobody knows whether the request was recorded and that it must not repeat it without confirming with the person, and it says it will check; the timeline shows "não respondeu a tempo". Since 0.44.0, that promise depends on the agent's tools: with "Open a follow-up", it opens a follow-up for the team to check and says the team will get back; without it, with "Notify the team", it notifies the team; with neither, it says it could not confirm right now and that the person can call back later, without promising a callback. HTTP errors and network failures behave as before. Every call carries an `Idempotency-Key` header, the same for the same call, integration and data; avoiding a duplicate request depends on the other system honouring that header. Since 0.44.0, each allowed webhook has its own response deadline, from 1 to 30 seconds, in Settings › Integrations; the default is still 10 seconds, and the list already saved keeps 10 without anyone touching it. The deadline applies during the call and to deliveries after it. Also since 0.44.0, each webhook can receive the report of each call (`call.report` event), off by default: after the call, a `POST` with the call, the agent, the direction, start, end, duration, end reason, outcome, summary and analysis; no token, no key and not the caller's phone number. Each delivery carries `Idempotency-Key`, goes out once per call and per webhook, has three attempts and shows on the timeline as delivered or not delivered | Awaiting real-world proof (without a real receiver). The deadline case and the header, since 0.42.0, were tested against a real database and a fake server; how the model reacts to "unknown" on a real call, and how many receivers honour the header, are not measured yet. The per-webhook deadline, since 0.44.0, was tested with a fake server and in the CI screen test; the screen was not opened in a browser, and which deadline suits each real integration was not measured. The tool-dependent promise and the report were tested against a real database and a fake server, with the routines chained; not yet with a real receiver (CRM) or a real call, and the report checkbox was not opened in a browser |
| Press the keys of an automated menu (IVR) during the call, with the `send_dtmf` tool | Measured on a local Asterisk with the install's image and dialplan, against another Asterisk playing the IVR: a menu that detects tones in the audio read the keys; one that only accepts keys over RFC 4733 did not. Not yet proven against a carrier's IVR |
| Answer through a keypad menu: in Phone line, each number can switch "Answered by: AI (the agent)" to "Keypad menu". The menu has one level; the caller hears a recorded announcement (WAV, MP3 or M4A, up to 60 seconds, converted in the browser) and presses a key that leads to an AI agent, to a person or hangs up. Every menu has at least one key for a person, and that is where the call goes when nobody chooses (or the menu warns and hangs up, if whoever configures prefers) and when something fails. The timeline shows the option chosen, never the sequence typed. Every number stays answered by the AI until someone changes it, and the WhatsApp call does not go through the menu. Built from webtecnica's work | Tested against a real database and in unit tests, including each failure path going to the person, the announcement kept out of the recordings purge and the WhatsApp number kept out of the menu. Still no proof on a real call, through a carrier line, with the menu turned on from the panel, and the announcement conversion was not checked in different browsers. Since 0.38.0 |
| Update, health check, backup and restore | Proven on a real install, on the partner's VPS: installer run twice without regenerating secrets, backup checked, a restore that brings back the backup's row counts, and the automatic rollback of a failed update. Restoring on another server, or across versions with a new migration, not yet proven. Since 0.36.0, the health check also asks the panel login with a credential that does not exist and treats a server error as a failure of an essential part, which makes the update roll back: tested in the installer kit, not yet proven on a real install. Since 0.37.0, the "Rede do proxy" line (the output is in Portuguese) warns when this machine has another system's proxy network (the `*_caddy-sites` of a CRM on the same VPS) and it is not recorded, with the command to record it, and also when the recorded network no longer exists; it is only a warning, it does not change the exit code: tested in the installer kit, not yet proven on a real install |
| Close to the outside a port that Docker publishes, with a rule made to come back after a restart: `install/docker-user.sh apply 5061/tcp` (or the `DESKVOICE_DOCKER_USER_DROP` variable in the installer) writes the rule in the `DOCKER-USER` chain, which neither `ufw` nor `firewalld` reach, and leaves a systemd service made to put it back at boot and at each Docker restart. Nothing is closed without being asked for, and closing `5060/udp` leaves the telephony silent. Applying the rule loads the `br_netfilter` module until the reboot (see `docs/fundacao/ufw-e-docker.md`, in Portuguese) | Measured on a test VPS on 2026-11-18: from outside, the probe ports stopped answering on TCP and UDP; the connection the container opens to the outside and the conversation between containers on the same network kept going through, on TCP; applying it again did not duplicate the rule. The machine restart and the Docker restart with the service on (the rule coming back), outbound UDP and UDP between containers, IPv6 and an active firewalld still without proof. Since 0.36.0 |
| Update from the panel (Administer the installation → Update), through a kit agent on the server. Since 0.28.0, whoever administers the installation is the one who asks (on an installation with one organization, the owner and the admin); `install/grant-installation-admin.sh` gives that role back to an account, from inside the server. The update screen is in the installation area, with one organization or with several (row below); `/settings/system` leads to it | Proven on a real install: twice on the partner's VPS (0.3.0 → 0.4.0 and 0.4.0 → 0.5.0), with nobody at the server's terminal, including the hand-off to the new version's updater and the removal of old images. Who can ask, since 0.28.0, is tested against a real database, and `grant-installation-admin.sh` ran on a test installation on 2026-11-17; the screen was not checked in a browser nor on an installation with several organizations, and no update from the panel has run on a real install since 0.28.0 |
| Installation area, for whoever looks after several clients on a single server: whoever administers the installation gets "Administer the installation" in the account block, with four screens. In Organizations, they list, create and rename organizations, and each new organization generates the first owner's invitation, which keeps who generated it and is only valid while that account administers the installation. In Overview, since 0.37.0, they see one row per organization: whether it is active or suspended, the calls of the last 30 days, the month's cost (with the "includes estimate" and "Not measured" marks, as in Costs), the connected and dropped lines, the state of the engine key and the queue (tasks overdue and failed in the last 24 hours), each number equal to the one on the organization's own screen. In Administration, they add or remove who administers the installation, and the last person never leaves. In Audit stays what was done there, including each update request. Whoever has a single client sees nothing new in the main navigation. Creating the second organization fixes the list of who administers the installation, with no way back, and the screen shows beforehand who goes in and who goes out; from then on, the update leaves Settings and moves to the installation area. The owner of a client organization does not get the area. Since 0.35.0, whoever administers the installation suspends and reactivates an organization in Organizations, with a reason and a confirmation that names the organization; the suspended one does not answer, does not call and has its tasks that act on behalf of the organization or spend money canceled (notices, webhooks, transcriptions, summaries and analyses), while retention, the erasure of callers' data and the expiry of approvals go on; what was canceled does not come back on reactivation, and everything stays in the audit. The button does not appear for the only active organization. Since 0.39.0, each organization gets the Limits button in Organizations, with the maximum number of phone lines and of agents and the usage next to it; above the limit, creating more is refused with the count, lowering a limit deletes nothing, and the organization sees its own limits in Settings, read-only. With no limit set, nothing changes. Since 0.40.0, in Limits, the Outbound calls field blocks every outbound call of the organization, including the call-back, without changing its choice: unblocking gives outbound calling back as it had left it. The transfer to a person, in the middle of an inbound call, goes on. Since 0.41.0, in Limits, the Monthly spending cap field (in dollars, the currency of the cost DeskVoice measures) shows next to it how much the organization has already spent in the month, the same sum as on the Costs screen; when the sum reaches the cap, every new call of the organization is refused at the start, before opening the voice engine: the one received through the phone line or through WhatsApp hears the unavailable message, and the outbound one, the call-back and the browser call do not go out, with the reason on the screen and on the timeline. The call in progress is not cut. The value is approximate (it includes estimated cost and does not include what could not be measured), and two calls that start together just below the cap both go through. The organization sees the cap and the month's spending in Settings, and the Overview gets the Monthly cap column. With no cap, nothing changes. Since 0.42.0, in Organizations, the "Defaults for new organizations" section keeps the limits each new organization is born with (lines, agents, monthly cap and whether it can call out), and the new organization form says before creating what it is born with. With no default chosen, the new one is born with no limit on lines, agents and spending, and with outbound calls blocked until someone unblocks them in its limits; before, it was born with no lock at all. The new one receives a copy: changing the default later does not touch any organization that already exists, and the organization of whoever installed and the ones that already exist stay as they are. The change of the default stays in the Audit. Since 0.43.0, the defaults also carry the time zone (as an IANA name, such as America/Sao_Paulo), which applies to the calling window and to the cost month of the new organization, and the language (Portuguese, English or Spanish) that its new agent form and new menu form propose; agents and menus that already exist do not change, and the screen language is still that of each browser. With no default chosen, the new one is born in America/Sao_Paulo and proposes Portuguese, as before. The organizations that already exist do not change time zone, cost month or language, not even when the default changes later | Tested against a real database, including the creation of the second organization, isolation between organizations and the invitation that stops being valid when whoever generated it loses the role or has the account deleted. The CI screen test goes through Organizations and Administration; it does not create the second organization nor open Audit. The screens were not opened by a person in a browser, and there is still no proof on a real install with more than one organization; suspension was tested against a real database and in the CI screen test. The Overview was tested against a real database, with each organization's numbers compared to those of its Costs and System health; the CI screen test only checks that the section appears in the navigation. The limits were tested against a real database, including two creations at the same time at the limit, and the isolation test requires that no organization changes its own limits. The outbound block was tested against a real database, including the call-back already scheduled, which does not go out and becomes a follow-up. The monthly cap was tested against a real database on the four doors (phone line, WhatsApp, outbound and browser), including the exact limit, the turn of the month in the organization's time zone and the refused call-back; still no proof on a real install. The defaults for new organizations were tested against a real database, including that the organization of whoever installed and the ones that already exist do not change and that changing the default does not touch an organization already created; the new section was not opened in a browser. The default time zone and language were tested against a real database, and the language proposal through the session route, not through the screen; the new field and the forms that propose the language were not opened in a browser. Since 0.30.0 (suspending, since 0.35.0; Overview, since 0.37.0; limits, since 0.39.0; outbound block, since 0.40.0; monthly cap, since 0.41.0; defaults for new organizations, since 0.42.0; default time zone and language, since 0.43.0) |
| The same person in several organizations, with the same account: the name and the role apply only within each organization, and whoever has an active membership in more than one gets a selector at the top of the screen to switch without leaving the panel; whoever has a single organization sees nothing new. Login goes back to the last organization used. Deactivating or removing the person in one organization does not touch the others, and a password change ends the account's other sessions in all of them | Tested against a real database, including isolation between organizations after switching, and in the CI screen test. The selector was not opened by a person in a browser, and there is still no proof on a real install with more than one organization. Since 0.32.0 |
| New-version notice in the panel's sidebar, highlighted only for the owner and admins, which leads straight to the update screen; operators see the running version, without highlight | Unit-tested, including that operators do not see the highlight. The sidebar was not checked in a browser. Right after a release, the sidebar may announce it before the update screen offers the button. Since 0.13.0 |
| Record the call audio, off by default and turned on from the panel (Settings → Privacy → Call recording) | Tested against a real database and on a browser call, in an end-to-end test. Not yet proven on a real install. Since 0.6.0 |
| Fingerprint (SHA-256) of each recording and each voicemail message, on the call's timeline, to check whether a copy of the audio is the same as the one recorded. It proves nothing against whoever administers the server, because the fingerprint sits on the same machine as the audio | Tested with a real database; the timeline was checked by a test that renders the screen, not in a browser. Recordings made before the update have no fingerprint. Since 0.13.0 |
| Stop recording when the caller asks, by the agent (the `stop_recording` tool, checked per agent) or by the button on the live call screen; the stop shows on the timeline | Tested against a real database, in the real call session, with a simulated engine and telephony. Not yet proven on a real install. Since 0.9.0 |
| Transcribe the recording of a call that was left without text, through the agent's provider, with each side of the call kept apart; off by default, turned on in Settings → Outcome, analysis and transcription, with the button on the call screen, next to a note that, with the outcome or the analysis on, transcribing also triggers the paid classification | Tested against a real database and simulated provider responses: cost in the ledger and under the ceiling, the provider failure with its reason on the timeline, refusal for an erased call, one past the retention period or one too long for the provider without the recording being loaded into memory. Not yet proven on a real install nor with real OpenAI or Gemini. Since 0.10.0 |
| Transcribe on its own, at the end of the call, the recording that was left with no speech at all, before the final summary, the outcome and the notice; its own switch, off by default, in Settings → Outcome, analysis and transcription, which only works with on-request transcription also on. Each transcribed call is a paid request to the provider, counted in the cost and the ceiling | Tested against a real database and simulated provider responses: a call that already has speech is not transcribed again, and a recording that is too long is not even read. Not yet proven on a real install or with a real OpenAI or Gemini. Since 0.11.0 |
| Transcript retention period and export of what the organization keeps about a phone number (Settings) | Tested against a real database and checked on screen, on a panel against a throwaway database. Not yet proven on a real install. Since 0.6.0 |
| Erase at the caller's request (Settings → Privacy): preview of what goes, a confirmation that names the phone number, a receipt; all speech and text about the person goes, including the recording, and the service record stays. Backup copies already made are not reached | Tested against a real database, including the check back through the export. Not yet proven on a real install. Since 0.9.0 |
| Temporary link for the caller to download the recording of their own call, created on the call screen by the owner or an admin: valid for 72 hours and 10 downloads, with no login, and the screen revokes it at once; each creation, revocation and download goes into the Privacy log | Tested with a real database, including simultaneous downloads that do not go over the limit. Neither the call screen nor the /s/<token> page the caller opens was checked in a browser, and without a domain the link only opens from inside the server. Since 0.12.0 |
| Calls placed by the agent | Awaiting real-world proof, and off by default. See "Outbound calls" |

If you answer a call through a carrier line, tell us how it went in an issue: inbound calls over
a SIP trunk have no public record yet, and that is the most valuable contribution right now.

What does **not** exist yet: several
companies on one screen, a visual flow builder, voice IVR, call queues.
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
| Panel | GitHub's public releases API (`api.github.com/repos/DeskLabs-OpenSource/DeskVoice/releases`) | When someone opens Administer the installation → Update or confirms an update. The answer is kept for 10 minutes (1 minute if the lookup failed) | A read request with no credential and no body, with two fixed headers, the same on every install: `accept: application/vnd.github+json` and `user-agent: deskvoice-panel`. No version, address or identifier of the install |
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
addresses of the tools and webhooks you registered. With the call outcome or the call analysis turned on (Settings →
Outcome, analysis and transcription, off by default), the routines process also sends the text transcript to
the same provider, after the call, through its text API (`/chat/completions` on OpenAI,
`:generateContent` on Google), or to the OpenAI-compatible endpoint you set up for it. Since 0.44.0, a webhook with "Receive the report of every call"
ticked (unticked by default) receives, after each call, the outcome, the summary and the analysis; it does not
receive the caller's phone number, the transcript or the recording. But the summary and the analysis tell what
was said: if the caller spoke a number or other data aloud, it goes along. What leaves is not deleted at the
destination when the caller asks for erasure.

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
and security work from [webtecnica](https://github.com/webtecnica) are in the published releases, and since 0.6.0 so are
the rights of callers (retention period and export), from webtecnica, and the OpenAI cost checked
against the invoice, the farewell before hanging up and call recording, from
[aliffstefano](https://github.com/aliffstefano). Release 0.8.0 brings the call outcome and the end-of-call WhatsApp notice, from webtecnica, and 0.9.0, also from webtecnica, brings automated-menu keys, unanswered transfers, recording that stops on request and erasure at the caller's request, and 0.10.0, also from webtecnica, brings transcription of the recording, and 0.11.0, also from webtecnica, brings the retention period reaching the call summary, the exact cost of reading the outcome and the outcome on an OpenAI-compatible provider, the transcription cost notice and failure on screen, the IP line with several blocks, automatic transcription at the end of the call, and the deployment guides for clinics and for the same VPS as the CRM, and 0.12.0, also from webtecnica, brings voicemail, the link for the caller to download the recording, and the ARM images, and 0.13.0, also from webtecnica, brings the new-version notice in the sidebar, the per-call ceiling on tools, the panel's security headers and the recording fingerprint. DeskcommCRM, where the contribution workflow used
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
