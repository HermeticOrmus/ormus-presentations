# ormus-presentations

> Self-hosted presentation builder. Full-screen scroll-snap viewer, shareable links, 7 slide types. Express + SQLite.

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
