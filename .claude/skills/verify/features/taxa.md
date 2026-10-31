# Taxonomy management

Rename topics, tags and series, and merge one into another, with the number of drafts using each.

## Sub-features

- Rename: edit the name field, then `改名`.
- Merge: choose a target in `合併到…`, then `合併`.

## How to get to it (user POV)

From the list, `分類管理` (`#/taxa`).

## Driving it with Playwright

- `node ../scripts/shots.mjs <out> taxa` for the layout.
- Rename: change a name, click `改名`, reload, and expect the new name; `GET /api/taxa` shows it too. Rename it back.

## Gotchas

- Below 640px each taxon is a card (name and 改名, then slug, 篇數, merge). Expect overflow 0 at 390px.
