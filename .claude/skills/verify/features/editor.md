# Editor

Writing and publishing one article: title, topic, tags, series, cover, excerpt, slug, Markdown body with live preview, snapshots, image upload and publish.

## Sub-features

- Autosave status (已儲存 / 未儲存 / 衝突), snapshots (快照), insert image (插入圖片), publish (發布).
- Taxon pickers for Topic, Tags and 系列 (`taxon-picker.tsx`).
- Preview pane rendered from the Markdown textarea (`aria-label="Markdown"`).

## How to get to it (user POV)

From the list, click an article title (`#/edit/<doc_id>`), or `新增文章` (`#/new`).

## Driving it with Playwright

- `node ../scripts/shots.mjs <out> edit new` for the layout.
- Autosave: type into `getByRole('textbox', { name: 'Markdown' })`, wait for `已儲存`, reload, and expect the typed text to remain.

## Gotchas

- 發布 cannot complete on this instance (no GitHub settings); only the confirmation UI can be checked.
- The toolbar is sticky: after scrolling, `發布` must still be inside the viewport (`getBoundingClientRect().top >= 0`). At 390px it wraps to two rows.
