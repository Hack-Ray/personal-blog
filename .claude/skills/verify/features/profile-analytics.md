# Site settings and analytics

`網站與關於` edits the site name, intro, About page, links, experience and projects. `流量數據` shows Cloudflare traffic, Search Console and the AWS infrastructure section.

## Sub-features

- Profile form with 儲存 and the saved/unsaved status.
- Analytics period tabs (7/28/90 天) and `立即更新`; setup cards when a source is not configured.

## How to get to it (user POV)

From the list, `網站與關於` (`#/profile`) or `流量數據` (`#/analytics`).

## Driving it with Playwright

- `node ../scripts/shots.mjs <out> profile analytics` for the layout.
- Profile save: change the 網站名稱 field, click `儲存`, reload, and expect the new value; restore it afterwards.

## Gotchas

- Analytics sources are unconfigured on this instance by design, so only the setup cards render; the charts need real settings and are not covered here.
- The `網站與關於` toolbar is sticky, so `儲存` stays in the viewport after scrolling.
