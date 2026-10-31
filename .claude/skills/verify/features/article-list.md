# Article list

The home page of the CMS: every article with its state and the actions pin, archive and delete, plus the navigation to every other page.

## Sub-features

- Navigation buttons: 新增文章, 分類管理, 網站與關於, 網站發布, 流量數據, 登出, 登出所有裝置.
- Filter tabs: 所有文章, 待刪除區.
- Per-article actions: 置頂 / 取消置頂, 封存, 刪除.

## How to get to it (user POV)

Open `/admin/` after signing in. The heading is `文章`.

## Driving it with Playwright

- `node ../scripts/shots.mjs <out> list` for the layout at both widths.
- Pin: click the row's `置頂` button, reload, and expect the `置頂` badge before that title and the button now reading `取消置頂`. Undo with `取消置頂`.

## Gotchas

- With `--empty` there are no rows, so pin/archive/delete cannot be proven; report the unmet precondition.
- Below 640px the page links collapse into `選單` (`aria-expanded`, `nav` named `頁面`); a click outside or Escape closes it. Rows render as cards. Expect overflow 0 at 390px.
