# 流量數據：Cloudflare 與 Google Search Console

CMS 的「流量數據」頁（`#/analytics`）顯示公開網站的流量與 Google 搜尋表現。這是選用功能，預設關閉。沒有設定時，頁面只顯示設定說明，CMS 也不會連線到 Cloudflare 或 Google。兩個來源可以只設定其中一個。

## 顯示什麼

| 區塊 | 來源 | 內容 |
|---|---|---|
| Cloudflare 流量 | Cloudflare GraphQL Analytics API | 請求數、頁面瀏覽、不重複訪客、流量（bytes）、快取命中率，以及每日頁面瀏覽與訪客的折線圖 |
| Google 搜尋 | Google Search Console API | 點擊、曝光、點閱率、平均排名，每日點擊與曝光的折線圖，熱門搜尋字詞與熱門頁面各前 10 名 |

期間可選 7、28、90 天，以 UTC 日期計算。台灣時間每天早上 8 點才進入新的 UTC 日期。

數字的限制：

- Cloudflare 的「不重複訪客」是每天依 IP 位址計算的近似值。同一個人換網路會多算，多人共用 IP 會少算。期間總數是每日數字相加，同一人隔天再來會算兩次。
- Cloudflare 的請求數與頁面瀏覽包含部分機器人與爬蟲。
- Search Console 為了保護隱私，不提供很少人搜尋的字詞，所以熱門字詞的點擊加起來會少於總點擊。CMS 另外儲存每日總數，總數不受影響。
- 平均排名以曝光數加權，算法與 Search Console 介面相同。

## 隱私

公開網站沒有加入任何追蹤程式，`frontend/` 沒有改變，讀者的瀏覽器不會連到額外的服務。數字來自 Cloudflare 在 CDN 上原本就會做的統計，以及 Google 原本就有的搜尋報表。CMS 在伺服器端用 API 讀取。

CMS 只儲存每日彙總：每天一列流量數字，以及每天的搜尋總數、各搜尋字詞與各頁面的數字。不儲存 IP、個別訪客或個別請求。資料存在 CMS 的 PostgreSQL，會跟著一般備份一起備份。

## 設定 Cloudflare

前提：網站已經透過 Cloudflare proxy（橘色雲朵），見 [site-domain.md](site-domain.md)。只設定 DNS、沒有開 proxy 時，Cloudflare 看不到流量。

1. 到 Cloudflare dashboard → 右上角頭像 → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**。
2. 權限只給一項：**Zone** → **Analytics** → **Read**。
3. **Zone Resources** 選 **Include** → **Specific zone** → 你的網域（例如 `example.com`）。不要選 All zones。
4. 建立後複製 token。token 只會顯示一次。
5. 回到 dashboard 首頁，點進這個網域的 **Overview**。右側欄（可能要往下捲）的 **API** 區塊有 **Zone ID**，是 32 個英數字。
6. 在 `backend/.env` 加入：

   ```sh
   CLOUDFLARE_API_TOKEN=<token>
   CLOUDFLARE_ZONE_ID=<zone id>
   ```

Free 方案應該也能讀取每日流量（**推測**，依 Cloudflare 文件，未以真實帳號測試）。

## 設定 Google Search Console

前提：網站已經是 Search Console 的資源（property），而且你是擁有者。

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立一個新專案，例如 `blog-analytics`。不需要開啟計費。
2. 在這個專案的 **APIs & Services** → **Library** 搜尋「Google Search Console API」，按 **Enable**。
3. 到 **IAM & Admin** → **Service Accounts** → **Create service account**。名稱自訂；「授予這個服務帳戶專案存取權」與「授予使用者存取權」兩步都跳過，不需要任何角色。
4. 點進建好的服務帳戶 → **Keys** → **Add key** → **Create new key** → **JSON**。瀏覽器會下載一個 JSON 檔。這個檔案就是登入憑證，不要放進 git，也不要傳給別人。
   - 如果畫面說組織政策禁止建立金鑰（`iam.disableServiceAccountKeyCreation`），代表這個 Google 帳號屬於有管理員的組織。用個人帳號建立專案，或請管理員放行。
5. 複製服務帳戶的 email，格式是 `<名稱>@<專案 id>.iam.gserviceaccount.com`。
6. 到 [Search Console](https://search.google.com/search-console) → 選你的資源 → **設定** → **使用者和權限** → **新增使用者**，貼上服務帳戶 email，權限選 **受限**。受限就能讀報表，不需要完整權限。
7. 確認資源的格式，`GSC_SITE_URL` 要和它完全一樣：
   - **網域資源**（左上角只顯示網域）：`sc-domain:example.com`
   - **網址前置字元資源**（顯示完整網址）：`https://example.com/`，包含結尾的 `/`。
8. 把 JSON 檔放到 repo 以外的地方，或放到 `backend/secrets/`（已在 `.gitignore`）：

   ```sh
   mkdir -p backend/secrets
   mv ~/Downloads/<下載的檔名>.json backend/secrets/search-console.json
   chmod 600 backend/secrets/search-console.json
   ```

9. 在 `backend/.env` 加入。路徑建議用絕對路徑；相對路徑以啟動 CMS 時的目錄為準（`scripts/start.sh` 在 `backend/` 啟動）。

   ```sh
   GSC_SITE_URL=sc-domain:example.com
   GSC_CREDENTIALS_FILE=/absolute/path/to/backend/secrets/search-console.json
   ```

用容器執行 CMS 時，把 JSON 檔以唯讀方式掛載進容器，不要放進 image。

## 套用設定

改完 `.env` 後重新啟動 CMS（`scripts/start.sh`）。設定是成對的：只設定 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ZONE_ID` 其中一個、或只設定 `GSC_SITE_URL` 或 `GSC_CREDENTIALS_FILE` 其中一個時，CMS 不會啟動，錯誤訊息會指出缺少哪一個。Zone ID 格式不對、`GSC_SITE_URL` 格式不對、JSON 檔不存在或讀不到，也會在啟動時報錯。

想關閉某個來源，把那一對設定一起刪掉或註解掉再重新啟動。已經抓到的數字會留在資料庫，但頁面不再顯示。

## 何時更新

沒有排程器。開啟「流量數據」頁時，若某個已設定的來源距離上次成功更新超過 6 小時，頁面會先顯示資料庫裡的數字，同時在背景向 Cloudflare 與 Google 抓新資料，完成後重新顯示。按「立即更新」則不管多久前更新過，都會重新抓一次。切換 7／28／90 天只讀資料庫。

| 來源 | 第一次 | 之後每次 | 資料延遲 |
|---|---|---|---|
| Cloudflare | 最近 30 天 | 從上次成功更新那天的前 2 天到今天 | 幾分鐘內；今天的數字到 UTC 午夜前都會再增加 |
| Search Console | 最近 90 天 | 從上次成功更新那天的前 9 天到今天（天天開的話就是最近 10 天） | 約 2–3 天；最近幾天的數字之後還會變動 |

每次更新都會覆蓋重抓的日期，所以重複更新不會重複計算。Search Console 會先刪掉重抓期間內的字詞與頁面數字再寫入，之後不再出現的字詞不會留下來。一個來源失敗不影響另一個。同時有兩次更新時，後來的那次直接略過。

所以第一次設定 Cloudflare 時只看得到最近 30 天。90 天的圖要等之後累積。

## 疑難排解

更新失敗時，頁面上方會顯示錯誤訊息，以及最後一次成功更新的時間，下面仍顯示當時的資料。錯誤訊息不會包含 token。

| 錯誤訊息 | 原因與處理 |
|---|---|
| `Cloudflare API returned HTTP 400`、`HTTP 401` 或 `HTTP 403` | token 錯誤、過期、被刪除，或權限不是 Zone → Analytics → Read。重新建立 token 並更新 `.env` |
| `Cloudflare found no zone with CLOUDFLARE_ZONE_ID that this token can read` | Zone ID 填錯，或 token 的 Zone Resources 沒有包含這個網域 |
| `Cloudflare GraphQL error: ...` | Cloudflare 拒絕查詢。冒號後面是 Cloudflare 的原文，常見是方案不支援某個資料集、查詢範圍太長，或 token 沒有這個 zone 的權限 |
| `Cloudflare API is unreachable or timed out` | 網路問題，稍後按「立即更新」 |
| `GSC_CREDENTIALS_FILE is not a readable service account JSON key` | 檔案不是服務帳戶的 JSON 金鑰（例如下載成 OAuth client 的檔案），或內容不完整。重新下載第 4 步的金鑰 |
| `The private key in GSC_CREDENTIALS_FILE could not sign a token` | JSON 裡的 `private_key` 被改壞了。重新下載金鑰 |
| `Google token endpoint returned HTTP 400: invalid_grant: ...` | 金鑰已被刪除或停用，或電腦時間差太多。確認系統時間正確，必要時建立新金鑰 |
| `Search Console API returned HTTP 403: User does not have sufficient permission for site ...` | 服務帳戶沒有加入這個資源，或 `GSC_SITE_URL` 和資源格式不一致（`sc-domain:` 與網址前置字元是不同資源，網址結尾要有 `/`） |
| `Search Console API returned HTTP 403: ... has not been used in project ... or it is disabled` | 專案沒有啟用 Google Search Console API（第 2 步）。啟用後等幾分鐘再試 |
| `Search Console API is unreachable or timed out` | 網路問題，稍後再試 |
| CMS 啟動時 `CLOUDFLARE_ZONE_ID must be set when CLOUDFLARE_API_TOKEN is set` 這類訊息 | 一對設定只填了一個。補上另一個，或兩個都刪掉 |

Search Console 剛加入服務帳戶、或網站剛加入 Search Console 時，可能好幾天都沒有資料。頁面會顯示「這段期間還沒有資料」，這不是錯誤。

## 測試

後端測試用本機的假 API 伺服器取代 Cloudflare 與 Google（`backend/tests/test_analytics.py`），不會連到外部。真實 API 的回應格式依各自的官方文件實作，沒有在 CI 驗證。
