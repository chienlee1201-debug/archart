# 網域設定：Cloudflare 買網域 → 掛到 GitHub Pages

> 以下 `你的網域.com` 全部換成你實際買的網域；`你的帳號` 換成你的 GitHub 帳號名稱。
> 整個流程大約 30 分鐘手動操作，加上等待生效（通常 10 分鐘～1 小時，最久 24 小時）。

---

## 0. 開始前確認

- [ ] GitHub Pages 已經能用 `https://你的帳號.github.io/repo名稱/` 打開正式版首頁
- [ ] repo 是**公開**的（免費版 GitHub Pages 只支援公開 repo）
- [ ] repo 最上層就是 `index.html`（也就是 `arch-real/` 裡面的檔案，不是包著 `arch-real` 資料夾）
- [ ] 手邊有信用卡（Cloudflare 買網域用）

---

## A. 在 Cloudflare 買網域

1. 到 [dash.cloudflare.com](https://dash.cloudflare.com) 註冊／登入。
2. 左側 **Domain Registration → Register Domains**。
3. 搜尋想要的網域 → 選一個 → **Purchase**。
   - Cloudflare 是成本價、沒有隱藏加價；續約價和首年一樣。
   - 聯絡資料要填真實資料（Cloudflare 會自動幫你隱藏，不會公開）。
4. 付款完成後，網域會自動出現在 Cloudflare 首頁的網站清單，DNS 也已經在 Cloudflare，不用另外設定。
5. 收信：Cloudflare 會寄一封**驗證 email** 的信，記得點，不然網域幾週後會被暫停。

---

## B. 在 GitHub 驗證網域（防止別人盜用你的網域）

1. GitHub 右上角頭像 → **Settings** → 左側 **Pages**（在 Code, planning, and automation 區塊下）。
2. **Add a domain** → 輸入 `你的網域.com` → **Add domain**。
3. 畫面會給你一筆 TXT 紀錄，長這樣：
   - 名稱：`_github-pages-challenge-你的帳號`
   - 內容：一串亂碼
4. **先不要關這頁**，到 C 步驟一起加。

---

## C. 在 Cloudflare 設定 DNS

Cloudflare 首頁點你的網域 → 左側 **DNS → Records** → **Add record**，依序加入下面這些：

| 類型 | 名稱 | 內容 | Proxy 狀態 |
|---|---|---|---|
| A | `@` | `185.199.108.153` | **DNS only（灰色雲）** |
| A | `@` | `185.199.109.153` | **DNS only** |
| A | `@` | `185.199.110.153` | **DNS only** |
| A | `@` | `185.199.111.153` | **DNS only** |
| CNAME | `www` | `你的帳號.github.io` | **DNS only** |
| TXT | `_github-pages-challenge-你的帳號` | B 步驟那串亂碼 | （TXT 沒有這選項） |

**重點：Proxy 狀態一定要點成灰色雲（DNS only）。**
新增時預設是橘色雲，要手動點一下切成灰色。橘色會擋住 GitHub 發 HTTPS 憑證，網站會打不開或出現「不安全」。

> `www` 那筆是讓別人打 `www.你的網域.com` 也能連到，GitHub 會自動轉到主網域。
> CNAME 的內容**不要**加 repo 名稱，只寫 `你的帳號.github.io`。

加完後回到 B 步驟的 GitHub 頁面 → 按 **Verify**。顯示綠色勾勾就成功（如果失敗，等 10 分鐘再按一次）。

---

## D. 在 GitHub repo 綁定網域

1. 到 Arch 正式版的 repo → **Settings** → 左側 **Pages**。
2. **Custom domain** 欄位輸入 `你的網域.com`（不要加 `https://`、不要加 `www`）→ **Save**。
3. 等它跑 DNS 檢查，出現 **DNS check successful** 就對了。
4. 勾選下方的 **Enforce HTTPS**。
   - 如果這格是灰的不能勾，代表憑證還在申請中，等 15 分鐘～1 小時再回來勾。
5. 打開 `https://你的網域.com` 確認首頁正常；再試 `https://www.你的網域.com` 會不會自動轉過去。

> GitHub 會在 repo 裡自動產生一個叫 `CNAME` 的檔案，內容就是你的網域。**之後更新網站時不要刪掉它**，刪掉網域就會失效。
> 如果你是用「拖拉上傳」整包覆蓋檔案的方式更新，記得本機也留一份 `CNAME` 檔（內容一行：`你的網域.com`）。

---

## E. 改 Supabase 的網址設定

網域上線後，Google 登入完要導回新網址，不改的話登入後會跳回 localhost 或報錯。

1. [Supabase 後台](https://supabase.com/dashboard) → 選 Arch 正式版專案 → 左側 **Authentication → URL Configuration**。
2. **Site URL** 改成：`https://你的網域.com`
3. **Redirect URLs** → **Add URL**，加入：
   - `https://你的網域.com/**`
   - `https://www.你的網域.com/**`
   - 原本的 `http://localhost:8000/**` **保留**（本機測試還要用）
4. **Save**。

---

## F. 改 Google Cloud 的登入設定

1. [console.cloud.google.com](https://console.cloud.google.com) → 選 Arch 的專案。
2. **Google Auth Platform → 用戶端（Clients）** → 點你建的那個 OAuth 用戶端：
   - **已授權的 JavaScript 來源** → 新增 `https://你的網域.com`（`localhost:8000` 保留）
   - **已授權的重新導向 URI** → **不用改**，維持 Supabase 那個 `https://xxxxxxxx.supabase.co/auth/v1/callback`
   - **儲存**（Google 說最多要 5 分鐘～幾小時生效）。
3. 左側 **品牌塑造（Branding）**：
   - **已授權網域** → 新增 `你的網域.com`
   - **應用程式首頁** 填 `https://你的網域.com`
   - 儲存。
4. 左側 **目標對象（Audience）**：確認狀態是「**實際運作中**」（SETUP.md B-6 做過的話就不用動）。是「測試中」的話，一般人會無法登入。

---

## G. 上線檢查清單

- [ ] `https://你的網域.com` 打得開，網址列有鎖頭
- [ ] `http://你的網域.com`（沒有 s）會自動轉成 https
- [ ] `www.你的網域.com` 會自動轉到主網域
- [ ] 點畫家卡片，`artist.html?slug=...` 頁面正常
- [ ] 用**無痕視窗**、用一個**不是你自己**的 Google 帳號測試登入 → 登入後回到 `你的網域.com`（不是 localhost）
- [ ] 手機打開也正常

---

## 常見問題

| 狀況 | 原因／解法 |
|---|---|
| 網站顯示「不安全」或憑證錯誤 | Cloudflare DNS 是橘色雲 → 改成灰色雲，等 GitHub 重發憑證；或 Enforce HTTPS 還沒勾 |
| GitHub 一直顯示 DNS check 失敗 | DNS 還沒生效，等 10～30 分鐘；確認 4 筆 A 紀錄的數字沒打錯 |
| 打開是 GitHub 的 404 頁 | repo 裡的 `CNAME` 檔不見了，回 D 步驟重新 Save 一次 |
| 登入後跳回 localhost | Supabase 的 Site URL 沒改（E 步驟） |
| 登入出現 `redirect_uri_mismatch` | Google 的「重新導向 URI」被改掉了，要維持 Supabase 的 callback 網址 |
| 登入出現「存取遭封鎖」 | Google 的目標對象還在「測試中」（F-4） |

---

## 給工程的備註

正式版的 Google 登入程式還沒寫（`js/` 裡目前只有 `ui.js`）。之後寫的時候，`signInWithOAuth` 要帶 `redirectTo: location.origin + '/...'`，這樣本機和正式網域都能正確導回，不會全部跳去 Site URL。
