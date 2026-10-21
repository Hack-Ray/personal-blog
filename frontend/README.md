# Frontend

Public site: Next.js static export, served by GitHub Pages under `/personal-blog`.

The build reads a Content Snapshot from `SITE_DATA_DIR` (default: `sample-site-data/`). In CI it is the private `personal-blog-content` repo (Addendum 02, PUB-002).

```sh
npm ci
npm test            # snapshot contract and content queries
npm run typecheck
npm run build       # copies snapshot images, writes out/
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

`profile.json` is the About page: `name`, `headline`, `intro` (Markdown), `links` (`label`, `url`), `experience` (`role`, `organization`, `period`, `description`) and `projects` (`name`, optional `url`, `description`, `tags`). Links and project URLs must start with `https://` or `mailto:`. A snapshot without it gets the default profile in `src/content/parse.ts` (name and GitHub link), which matches what the backend seeds.

It also holds `site` (`title`, `description`): the title names the site in page titles, the header, `og:site_name` and the RSS feed; a non-empty description is the default meta description and the feed's channel description (the feed falls back to the title). `site` may be missing and then is `{"title": "Personal Blog", "description": ""}` (Addendum 04 FE-009).

The build fails, and nothing is deployed, when the schema version is unknown, an article file is missing, its `doc_id` or `version` disagrees with the manifest, a docId is listed twice, `profile.json` is malformed, or a referenced image is missing.

## Checking the built site

```sh
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/personal-blog
(cd /tmp/site && python3 -m http.server 8123) &
scripts/verify-site.sh http://127.0.0.1:8123/personal-blog
```

CI runs the same check on the sample-data build (the `Check the built site` step in `.github/workflows/ci.yml`). The checks expect the sample data, the `/personal-blog` basePath and the default `SITE_ORIGIN`.

Set `BASE_PATH=""` at build time when serving from a custom domain.
