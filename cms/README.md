# CMS

Admin UI for the local CMS: article list with the Pending Deletion area, and a split Markdown editor with live preview and Auto Save. FastAPI serves the build at `/admin/` (see `backend/README.md`).

```sh
npm ci
npm test         # draft sync and tag parsing
npm run build    # typecheck, then write dist/
npm run dev      # Vite dev server; proxies /api to 127.0.0.1:8000
```

`src/draft-sync.ts` owns the Auto Save and Publish protocol (ART-021): one request at a time, each carrying the revision the previous one returned. A 409 stops Auto Save until the author reloads.
