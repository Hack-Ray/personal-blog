# CMS

Admin UI for the local CMS: article list with the Pending Deletion area, a split Markdown editor with live preview and Auto Save, and the 網站與關於 page form for the site name, description and About page (saved with an explicit 儲存 button). FastAPI serves the build at `/admin/` (see `backend/README.md`).

```sh
npm ci
npm test         # draft sync, tag parsing and the profile form
npm run build    # typecheck, then write dist/
npm run dev      # Vite dev server; proxies /api to 127.0.0.1:8000
```

`src/draft-sync.ts` owns the Auto Save and Publish protocol (ART-021): one request at a time, each carrying the revision the previous one returned. A 409 stops Auto Save until the author reloads.
