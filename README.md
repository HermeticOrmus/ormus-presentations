<p align="center">
  <img src="https://ormus.solutions/mascot/golden_swan.gif" alt="ormus-presentations" width="128" style="image-rendering: pixelated;" />
</p>

<h1 align="center">ormus-presentations</h1>

<p align="center">
  <em>Self-hosted presentation builder. Full-screen scroll-snap viewer, shareable links, 7 slide types. Express + SQLite.</em>
</p>

<p align="center">
  <a href="https://github.com/HermeticOrmus/ormus-presentations/stargazers"><img src="https://img.shields.io/github/stars/HermeticOrmus/ormus-presentations?style=flat-square&color=aa8142" alt="Stars" /></a>
  <a href="https://github.com/HermeticOrmus/ormus-presentations/blob/main/LICENSE"><img src="https://img.shields.io/github/license/HermeticOrmus/ormus-presentations?style=flat-square&color=aa8142" alt="License" /></a>
  <a href="https://github.com/HermeticOrmus/ormus-presentations/commits"><img src="https://img.shields.io/github/last-commit/HermeticOrmus/ormus-presentations?style=flat-square&color=aa8142" alt="Last Commit" /></a>
  <img src="https://img.shields.io/badge/Claude_Code-aa8142?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code" />
</p>

---

> **Self-hosted presentation builder. Full-screen scroll-snap viewer, shareable links, 7 slide types. Express + SQLite.**

A minimal-but-complete presentation tool you run yourself. Build decks via API or DB, share a token URL, viewer scrolls through full-screen slides with keyboard navigation and progress tracking. No SaaS, no Google account, no animations-as-product.

## Why

Most presentation tools fall into two camps: bloated and bossy (Google Slides, PowerPoint), or beautiful but ephemeral (Pitch, Tome, etc. — your decks live in their cloud forever). `ormus-presentations` is the third option:

- Your data, your server, your SQLite file
- Shareable links work without anyone signing in
- 7 opinionated slide types (title, content, stats, quote, list, comparison, cta) instead of free-form everything
- Single `server.js` (~1400 lines), one HTML for the editor index, dynamically rendered viewer pages

Designed for sales presentations, internal pitches, and any deck where you want control over the asset.

## Install

```bash
git clone https://github.com/HermeticOrmus/ormus-presentations
cd ormus-presentations
npm install
npm start
```

Open `http://localhost:8094`. Create a presentation via the API:

```bash
curl -X POST http://localhost:8094/api/presentations \
  -H 'Content-Type: application/json' \
  -d '{"title":"My Pitch","subtitle":"How we win","client_name":"Acme Corp"}'
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8094` | HTTP port |
| `DB_PATH` | `./data/presentations.db` | SQLite file location |

## Slide types

| Type | Renders |
|---|---|
| `title` | Hero with brand badge (uses `presentation.client_name`), optional video background (`presentation.title_video_url`) |
| `content` | Heading + prose body |
| `stats` | Heading + grid of stat blocks (parsed from content) |
| `quote` | Centered pull quote |
| `list` | Heading + bulleted/numbered list |
| `comparison` | Side-by-side comparison block |
| `cta` | Call-to-action with primary button |

The slide-type set is opinionated. Each type has a fixed visual treatment so you can't ruin it with formatting.

## Schema

| Table | Columns |
|---|---|
| `presentations` | `id`, `title`, `subtitle`, `client_name`, `client_logo_url`, `title_video_url`, `share_token`, `status` (draft/live/archived), `theme`, timestamps |
| `slides` | `id`, `presentation_id`, `title`, `content`, `slide_type`, `sort_order`, `created_at` |

Foreign key cascade on slide deletion. Schema migrates automatically (`title_video_url` was added without breaking existing DBs).

## Routes

### Editor / API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/presentations` | List all |
| `GET` | `/api/presentations/:id` | Get one with slides |
| `POST` | `/api/presentations` | Create |
| `PUT` | `/api/presentations/:id` | Update |
| `DELETE` | `/api/presentations/:id` | Delete |
| `POST` | `/api/presentations/:id/slides` | Add slide |
| `PUT` | `/api/presentations/:presId/slides/:slideId` | Update slide |
| `DELETE` | `/api/presentations/:presId/slides/:slideId` | Delete slide |
| `PUT` | `/api/presentations/:id/reorder` | Reorder slides |

### Public viewer

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/view/:token` | Pre-page (lobby with deck info, "Enter" button) |
| `GET` | `/view/:token/present` | Full-screen presentation (scroll-snap, keyboard nav) |
| `GET` | `/view/assets/:filename` | Public asset serving (for video backgrounds, logos) |

The `/view/*` routes are intentionally unauthenticated — share the token URL with anyone.

## Custom assets

To use a video background on title slides, drop the file in `assets/` (gitignored) and set `presentation.title_video_url` to `/view/assets/yourfile.mp4`.

To brand the viewer, set `presentation.client_name` and (optionally) `client_logo_url` per presentation.

## Pairs with

Other self-hosted Ormus tools:

- [ormus-invoicer](https://github.com/HermeticOrmus/ormus-invoicer) — self-hosted invoicing for solo operators
- [ormus-polls](https://github.com/HermeticOrmus/ormus-polls) — self-hosted polling with Firebase Auth

And the Claude Code skill family:

- [ormus-handoff](https://github.com/HermeticOrmus/ormus-handoff) · [ormus-pickup](https://github.com/HermeticOrmus/ormus-pickup) · [ormus-absorb](https://github.com/HermeticOrmus/ormus-absorb) · [ormus-explore](https://github.com/HermeticOrmus/ormus-explore) · [ormus-vibe-proof](https://github.com/HermeticOrmus/ormus-vibe-proof) · [ormus-meta-prompting](https://github.com/HermeticOrmus/ormus-meta-prompting)

## License

MIT. See [LICENSE](LICENSE).

## Origin

Built because every other "build a deck" tool either locks the data behind a SaaS, requires a Google account to view, or treats slides as free-form canvases that can be ruined with bad formatting. Released as a no-bullshit alternative for anyone who wants opinionated slide types, custom branding, and shareable links from their own infrastructure.

---

## Part of the Libre Open-Source Stack for Claude Code

This repository is part of a growing family of open-source toolkits for Claude Code.

### Libre suite — comprehensive plugin bundles

- [LibreUIUX-Claude-Code](https://github.com/HermeticOrmus/LibreUIUX-Claude-Code) — UI/UX development (152 agents, 70 plugins, 76 commands, 74 skills)
- [LibreArch-Claude-Code](https://github.com/HermeticOrmus/LibreArch-Claude-Code) — Software architecture and system design
- [LibreCopy-Claude-Code](https://github.com/HermeticOrmus/LibreCopy-Claude-Code) — Technical writing and documentation engineering
- [LibreDevOps-Claude-Code](https://github.com/HermeticOrmus/LibreDevOps-Claude-Code) — DevOps engineering and infrastructure automation
- [LibreEmbed-Claude-Code](https://github.com/HermeticOrmus/LibreEmbed-Claude-Code) — Embedded systems, firmware, and IoT development
- [LibreFinTech-Claude-Code](https://github.com/HermeticOrmus/LibreFinTech-Claude-Code) — Financial technology development
- [LibreGEO-Claude-Code](https://github.com/HermeticOrmus/LibreGEO-Claude-Code) — AI-search optimization (ChatGPT, Perplexity, Gemini, Google AI Overviews)
- [LibreGameDev-Claude-Code](https://github.com/HermeticOrmus/LibreGameDev-Claude-Code) — Game development across Godot, Unity, Unreal
- [LibreMLOps-Claude-Code](https://github.com/HermeticOrmus/LibreMLOps-Claude-Code) — ML engineering and AI operations
- [LibreMobileDev-Claude-Code](https://github.com/HermeticOrmus/LibreMobileDev-Claude-Code) — Mobile app development (Flutter, React Native, native iOS, native Android)
- [LibreSecOps-Claude-Code](https://github.com/HermeticOrmus/LibreSecOps-Claude-Code) — Security operations

### Skills mini-repos — single CLAUDE.md drop-ins

- [vibe-engineer-skills](https://github.com/HermeticOrmus/vibe-engineer-skills) — Direct AI codegen well (hypothesis → scope → validate → reject working-but-wrong)
- [markdown-discipline-skills](https://github.com/HermeticOrmus/markdown-discipline-skills) — Strip AI-slop from markdown (no em dashes, no marketing fluff)
- [shell-safety-skills](https://github.com/HermeticOrmus/shell-safety-skills) — `set -euo pipefail` discipline + 15 failure-mode examples
- [commit-standard-skills](https://github.com/HermeticOrmus/commit-standard-skills) — Ormus Commit Standard v1.0 + commit-msg hook + commitlint
- [unwoke-skills](https://github.com/HermeticOrmus/unwoke-skills) — Strip AI theater (ten sins to eliminate, symmetric engagement)
- [python-conventions-skills](https://github.com/HermeticOrmus/python-conventions-skills) — Modern Python 3.11+ (types, pathlib, async, ruff, mypy, uv)
- [typescript-conventions-skills](https://github.com/HermeticOrmus/typescript-conventions-skills) — TypeScript strict mode, discriminated unions, Result types
- [hermetic-laws-skills](https://github.com/HermeticOrmus/hermetic-laws-skills) — Seven Hermetic Principles applied to engineering
- [riper-workflow-skills](https://github.com/HermeticOrmus/riper-workflow-skills) — Research / Innovate / Plan / Execute / Review systematic dev
- [six-day-cycle-skills](https://github.com/HermeticOrmus/six-day-cycle-skills) — Sustainable shipping cadence with mandatory rest
- [token-optimization-skills](https://github.com/HermeticOrmus/token-optimization-skills) — Claude Code token + context optimization
- [osint-skills](https://github.com/HermeticOrmus/osint-skills) — OSINT research methodology (multi-wave investigative spiral)
- [calcinate-skills](https://github.com/HermeticOrmus/calcinate-skills) — Stage 1 of the Magnum Opus (burn project bloat)
- [claude-md-overhaul-skills](https://github.com/HermeticOrmus/claude-md-overhaul-skills) — Audit CLAUDE.md and MEMORY.md against caps
- [session-handoff-skills](https://github.com/HermeticOrmus/session-handoff-skills) — Session handoff + pickup discipline
- [naming-skills](https://github.com/HermeticOrmus/naming-skills) — Product naming methodology (mine the brand's vocabulary)
- [magnum-opus-skills](https://github.com/HermeticOrmus/magnum-opus-skills) — Seven-stage alchemy applied to project transformation

### Template source

- [andrej-karpathy-skills](https://github.com/HermeticOrmus/andrej-karpathy-skills) — the canonical single-file CLAUDE.md pattern (fork of jiayuan_jy's original)

Star the family, not just one — that's how the suite stays coherent.
