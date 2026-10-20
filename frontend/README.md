# Frontend

Public site: Next.js static export, served by GitHub Pages under `/personal-blog`.

Until the backend export exists, the build reads `content/site.json`. It holds only what the public site may show: published articles and archived ones (docId only). Drafts and deleted articles never appear in it, so their URLs return 404.

```sh
npm ci
npm test            # content model unit tests
npm run typecheck
npm run build       # writes out/
```

To check the built site, serve `out/` under `/personal-blog` and run the checks:

```sh
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/personal-blog
(cd /tmp/site && python3 -m http.server 8123) &
scripts/verify-site.sh http://127.0.0.1:8123/personal-blog
```

Set `BASE_PATH=""` at build time when serving from a custom domain.
