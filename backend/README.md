# Backend

Local CMS API (FastAPI + PostgreSQL), per Addendum 01 (ART-020, ART-021) and Addendum 02 (PUB-001).

Every `/api/*` route except `/api/session` needs a signed-in admin. Keep binding to `127.0.0.1` while the CMS runs locally.

## Run locally

Step-by-step guide (Docker, first run, daily use, backup and restore): [`docs/local-setup.md`](../docs/local-setup.md).

```sh
cp .env.example .env                 # then fill in CONTENT_REPO_DIR, DEPLOY_REPO and CMS_GITHUB_TOKEN
docker compose up -d                 # PostgreSQL 16 on 127.0.0.1:5432
uv sync
uv run --env-file .env alembic upgrade head
uv run --env-file .env python -m blog.auth   # set the admin password (asked twice, 12+ characters)
(cd ../cms && npm ci && npm run build)       # CMS UI, served at /admin/
uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

Started this way, the CMS does not run the due maintenance; `scripts/start.sh` does, or run `uv run --env-file .env python -m blog.maintenance`.

`--env-file .env` loads the settings; the backend itself reads only environment variables.

CMS: http://127.0.0.1:8000/admin/ · API docs: http://127.0.0.1:8000/docs

## Backup and restore

`scripts/start.sh` (the normal way to start the CMS) starts the database, takes a backup, applies migrations, runs due maintenance and starts the server. If the backup fails while migrations are pending, it stops. `backups/` is git-ignored; copy it to cloud storage, or set `BACKUP_TARGET` to another folder or an `s3://` prefix.

```sh
scripts/backup.sh                         # writes backups/blog-<UTC>.dump and .sha256
scripts/restore.sh backups/<file>.dump    # replaces the whole database, then migrates
uv run --env-file .env python -m blog.maintenance   # due purges, version cleanup, image GC
```

Both scripts default to the Docker Compose database; `--url <DATABASE_URL>` targets any PostgreSQL, passing the password through `PGPASSWORD` rather than the command line. See `docs/local-setup.md` sections 10–13.

## Test

Tests drop and recreate the schema, so point them at a disposable database. The snapshot contract tests run the frontend parser with Node 22, so install the frontend dependencies first:

```sh
docker compose exec db createdb -U blog blog_test
(cd ../frontend && npm ci)
TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest
```

## Sign-in

- One administrator. The password is stored as a salted scrypt hash; `python -m blog.auth` sets or changes it and signs out every session.
- `POST /api/session` with `{"password": …}` (at most 1024 characters) sets an `HttpOnly`, `SameSite=Strict` session cookie. A session ends 3 days after sign-in, or after 1 day unused. Only the SHA-256 of the token is stored. `DELETE /api/session` signs out; `DELETE /api/sessions` signs out every browser.
- Failed sign-ins are counted per client address in the database, before the password is checked. After 5, that address waits 30 seconds, doubling with each further failure up to 15 minutes; it starts again from zero an hour after the last counted attempt. Behind a proxy, uvicorn takes the address from `X-Forwarded-For` only when the proxy's address is in `FORWARDED_ALLOW_IPS` (default `127.0.0.1`); otherwise every browser counts as the proxy and shares one limit. To clear a wait by hand, run `DELETE FROM sign_in_attempts`. At most 2 password checks (about 32 MiB each) run at once; others wait up to 10 seconds, then get 503.
- 更新網站 refuses a new release within 30 seconds of the previous one. Limit request size and rate per address at the proxy as well.
- Requests that change data are refused when their `Origin` header names another site.
- Set `COOKIE_SECURE=1` once the CMS is served over HTTPS.

## Update the site

In the CMS, 網站發布 → 更新網站 (`POST /api/releases`) exports the published content into `CONTENT_REPO_DIR`, pushes it, and starts the `deploy.yml` workflow with that commit. `GET /api/releases` lists releases without calling GitHub. `POST /api/releases/refresh` asks GitHub about each dispatched release's workflow run and records whether it went live, was superseded (a newer commit, or a queued run cancelled by a newer one), or failed; a run not listed within 30 minutes counts as failed. The CMS polls it while a release is in flight. The latest release can be retried when its push, dispatch or build failed, or when it stopped at exported or pushed. A retry follows only a run newer than the failed one.

One release or retry runs at a time (a Postgres advisory lock; a second request gets 409), and git commands time out after 120 seconds. Before exporting, the CMS checks that the content repo's remote branch holds no commit its clone lacks; one that does means another CMS (or a manual push) wrote to it, and the release is refused. Use one CMS at a time ([`docs/local-setup.md`](../docs/local-setup.md), section 12).

| Variable | Purpose |
|---|---|
| `CONTENT_REPO_DIR` | local clone of your content repo with push access |
| `DEPLOY_REPO` | your fork of this repo, e.g. `you/personal-blog`, whose `deploy.yml` a release starts |
| `CMS_GITHUB_TOKEN` | fine-grained token with Actions read/write on `DEPLOY_REPO`; without it or `DEPLOY_REPO` releases stop at "無法啟動部署". `GITHUB_TOKEN` is still read when it is unset |
| `DEPLOY_WORKFLOW`, `DEPLOY_REF`, `GITHUB_API_URL` | defaults `deploy.yml`, `main`, `https://api.github.com` |

## Version retention

After a release goes live, and whenever `blog.maintenance` runs, old Published Versions are deleted when all of these hold: the version is outside the article's newest 3; neither the live release nor any release still in progress contains it; a newer version was published before a release that has gone live; and the article is not pending deletion. Images those versions referenced then fall to the normal 7-day image garbage collection.

## Export a release

The CMS does this as part of 更新網站; the command is for doing it by hand. It writes the current public state into a local clone of `personal-blog-content` as one commit (Addendum 02, PUB-003). Nothing is committed when the published content has not changed.

```sh
uv run python -m blog.exporter ../../personal-blog-content          # commit only
uv run python -m blog.exporter ../../personal-blog-content --push   # commit and push
```

Each article is exported at its latest Published Version, with `published_at` set to its first publication (`articles.first_published_at`, kept through republishing and version retention). Drafts and never-published articles are not exported.

Each export first resets `manifest.json`, `profile.json`, `articles/` and `images/` to HEAD, so files left by an interrupted export are dropped. If 更新網站 fails after the commit but before the release is recorded, pressing it again records the release from HEAD and deploys it.

## About page profile

`GET /api/profile` returns `{revision, content, updated_at}`; `PUT /api/profile` with `{revision, content}` saves it and bumps the revision, or returns 409 with `current_revision` when `revision` is stale. `content` is `name`, `headline`, `intro` (Markdown), `links`, `experience`, `projects` and `site` (`title`, `description`: the site name and description, FE-009; a row without `site` reads as `Personal Blog` with no description); URLs must start with `https://` or `mailto:`. The single row is created by migration 0008. The exporter writes it as `profile.json`, so a profile change alone makes a new release.

## Draft snapshots

Before an Auto Save overwrites the draft, the Markdown it replaces is kept as a snapshot: on the first change of an editing cycle, then at most once per 10 minutes, and immediately for any change of 500 characters or more. Each article keeps its latest 50. Publishing clears them. `GET /api/articles/{doc_id}/snapshots` lists them and `POST /api/articles/{doc_id}/snapshots/{id}/restore` with `base_revision` writes one back through Auto Save, so the content it replaces is snapshotted too.

## Images

`POST /api/images` (multipart `file`) accepts a PNG, JPEG, GIF or WebP up to 10 MB, detected from its bytes. It refuses with 413 an image over 40 million pixels, counting every frame of an animation, or an animation over 300 frames, since decoding holds every pixel in memory. It scales the image down to at most 1440px wide, re-encodes it as WebP (animation kept, EXIF dropped), and returns `![](images/<sha256>.webp)` to put in the Markdown. Uploading the same file again returns the same id. Images uploaded before this change keep their original format. `GET /api/images/{id}` serves it to the editor preview. An article references an image when its Markdown contains an image (inline or reference-style) whose URL starts with `images/`. Text in code, plain links and raw HTML `<img>` do not count. The frontend applies the same rule, and both test suites check it against `frontend/test-fixtures/image-refs.json`. The exporter copies every image the exported articles reference into `images/`, one at a time, and fails without writing anything if one is missing. An image already in the content repo is not read again: its file name is the hash of its bytes.

Garbage collection runs in `blog.maintenance`: once at start-up through `scripts/start.sh`, and on a schedule for a CMS that stays up. An image is deleted once nothing has referenced it for 7 days, counting references from every Working Draft, Draft Snapshot and Published Version, which includes articles pending deletion.

## Draft and publish protocol

| Request | Body | Result |
|---|---|---|
| `POST /api/articles` | `title`, `topic`, `tags`, `markdown` | 201, new `doc_id` at revision 1 |
| `GET /api/articles/{doc_id}/draft` | | current Working Draft |
| `PUT /api/articles/{doc_id}/draft` | draft fields + `base_revision` | Auto Save; 409 with `current_revision` if `base_revision` is stale |
| `POST /api/articles/{doc_id}/publish` | draft fields + `base_revision` | 201, saves the draft and creates the next Published Version in one transaction |

### Lifecycle

| Request | Allowed from | Result |
|---|---|---|
| `GET /api/articles?state=…` | | list, e.g. the Pending Deletion area with `purge_after` |
| `POST /api/articles/{doc_id}/archive` | published | archived; the public URL shows the archive notice |
| `POST /api/articles/{doc_id}/publish` | draft, published, archived | publishing an archived article republishes it under the same `doc_id` |
| `DELETE /api/articles/{doc_id}` | draft, published, archived | Pending Deletion for 30 days; editing and publishing return 409 |
| `POST /api/articles/{doc_id}/restore` | pending deletion | back to the state it had before deletion |
| `POST /api/articles/{doc_id}/purge` | pending deletion | permanent deletion; the `doc_id` is retired and never reused |

Any other transition returns 409. Articles pending deletion for 30 days are purged when the CMS starts.

Publish sends the content the author is looking at, and bumps the revision. An Auto Save sent before the publish therefore arrives with a stale `base_revision` and is rejected instead of overwriting the published content. A database trigger rejects `UPDATE` on `published_versions`.
