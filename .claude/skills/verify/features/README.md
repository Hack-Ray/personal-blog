# CMS verification map

The maintained list of user-facing CMS features and how to prove each one. Read it before driving, then use the feature file as the recipe.

## Baseline preconditions

- An instance started by `../scripts/launch.sh`, and `../scripts/doctor.sh` prints `ok`.
- Default data is the newest local backup; `--empty` starts with no articles, so recipes that need an article report that precondition as unmet.
- Never drive the author's CMS (`cms.hackray.dev` or port 8000).

## Driving conventions

- Sign in through `POST /api/session` in the Playwright context, then load each route with a full reload.
- Prefer roles and accessible names over CSS selectors.
- Check every page at phone (390x844) and desktop (1280x800).

## Features

| File | Feature | Route |
| --- | --- | --- |
| [article-list.md](article-list.md) | Article list, pin, archive, delete, pending-deletion view | `#/` |
| [editor.md](editor.md) | Draft editing, autosave, taxonomy pickers, cover, preview, publish | `#/edit/<doc_id>`, `#/new` |
| [taxa.md](taxa.md) | Rename and merge topics, tags, series | `#/taxa` |
| [releases.md](releases.md) | Website update and release history | `#/releases` |
| [profile-analytics.md](profile-analytics.md) | Site and About page settings; traffic and infrastructure | `#/profile`, `#/analytics` |
