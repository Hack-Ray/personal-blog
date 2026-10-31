# 架構文件

給第一次接觸這個 codebase 的人（包括 AI agent）快速建立整體概念。內容以 2026-10-27 的 `main` 為準，雲端 CMS 的部分更新到 2026-10-31；程式與文件不一致時，以程式為準，決策以 [`docs/design/`](../design/) 為準。

| 文件 | 回答的問題 | 什麼時候讀 |
|---|---|---|
| [`how-it-works.md`](how-it-works.md) | 系統怎麼運作：五個組成部分、請求流程、文章生命週期、從「更新網站」到上線、公開網站建置、CMS 前端、維護與 CI。最後有「新功能該放哪裡」與「容易出錯的地方」。 | 開始改程式之前 |
| [`why.md`](why.md) | 為什麼這樣設計：每個主要決策的書面理由、推論與查不到的部分，決策來源的可信度，以及文件與程式不一致之處。最後有改架構前的 Preserve／Change／Avoid／Risk 清單。 | 想改變架構或推翻某個決策之前 |

建議閱讀順序：先讀 `how-it-works.md` 的「概觀」與「重要概念」，再依要改的部分跳到對應小節；要動到架構時再讀 `why.md`。

## 和其他文件的關係

- [`docs/design/`](../design/)：決策紀錄。Baseline 固定不改，之後的決策寫在 Addendum 01–04。
- [`docs/backlog.md`](../backlog.md)：還沒處理的問題與待決定的事。
- 操作步驟：[`docs/local-setup.md`](../local-setup.md)（本機開發與本機 CMS）、[`docs/fork-and-deploy.md`](../fork-and-deploy.md)（從 fork 到第一篇文章）、[`docs/portable-cms.md`](../portable-cms.md)（API 發布與 GitHub App）。
- 雲端 CMS：[`docs/cloud-ec2.md`](../cloud-ec2.md)（作者的 EC2 與 Cloudflare 做法）、[`docs/cloud-tailscale.md`](../cloud-tailscale.md)（fork 可選的 Tailscale 做法）、[`docs/cms-deployment.md`](../cms-deployment.md)（兩者共用的部署參考）。
- 作者自己的環境：[`docs/maintainer-notes.md`](../maintainer-notes.md)。
- 各子專案的 README（`backend/`、`cms/`、`frontend/`）：該子專案的指令與格式細節。`frontend/README.md` 描述 Content Snapshot 的格式，權威定義是 `frontend/src/content/parse.ts`。

## 維護方式

這兩份文件是某個時間點的導覽，不會自動更新。改變架構的 PR（新的組成部分、改變發布流程、改變 Snapshot 格式、推翻 `why.md` 裡的決策）要一起更新對應的段落。細節以程式為準，不需要每個小改動都同步。
