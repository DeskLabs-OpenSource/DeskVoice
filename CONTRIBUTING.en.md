# Contributing to DeskVoice

[Português](CONTRIBUTING.md) · English

This guide exists so that your first PR goes well. If something here is wrong or missing, that
is a bug in the project: open an issue.

This page is a translation of [`CONTRIBUTING.md`](CONTRIBUTING.md). Doctrine and guides are
written in Brazilian Portuguese. Issues and PRs in English are welcome.

## Before you start

1. **Open the repository in your coding assistant** (Claude Code, Codex, Cursor, Antigravity).
   The `deskvoice-contribuir` skill, in `.agents/skills/`, measures before the PR what review
   measures after it, and sets up the git hooks.
2. Read [`AGENTS.md`](AGENTS.md). These are the conventions, for people and for assistants.
3. Read [`ARCHITECTURE.md`](ARCHITECTURE.md). It is one page.
4. See the system working: `pnpm install && pnpm demo` runs a whole call with no AI key and no
   carrier.

Looking for where to start? [`ROADMAP.md`](ROADMAP.md) lists the open fronts, each with a size
and an entry point in the code.

## Branches

- `main` is protected. Nobody pushes to it directly, maintainers included.
- All work arrives through a PR, from a fork or from a `feat/<topic>` or `fix/<topic>` branch.
- **Never open a PR from your fork's `main`.** Create a named branch from this repository's
  `main`, with only your change in it.
- There is a single merge path: the merge queue. Details in [`GOVERNANCE.md`](GOVERNANCE.md).

## Commits

Conventional Commits. The project's commit history is written in Brazilian Portuguese. If you
do not write Portuguese, write the commit in English: a maintainer adjusts the subject at merge
time, and you remain the author. Imperative subject, up to 72 characters.

```
feat(tools): adiciona ferramenta de consulta de agenda
fix(voice): encerra a chamada quando o motor fecha a sessão
```

## What CI rejects, and what it cannot see

The list is split in two on purpose. One part is enforced by a machine. The other only a person
notices.

### What CI rejects

Run this before opening the PR and there will be no surprise:

```bash
pnpm verify      # lint, types, fences and unit tests
pnpm test:db     # only if you touched the database; needs Docker
```

The fences (`pnpm fences`) are what rejects PRs most often, and they run in seconds. What each
one guards is in [`docs/doctrine/cercas.md`](docs/doctrine/cercas.md).

**The check on your PR only measures your diff.** If CI goes red over something you did not
touch, the failure belongs to the project, and the job message says so. You do not have to fix
`main` to deliver your change.

### What CI cannot see

- The new piece has a caller and feeds something. A capability nobody calls does not get in.
- What happens in a call shows up in the timeline, on screen.
- Every error path has a spoken line for the caller and an event for the panel. Nothing ends in
  silence.
- The operator turns things on and configures them on screen. If it needs SSH, it is not done.
- Anything that spends money with a provider is measured and respects the ceiling.
- An action that deletes work asks for confirmation and says what will be lost.
- No rule from a single line of business inside the core.
- Screen text follows the tone: professional, calm, no exclamation marks.
- Code brought from another project is credited in [`CREDITS.md`](CREDITS.md).

The full list is the Definition of Done in [`AGENTS.md`](AGENTS.md).

## Taking an issue: the "pego esta" protocol

It exists so that two people do not do the same work without knowing about each other.

1. **Comment "pego esta" ("I'll take this") before writing code.** One line is enough. A
   maintainer assigns the issue to you. From then on it is yours.
2. **An assigned issue is not duplicated.** Want to help? Offer in a comment. Do not open a
   competing PR.
3. **A maintainer does not implement an issue opened for the community** without first
   assigning it to themselves in public.
4. **No assignment after 3 business days?** Start anyway and say so in the PR. The delay is
   ours, and the cost cannot be yours.
5. **Gave up or got stuck?** Say so in the issue. Nobody owes anything. It goes back to the
   queue with what you found.

## Contributing from a fork

**You are in the right place.** A fork is the normal way to contribute, not a second-class one.
A few things will look like your mistake and are not:

- **On your first PR, workflows wait for approval.** That is GitHub's policy for first-time
  contributors to a repository. A maintainer releases them.
- **You get an automatic message within minutes.** That is the welcome. It tells you what
  happens next.

Three tasks belong to the maintainers, not to you. Do not hold your PR because of them:

| Task | Why it is ours |
|---|---|
| The release-notes fragment in `.changes/` | Whoever writes the note must know what the owner of a VPS will have to do. If you can write it, great. If not, send the PR without it |
| Conflicts with `main` | `main` moves fast. Bringing your branch up to it is the job of whoever merges |
| The migration timestamp | If another migration landed before yours, the timestamp is adjusted in the queue. Do not rename it yourself once the PR is open |

If review finds something to adjust, we adjust it. You do not get asked for fixes. We open a PR of
ours with your commits as they are, you as the author of each one, and the adjustment in a
separate commit on top. Your PR gets the "corrigindo" label with a link to ours, and closes when
ours lands, saying what went in and with what credit.

Added a screen sentence and do not write Portuguese or Spanish? Send what you have and say so in
the PR. Translation is a few minutes of work for the reviewer.

## Response time

| What | When |
|---|---|
| Automatic welcome on the PR | Minutes |
| First reply from a person, on a PR or an issue | Up to 3 business days |

Past the deadline? Comment on the PR or the issue. Asking is legitimate, and silence is our
failure.

## Credit is law

- **Authorship is preserved.** What you wrote goes in with you as the author. When a maintainer
  finishes or adjusts your work, you remain author or co-author of the commit.
- **Your name goes in the release notes** of the version that ships the change.
- **Your work keeps your name.** When the adjustment comes in a PR of ours, it carries your
  commits with you as the author, and your PR only closes after ours lands, pointing to it.
- **Ideas have authors too.** If your report or suggestion led to the change, the note says so.

If credit comes out wrong, tell us. Fixing it has priority.

## Running locally

You need Node 22, pnpm and, for the database tests, Docker.

```bash
git clone https://github.com/DeskLabs-OpenSource/DeskVoice.git && cd DeskVoice
pnpm install
pnpm demo          # a whole call with the simulated engine
pnpm verify        # what CI runs first
pnpm test:db
```

You do not need a SIP trunk or an AI key to contribute. The simulated engine runs a script and
exercises the whole path of a call.

Guides for the two most common contributions (in Portuguese):

- [Adding a tool](docs/guides/adicionar-uma-ferramenta.md)
- [Adding a voice engine](docs/guides/adicionar-um-motor-de-voz.md)

## What does not get in

So you do not spend time on a PR that will be declined. The full product rules are in
[`GOVERNANCE.md`](GOVERNANCE.md).

- Niche code in the core.
- Anything that makes mass dialing easier.
- A feature that requires SSH to be turned on.
- Telemetry.
- A paid or locked feature.

### Major version of a dependency

The dependency bot only proposes minor versions and patches. A major version (of Node, of Postgres,
of a package) is the maintainer's decision, in its own PR that says what changes for those who
already have an installation and how the kit makes the move. Postgres, for example, needs the
database files converted before the new image starts.

Major version for security: the vulnerability alert still shows up in the repository's Security
tab, which is a separate mechanism, and the PR is the maintainer's.

## Where to ask for help

- **Questions about contributing:** [GitHub Discussions](https://github.com/DeskLabs-OpenSource/DeskVoice/discussions). The answer stays on record for whoever comes next.
- **Bugs:** [open an issue](https://github.com/DeskLabs-OpenSource/DeskVoice/issues).
- **Vulnerabilities:** never in public. See [`SECURITY.md`](SECURITY.md).
- **Conduct:** see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
