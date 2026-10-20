# Backend

Local CMS API (FastAPI + PostgreSQL), per Addendum 01 (ART-020, ART-021) and Addendum 02 (PUB-001).

Every `/api/*` route except `/api/session` needs a signed-in admin. Keep binding to `127.0.0.1` while the CMS runs locally.

## Run locally

Step-by-step guide (Docker, first run, daily use, backup and restore): [`docs/local-setup.md`](../docs/local-setup.md).

```sh
cp .env.example .env                 # then fill in CONTENT_REPO_DIR and GITHUB_TOKEN
docker compose up -d                 # PostgreSQL 16 on 127.0.0.1:5432
uv sync
uv run --env-file .env alembic upgrade head
uv run --env-file .env python -m blog.auth   # set the admin password (asked twice, 12+ characters)
(cd ../cms && npm ci && npm run build)       # CMS UI, served at /admin/
uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

`--env-file .env` loads the settings; the backend itself reads only environment variables.

CMS: http://127.0.0.1:8000/admin/ · API docs: http://127.0.0.1:8000/docs

## Backup and restore

`scripts/start.sh` (the normal way to start the CMS) starts the database, takes a backup, applies migrations and runs the server. `backups/` is git-ignored; copy it to cloud storage.

```sh
scripts/backup.sh                         # writes backups/blog-<UTC>.dump and .sha256
scripts/restore.sh backups/<file>.dump    # replaces the whole database, then migrates
```

Both default to the Docker Compose database; `--url <DATABASE_URL>` targets any PostgreSQL. See `docs/local-setup.md` sections 10–13.

## Test

Tests drop and recreate the schema, so point them at a disposable database:

```sh
docker compose exec db createdb -U blog blog_test
TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest
```

## Sign-in

- One administrator. The password is stored as a salted scrypt hash; `python -m blog.auth` sets or changes it and signs out every session.
- `POST /api/session` with `{"password": …}` sets an `HttpOnly`, `SameSite=Strict` session cookie valid for 7 days. Only the SHA-256 of the token is stored. `DELETE /api/session` signs out.
- Five wrong passwords in a row lock sign-in for 15 minutes.
- Requests that change data are refused when their `Origin` header names another site.
- Set `COOKIE_SECURE=1` once the CMS is served over HTTPS.

## Update the site

In the CMS, 網站發布 → 更新網站 (`POST /api/releases`) exports the published content into `CONTENT_REPO_DIR`, pushes it, and starts the `deploy.yml` workflow with that commit. `GET /api/releases` reads each pending release's workflow run from GitHub and records whether it went live, was superseded by a newer commit, or failed. The latest release can be retried when its push, dispatch or build failed.

| Variable | Purpose |
|---|---|
| `CONTENT_REPO_DIR` | local clone of `personal-blog-content` with push access |
| `GITHUB_TOKEN` | fine-grained token with Actions read/write on `personal-blog`; without it releases stop at "無法啟動部署" |
| `DEPLOY_REPO`, `DEPLOY_WORKFLOW`, `DEPLOY_REF`, `GITHUB_API_URL` | defaults `Hack-Ray/personal-blog`, `deploy.yml`, `main`, `https://api.github.com` |

## Version retention

After a release goes live, and at CMS start-up, old Published Versions are deleted when all of these hold: the version is outside the article's newest 3; neither the live release nor any release still in progress contains it; a newer version was published before a release that has gone live; and the article is not pending deletion. Images those versions referenced then fall to the normal 7-day image garbage collection.

## Export a release

The CMS does this as part of 更新網站; the command is for doing it by hand. It writes the current public state into a local clone of `personal-blog-content` as one commit (Addendum 02, PUB-003). Nothing is committed when the published content has not changed.

```sh
uv run python -m blog.exporter ../../personal-blog-content          # commit only
uv run python -m blog.exporter ../../personal-blog-content --push   # commit and push
```

Each article is exported at its latest Published Version, with `published_at` set to its first publication. Drafts and never-published articles are not exported.

## Draft snapshots

Before an Auto Save overwrites the draft, the Markdown it replaces is kept as a snapshot: on the first change of an editing cycle, then at most once per 10 minutes, and immediately for any change of 500 characters or more. Each article keeps its latest 50. Publishing clears them. `GET /api/articles/{doc_id}/snapshots` lists them and `POST /api/articles/{doc_id}/snapshots/{id}/restore` with `base_revision` writes one back through Auto Save, so the content it replaces is snapshotted too.

## Images

`POST /api/images` (multipart `file`) stores a PNG, JPEG, GIF or WebP up to 10 MB, detected from its bytes, and returns `![](images/<sha256>.<ext>)` to put in the Markdown. Uploading the same bytes again returns the same id. `GET /api/images/{id}` serves it to the editor preview. The exporter copies every image the exported articles reference into `images/`, and fails without writing anything if one is missing.

Garbage collection runs at CMS start-up. An image is deleted once nothing has referenced it for 7 days, counting references from every Working Draft, Draft Snapshot and Published Version, which includes articles pending deletion.

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
