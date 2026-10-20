# Backend

Local CMS API (FastAPI + PostgreSQL), per Addendum 01 (ART-020, ART-021) and Addendum 02 (PUB-001).

> **No authentication yet.** Bind only to `127.0.0.1` until admin login exists (Baseline 5.1).

## Run locally

```sh
docker compose up -d                 # PostgreSQL 16 on 127.0.0.1:5432
uv sync
export DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog
uv run alembic upgrade head
(cd ../cms && npm ci && npm run build)   # CMS UI, served at /admin/
uv run uvicorn blog.api:app --host 127.0.0.1 --port 8000
```

CMS: http://127.0.0.1:8000/admin/ · API docs: http://127.0.0.1:8000/docs

## Test

Tests drop and recreate the schema, so point them at a disposable database:

```sh
docker compose exec db createdb -U blog blog_test
TEST_DATABASE_URL=postgresql+psycopg://blog:blog@127.0.0.1:5432/blog_test uv run pytest
```

## Export a release

Writes the current public state into a local clone of `personal-blog-content` as one commit (Addendum 02, PUB-003). Nothing is committed when the published content has not changed.

```sh
uv run python -m blog.exporter ../../personal-blog-content          # commit only
uv run python -m blog.exporter ../../personal-blog-content --push   # commit and push
```

Each article is exported at its latest Published Version, with `published_at` set to its first publication. Drafts and never-published articles are not exported.

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
