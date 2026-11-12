# F1Archive

An independent, unofficial, long-term archive of Formula 1 data.

F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

- Explore every season, Grand Prix, session, driver and team since 2018: results, laps, tyres, weather, race control, team radio.
- Telemetry viewer: replay any session on a circuit map with synchronised speed/throttle/brake/RPM/gear/DRS traces, live gaps and a timing tower, the race-control feed and team radio on one timeline.
- Compare laps across drivers, sessions and seasons, aligned by distance, with a running delta and a mini-sector map.
- Research: build datasets and export original-resolution data as CSV, JSON Lines, JSON, Parquet or SQLite asynchronously, with schema and provenance.
- Data explorer and a versioned, documented public API (`/api/docs`).
- Every gap in the data says "Why is this missing?" and explains it. Nothing is ever estimated or invented.

## Repository

| Path                         | What                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web`                   | Next.js 15 front end (App Router, React 19). Canvas map/traces; no chart library.               |
| `apps/api`                   | Fastify 5 API, OpenAPI at `/api/docs`, radio streaming at `/media`.                             |
| `apps/worker`                | CLI: `ingest`, `radio-scan`, `radio-fetch`, `exports` (job loop), `serve`.                      |
| `packages/shared`            | Types, stable identifiers, units/formatting, feed catalogue, gap explanations, telemetry maths. |
| `packages/db`                | PostgreSQL schema (migrations), pool, export category definitions.                              |
| `scripts/make-dev-subset.sh` | Builds a small development copy of the archive.                                                 |
| `docs/`                      | Architecture, data, deployment, radio, decisions (ADRs).                                        |

## Quick start (development)

Requirements: Docker, Node 22+, pnpm, sqlite3, and the source archive (`f1-telem.db`). The archive is not included in this repository because of its size (over 120 GB); to request a copy, contact Kohan Mathers on Discord (@IEatSystemFiles) or by email (kmathers@kmathers.co.uk), and one will be sent in a manner agreed between you.

```bash
pnpm install
cp .env.example .env
./scripts/make-dev-subset.sh /mnt/data/f1-telem.db
docker compose up -d --build
docker compose run --rm worker ingest
docker compose run --rm worker radio-fetch 2021-abu-dhabi-race
```

Open http://localhost:3000.

Working on the code without containers for the apps:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
export DATABASE_URL=postgres://f1archive:<password>@127.0.0.1:5433/f1archive
pnpm --filter @f1archive/worker dev ingest --source ../../data/dev/f1-telem-dev.db
pnpm dev:api
API_INTERNAL_URL=http://localhost:4000 pnpm dev:web
```

Tests: `pnpm -r test`. The integration tests need `DATABASE_URL` (API) and `TEST_DATABASE_URL` (worker; a server where a throwaway database can be created), they are skipped otherwise.

## Production

See **[docs/DEPLOY.md](docs/DEPLOY.md)**, moving to the server, importing the full archive (~100 GB in PostgreSQL, a few hours), radio recordings, the reverse proxy, backups, and keeping it in sync after each race weekend.

## Documentation

- [docs/DATA.md](docs/DATA.md) — source archive -> production schema, units, identifiers, what was found in the data.
- [docs/RADIO.md](docs/RADIO.md) — team radio folder layout and downloader.
- `/docs` and `/api/docs` on the running site — API reference.

F1Archive is not affiliated with Formula One Management, the FIA, any team or driver.

## Licence

The code is released under the [MIT Licence](LICENSE). The licence covers the code in this repository only. It does not cover the Formula 1 data, team radio recordings or trade marks the archive refers to, which belong to their owners.
