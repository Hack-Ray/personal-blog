# Frontend

Public site: Next.js static export. `deploy.yml` serves it on the repo's GitHub Pages; `out/` is plain static files, so any static host can serve it too.

The build reads a Content Snapshot from `SITE_DATA_DIR` (default: `sample-site-data/`). In `deploy.yml` it is your private content repo (Addendum 02, PUB-002).

```sh
npm ci
npm test            # snapshot contract and content queries
npm run typecheck
npm run build       # copies snapshot images, makes list thumbnails, writes out/
npm run check-links # every site path a built page links to exists in out/
npx playwright install chromium   # once
npm run test:e2e    # browser tests against out/ (sample data)
SITE_DATA_DIR=/path/to/personal-blog-content npm run build
```

## Snapshot format (schema_version 1, draft)

```text
manifest.json
profile.json            optional
articles/{docId}.json
images/{contentHash}.{ext}
```

`manifest.json`:

```json
{
  "schema_version": 1,
  "release_id": "<ULID>",
  "created_at": "<ISO 8601>",
  "articles": [{ "doc_id": "<ULID>", "version": 1 }],
  "archived_articles": [{ "doc_id": "<ULID>" }]
}
```

`articles/{docId}.json` holds `doc_id`, `version`, `title`, `topic` (`slug`, `name`), `tags` (list of `slug`, `name`), `published_at` and `markdown`. Markdown references images as `images/<file>` with image syntax (inline or reference-style); text in code, plain links and raw HTML `<img>` are not references. The backend uses the same rule, checked by `test-fixtures/image-refs.json`. Archived articles have no article file.

`profile.json` is the About page: `name`, `headline`, `intro` (Markdown), `links` (`label`, `url`), `experience` (`role`, `organization`, `period`, `description`) and `projects` (`name`, optional `url`, `description`, `tags`). Links and project URLs must start with `https://` or `mailto:`. A snapshot without it gets the placeholder profile in `src/content/parse.ts`, which matches what the backend seeds.

It also holds `site` (`title`, `description`): the title names the site in page titles, the header, `og:site_name` and the RSS feed; a non-empty description is the default meta description and the feed's channel description (the feed falls back to the title). `site` may be missing and then is `{"title": "Personal Blog", "description": ""}` (Addendum 04 FE-009).

The build fails, and nothing is deployed, when the schema version is unknown, an article file is missing, its `doc_id` or `version` disagrees with the manifest, a docId is listed twice, `profile.json` is malformed, or a referenced image is missing.

## Build settings

| Variable | Default | Set by `deploy.yml` from |
| --- | --- | --- |
| `BASE_PATH` | `/personal-blog` | the repo's Pages URL (`""` for a custom domain or a `<user>.github.io` repo) |
| `SITE_ORIGIN` | `https://example.com` | the repo's Pages URL; used in canonical URLs, the sitemap, RSS and `og:image` |
| `GISCUS_REPO`, `GISCUS_CATEGORY` | `""`, `Announcements` | repository variables, defaulting to this repo and `Announcements` |
| `GISCUS_REPO_ID`, `GISCUS_CATEGORY_ID` | `""` (no comments) | repository variables, from <https://giscus.app> |

## Checking the built site

```sh
GISCUS_REPO_ID=x GISCUS_CATEGORY_ID=x npm run build   # the check expects a comments section
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/personal-blog
(cd /tmp/site && python3 -m http.server 8123) &
scripts/verify-site.sh http://127.0.0.1:8123/personal-blog
```

CI runs the same check, the link check and the browser tests (`e2e/`) on the sample-data build (`.github/workflows/ci.yml`). The deploy workflow runs the link check on the real content too, so an article linking to a missing page or image is not deployed. The checks expect the sample data and the default `BASE_PATH` and `SITE_ORIGIN`, which CI uses whatever the fork's own settings are.
