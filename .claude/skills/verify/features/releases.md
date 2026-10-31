# Website releases

Start a website update and read the release history with each run's status.

## Sub-features

- `更新網站` button, status banner, release table (時間, 狀態, 說明 with the GitHub Actions link).

## How to get to it (user POV)

From the list, `網站發布` (`#/releases`).

## Driving it with Playwright

- `node ../scripts/shots.mjs <out> releases` for the layout.

## Gotchas

- This instance has no GitHub settings, so `更新網站` must report the missing configuration; never add credentials to make it pass.
- Below 640px each release is a card with a `狀態：` label.
