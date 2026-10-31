---
name: verify
description: Drive the blog CMS web UI (React SPA served by FastAPI at /admin) in a real browser and capture proof. Use to verify any CMS UI change, check the phone (390px) and desktop (1280px) layouts, or reproduce a CMS bug. Starts a throwaway local CMS on its own database with no GitHub credentials, so it can never publish.
---

# Verify the CMS UI

The CMS is a React SPA (`cms/`) built to `cms/dist` and served by the FastAPI backend (`backend/blog/api.py`) at `/admin/`. Routes are hash routes (`#/`, `#/edit/<doc_id>`, `#/new`, `#/profile`, `#/taxa`, `#/releases`, `#/analytics`; see `cms/src/main.tsx` `parseRoute`). The driver is Playwright from `frontend/node_modules` with its bundled Chromium.

Never drive the author's real CMS (`cms.hackray.dev`, or a local CMS on port 8000). Only drive the instance `launch.sh` started: it reads no `.env`, so it has no GitHub, Cloudflare or AWS settings and cannot publish or reach external services.

## Launch

```sh
.claude/skills/verify/scripts/launch.sh          # restores the newest backend/backups/*.dump
.claude/skills/verify/scripts/launch.sh --empty  # empty database, migrations only
```

- Needs Docker running (the `backend` compose Postgres) and Node on PATH.
- Creates database `blog_verify` (override with `VERIFY_DB`), runs migrations, sets a random throwaway admin password, builds `cms/dist`, and starts uvicorn on `127.0.0.1:8010` (override with `VERIFY_PORT`).
- Ready when it prints `ready at http://127.0.0.1:8010/admin/`: both `/healthz` and the built `/admin/` answer.
- Instance state (pid, url, password, db, `cms.log`) lives in `.audit/verify/instance/` (git-ignored). Only one instance at a time; launch refuses if one exists or the port is taken.
- The build step means a UI change is picked up only by relaunching (or `cd cms && npm run build`; the server serves `cms/dist` from disk, so a rebuild is enough without restarting).

## Doctor

```sh
.claude/skills/verify/scripts/doctor.sh
```

Read-only. Checks that our pid is alive and owns the port, `/healthz` answers, `/admin/` serves the build, and the throwaway password signs in. Prints the cms build time, so a stale build is visible. Run it first whenever anything looks off.

## Drive

Screenshots of every route at phone and desktop width, plus a horizontal-overflow measurement:

```sh
node .claude/skills/verify/scripts/shots.mjs [out-dir] [route ...]
# e.g. node .claude/skills/verify/scripts/shots.mjs .audit/verify/list-cards list taxa
```

- Signs in through `POST /api/session` with the throwaway password (password mode, the same path a fork uses), then loads each route with a full reload. A hash change alone does not re-read the session in the SPA.
- Fails if a route still shows the `登入 CMS` heading.
- Prints `overflow Npx` per shot (`scrollWidth - innerWidth`); exits 1 when any page overflows horizontally.
- Default out-dir is `.audit/verify/<timestamp>/`.

For interactions beyond screenshots, write a short Playwright script next to `shots.mjs` using the same sign-in and reload pattern. Prefer roles and accessible names: the sign-in heading `登入 CMS` (`sign-in.tsx`), the list heading `文章` (`article-list.tsx`), the editor textarea `aria-label="Markdown"` and image input `aria-label="選擇圖片"` (`editor.tsx`). Feature recipes are in `features/`.

## Evidence

- Screenshots and the overflow log go in `.audit/verify/<run>/` and survive cleanup.
- Prove a layout change with before and after shots of the same routes at both widths, and an overflow of 0 at phone width.
- Prove a mutation (save, rename, merge, pin) with the action and a second read of the stored state: reload the page, or `GET` the matching `/api/...` endpoint with the signed-in context.
- Publishing (`網站發布 → 更新網站`) cannot complete here by design: there are no GitHub credentials. Verify only that the UI reports the missing settings; never add credentials to this instance.

## Cleanup

```sh
.claude/skills/verify/scripts/cleanup.sh
```

Stops the pid `launch.sh` recorded (and its child), drops the `blog_verify` database, and removes `.audit/verify/instance/`. Evidence directories are kept. It never kills by process name.
