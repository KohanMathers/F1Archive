# Deploying F1Archive

This is the procedure for running the full archive on the server behind your own reverse proxy.

## What you need

|                      |                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker + Compose v2  |                                                                                                                                                                                                                                        |
| The original archive | `f1-telem.db` (~122 GiB). Mounted read-only; the stack never writes to it. It can also stay on another machine: see [Importing from another machine](#importing-from-another-machine).                                                 |
| Disk for PostgreSQL  | Plan for ~110 GB of data (measured: ~109 bytes per telemetry row including its index; 947M rows ≈ 103 GB, everything else ≈ 1–2 GB) plus headroom for WAL during the import, keep ≥ 160 GB free. Fast disk (SSD) strongly recommended. |
| Disk for radio       | ~8–9 GB for all ~48,000 clips (measured average ≈ 180 KB/clip).                                                                                                                                                                        |
| RAM                  | 8 GB works; 16 GB+ is comfortable. Tune `PG_SHARED_BUFFERS` (≈25 % of RAM) and `PG_EFFECTIVE_CACHE_SIZE` (≈60 %).                                                                                                                      |

## 1. Configure

```bash
git clone https://github.com/KohanMathers/F1Archive /srv/f1archive && cd /srv/f1archive
cp .env.example .env
```

Edit `.env`:

```ini
POSTGRES_PASSWORD=<long random string>
PGDATA_DIR=/srv/f1archive/pgdata        # on the big disk
SOURCE_DB_DIR=/mnt/data                  # directory containing the archive
SOURCE_DB_FILE=f1-telem.db
RADIO_DIR_HOST=/srv/f1archive/radio      # or your existing radio folder (see docs/RADIO.md)
WEB_BIND=127.0.0.1                       # only your reverse proxy should reach it
WEB_PORT=3000
PG_SHARED_BUFFERS=4GB                    # example for 16 GB RAM
PG_EFFECTIVE_CACHE_SIZE=10GB
```

The radio and pgdata directories must be writable by uid 1000 (the containers' `node` user) and the Postgres container respectively; Docker creates `PGDATA_DIR` correctly if it does not exist.

## 2. Start

```bash
docker compose up -d --build
docker compose ps        # postgres, api (healthy), worker, web
```

The worker applies database migrations on start.

## 3. Import the full archive

```bash
tmux new -s ingest     # it takes a while; don't tie it to your SSH session
docker compose run --rm worker ingest
```

- **Duration**: development measurements were ~190,000 telemetry rows/s, so 947M rows is roughly 1.5–3 hours depending on disks, plus a few minutes for everything else.
- **Interrupting is safe**: Ctrl-C (or SIGTERM) finishes the session in progress and stops; every session is written atomically. Run the same command again and it continues where it stopped, already-imported sessions are skipped by fingerprint.
- Progress is logged per session. At the end it prints a summary; anomalies and any new source columns are stored in `ingest_runs.summary`:

  ```bash
  docker compose exec postgres psql -U f1archive -c "SELECT id, status, summary->'anomalies', summary->'unmapped_columns' FROM ingest_runs ORDER BY id DESC LIMIT 1"
  ```
- Moving from the development subset: start from an empty database (`PGDATA_DIR` pointing at a new directory) for the cleanest result. Ingesting the full archive over a subset database also works, every telemetry-less session is detected as changed and imported.

`ingest` options: `--no-telemetry` (metadata only, fast), `--years 2025,2026`, `--force` (re-import even if unchanged), `--source /path/to/file.db`, `--no-radio-scan` (for a machine without the recordings).

### Importing from another machine

When the archive lives on another machine (your PC, say) and should stay there, run the importer on that machine and let it write to the server's Postgres over the LAN. The archive is read locally, so it is never shared over the network. Mounting it over SMB, NFS or sshfs does not work reliably: the archive uses SQLite's WAL mode, whose shared-memory file and locks are not supported on network or read-only mounts.

On the server, publish Postgres on the LAN. In `.env`:

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.lan.yml
POSTGRES_BIND=192.168.1.20        # the server's LAN address
CACHE_CLEAR_TOKEN=<openssl rand -hex 32>
SOURCE_DB_DIR=/srv/f1archive/no-source   # any empty directory: the server never reads the archive
```

then `docker compose up -d`. Postgres accepts password logins from anything that can reach that port, so keep it off the internet, and ideally allow only the importing machine (for example `ufw allow from 192.168.1.10 to any port 5432`).

On the machine with the archive (Node 22+, pnpm, sqlite3), check out the same commit as the server, then:

```bash
pnpm install
cp .env.remote.example .env.remote     # SOURCE_DB, DATABASE_URL, WEB_INTERNAL_URL, CACHE_CLEAR_TOKEN
scripts/remote-ingest.sh               # the first full import: hours, resumable (see above)
```

The script runs `worker ingest --no-radio-scan` against the server and finishes by clearing the site's caches through the web server (`WEB_INTERNAL_URL`, with the token). The first import uses this machine's CPU, so the server can stay small. The recordings live on the server, so the radio scan is skipped here; the server runs `radio-fetch` or `radio-scan` itself (step 4). Keep both checkouts on the same version: the server's worker applies migrations, and the importer expects them.

## 4. Radio recordings

See [RADIO.md](RADIO.md). Either point `RADIO_DIR_HOST` at your folder and run

```bash
docker compose run --rm worker radio-scan
```

or let F1Archive download everything into the folder (resumable; ~48k requests, several hours):

```bash
docker compose run --rm worker radio-fetch            # everything
docker compose run --rm worker radio-fetch 2026       # one season
```

## 5. Reverse proxy

Only the web container is published. It proxies `/api` and `/media` to the API internally, so one upstream is enough.

**Caddy**

```caddy
f1archive.org {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

**nginx**

```nginx
server {
  server_name f1archive.org;
  # ... TLS ...
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;            # stream exports and radio zips
    proxy_read_timeout 600s;
  }
}
```

The API rate-limits per client IP using `X-Forwarded-For` (`TRUST_PROXY=true`). Make sure your proxy **overwrites** (not appends to an untrusted) `X-Forwarded-For`, or set `TRUST_PROXY=false`.

## 6. After every sync of the source archive

```bash
~/f1telem-sync.sh                            # your existing collector
cd /srv/f1archive && docker compose run --rm worker ingest   # imports only what changed
docker compose run --rm worker radio-fetch 2026              # new clips (or radio-scan for your own folder)
```

A cron example (Monday 06:00, after race weekends):

```cron
0 6 * * 1  cd /srv/f1archive && ~/f1telem-sync.sh 2026 && docker compose run --rm -T worker ingest --years 2026 && docker compose run --rm -T worker radio-fetch 2026 >> /var/log/f1archive-sync.log 2>&1
```

With the archive on another machine, the sync and the import run there, one after the other, so the import never reads a half-written archive:

```cron
# On the machine with the archive
0 6 * * 1  cd ~/F1Archive && ~/f1telem-sync.sh 2026 && scripts/remote-ingest.sh --years 2026 >> ~/f1archive-ingest.log 2>&1
# On the server, an hour later: new radio clips for whatever was imported
0 7 * * 1  cd /srv/f1archive && docker compose run --rm -T worker radio-fetch 2026 >> /var/log/f1archive-radio.log 2>&1
```

Statistics, search and "recently archived" update automatically. With `CACHE_CLEAR_TOKEN` set in `.env`, each of these commands also clears the site's caches when it finishes, so new data shows at once; without it, the caches expire on their own within an hour. The worker calls the web server's `/internal/revalidate`, which clears the API's caches over the Docker network and then its own. The API's endpoint is not reachable from outside (the web server does not proxy `/api/internal`), and both answer 404 without the token.

## Site notice

A message shown to everyone who opens the site, until it expires: for example when no new data can be added for a few days. Visitors can close it; it shows again on their next visit, and immediately for a new message. Set `NOTICE_TOKEN` in `.env` (`openssl rand -hex 32`) and `docker compose up -d`. The endpoints go through the web server, so they work from anywhere:

```bash
# Set (or replace) the notice. The expiry is ISO 8601 with a time zone.
curl -X POST https://f1archive.org/api/admin/notice \
  -H "Authorization: Bearer $NOTICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"message": "No new data until Friday: the collector is offline.", "expiry": "2026-11-13T18:00:00Z"}'

# Remove it before it expires.
curl -X POST https://f1archive.org/api/admin/notice/clear -H "Authorization: Bearer $NOTICE_TOKEN"
```

Setting returns the stored notice; a bad message or expiry gets a 400 saying why. Messages are plain text (line breaks kept), up to 1,000 characters. Without the right token, both endpoints answer 404. None of them are in the public API documentation.

## 7. Backups and preservation

- The SQLite archive is the source of truth. The PostgreSQL database can always be rebuilt from it with `ingest`, so back up the archive and the radio folder ideally to two independent places and test a restore occasionally (`sqlite3 copy.db 'PRAGMA integrity_check'`).
- A PostgreSQL dump is optional (it only saves re-import time): `docker compose exec -T postgres pg_dump -U f1archive -Fc f1archive > f1archive.dump`.
- Export files are temporary (48 h) and need no backup.

## 8. Upgrading

```bash
git pull && docker compose up -d --build
```

New migrations run when the worker starts. If a release changes how data is derived, it will say so and ask for `ingest --force`.

## 9. Health and logs

- `GET /api/health` — API and database reachable.
- `docker compose logs -f api worker web`
- Export jobs: `SELECT id, status, stage, rows_written, error FROM export_jobs ORDER BY created_at DESC LIMIT 20;`
- Limits are configurable in `.env`: `RATE_LIMIT_PER_MINUTE`, `EXPORT_MAX_ROWS`, `EXPORT_CONCURRENCY`, `EXPORT_TTL_HOURS`, `RADIO_DOWNLOADS`.
