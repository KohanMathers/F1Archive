# Team radio recordings

## Folder layout

Recordings live in one folder (`RADIO_DIR_HOST` in `.env`, mounted at `/data/radio`). The layout mirrors F1's live timing archive, so every path comes straight from the database and nothing needs renaming:

```
<radio folder>/<session archive path><clip path>

radio/
└── 2021/
    └── 2021-12-12_Abu_Dhabi_Grand_Prix/
        └── 2021-12-12_Race/
            └── TeamRadio/
                ├── MAXVER01_33_20211212_174512.mp3
                ├── LEWHAM01_44_20211212_174633.mp3
                └── …
```

- `<session archive path>` is `t_session_info.Path` (e.g. `2021/2021-12-12_Abu_Dhabi_Grand_Prix/2021-12-12_Race/`).
- `<clip path>` is `t_session_team_radio.Path` (e.g. `TeamRadio/MAXVER01_33_20211212_174512.mp3`).
- So a file's original URL is simply `https://livetiming.formula1.com/static/` + the same relative path.

If you already have the clips in another structure, a one-off script that moves each file to `archive_path + path` is all that is needed; the database has both for every clip:

```sql
SELECT s.archive_path || r.path FROM team_radio r JOIN sessions s ON s.id = r.session_id;
```

## Filling the folder

```bash
docker compose run --rm worker radio-fetch                     # everything missing
docker compose run --rm worker radio-fetch 2026                # a season
docker compose run --rm worker radio-fetch 2021-abu-dhabi      # an event
docker compose run --rm worker radio-fetch 2021-abu-dhabi-race # a session
```

Downloads are sequential with a short pause between requests (`RADIO_FETCH_DELAY_MS`, default 150 ms), skip files that already exist, write to `.part` files and rename on completion — safe to interrupt and re-run. At the end it rescans the folder.

## Telling the site what is there

```bash
docker compose run --rm worker radio-scan
```

marks each clip `file_available` (also run automatically after `ingest`). Clips without a file still appear everywhere with their timestamp and driver, marked "Recording not held · Why?".

## What visitors get

- In-page playback (session page, telemetry viewer — synchronised with the replay).
- `GET /media/radio/{year}/{event}/{session}/{id}.mp3` — one clip, with HTTP Range support; `?download` for an attachment.
- `GET /media/radio/{year}/{event}/{session}.zip` — every held clip of a session, streamed, with an `index.csv` (session time, UTC, driver, original path). Rate-limited.
- `RADIO_DOWNLOADS=false` in `.env` disables downloads (single-clip `?download` and zips) while keeping in-page playback.

F1 identifies the car's radio channel, not who is speaking, so the site says "VER car radio" — never "Verstappen said". Recordings were published by Formula 1; check whether redistribution is appropriate for your deployment (see the About page).
