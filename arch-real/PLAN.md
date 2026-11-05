# Arch 正式版規劃（v0.2）

> 2026-11-03 建立。這份文件確認後才開始寫程式；之後的修改都記在最後的「變更紀錄」。

## 0. 已確定的決定

| 項目 | 決定 |
|---|---|
| 誰可以登入 | 收藏家、畫家、管理者都用同一套 Google 登入；管理者是「列在 admins 名單裡的帳號」，登入後選單多出「管理後台」。Supabase 的 Email／密碼登入關閉（2026-11-04 決定） |
| 登入方式 | Google 登入（Supabase Auth） |
| 訪客模式 | 要。不登入也能逛完整個網站 |
| 與 demo 的關係 | `arch-site` 維持運作不動；正式版放在 `arch-real`，使用**新的 Supabase 專案** |
| 許願內容 | 只有文字，不能附照片 |
| 畫家提案 | 只有文字，並附上連到該畫家頁的連結；提案內容公開，預估價格只給許願者看 |
| 作品數量 | 每位畫家 1–9 件 |
| 技術做法 | 沿用 demo：純 HTML／CSS／JS＋Supabase，不需安裝額外工具 |

---

## 1. 角色與能做的事

一個 Google 帳號登入後預設是**收藏家**。想當畫家的人，用同一個帳號點「成為畫家」、填資料與上傳作品（可存草稿），送出後由管理者審核，通過即上架、**同時**具有畫家身分（不用另開帳號）；未通過會退回「需修改」並附審核備註。不需要邀請碼。

| 能做的事 | 訪客 | 收藏家 | 畫家 | 管理者 |
|---|:-:|:-:|:-:|:-:|
| 瀏覽畫家、作品、作品探索、許願牆、搜尋 | ✓ | ✓ | ✓ | ✓ |
| 收藏作品／畫家 | 暫存在瀏覽器，登入後自動搬進帳號 | ✓ | ✓ | ✓ |
| 對作品或畫家送出詢問 | 按下時跳出 Google 登入 | ✓ | ✓ | ✓ |
| 在許願牆許願 | 按下時跳出 Google 登入 | ✓ | ✓ | ✓ |
| 編輯自己的畫家頁與作品 | | | ✓ | |
| 看收到的詢問 | | | ✓ | |
| 對許願提案 | | | ✓ | |
| 審核畫家、許願、提案 | | | | ✓ |

**訪客模式的原則：** 看東西不用登入；要「留下資料」或「聯絡人」的動作才請對方登入，而且是在按下那一刻才跳出，登入完自動回到原本的頁面繼續。

---

## 2. 資料庫設計

延續 demo 的做法：所有資料表開啟 RLS（列級權限），前台只能讀到該讀的資料。✱ 表示 demo 已有、正式版調整；★ 表示新增。

### 2.1 帳號

**★ profiles（每個登入過的人一筆）**
| 欄位 | 說明 |
|---|---|
| id | 對應 Google 登入後的使用者 ID |
| display_name / avatar_url | 預設帶入 Google 名稱與大頭貼，可自行修改 |
| email | Google 信箱，**不公開**，只有本人與管理者看得到 |
| created_at | |

**✱ admins**：沿用。

### 2.2 畫家與作品

**✱ artists**
| 變更 | 說明 |
|---|---|
| ＋ user_id | 連到 profiles，一個帳號最多一個畫家頁（unique）。**可為空**：從 demo 搬來、還沒認領的畫家先空著，認領後才填入（見第 5 節） |
| ＋ slug | 畫家頁網址：`artist.html?slug=lin-tsai-wei`（GitHub Pages 做不到 `/artist/lin-tsai-wei` 這種網址）。限小寫英文、數字和 -。**草稿可空，送出審核時必填** |
| ✱ edit_token | 改用登入編輯，不再當修改連結。搬家期間當**認領碼**用：改成**可為空**，認領成功後清空，連結即失效（見第 5 節） |
| ＋ claimed_at | 認領完成的時間（demo 搬來的畫家才有）；管理後台用來看誰還沒認領 |
| ＋ 狀態「草稿」 | 點「成為畫家」後先是草稿，在畫家後台填完資料與作品再送出審核（草稿／待審核／已上架／需修改） |
| ＋ referral_source | 你從哪裡知道 Arch（選填），值限 `threads`／`instagram`／`friend`／`other`；申請頁 apply.html 選的值在建立草稿畫家頁時存入；管理後台畫家清單顯示為「來源」 |
| ＋ admin_edited_at | 管理者在正式版改過這位畫家任何資料的時間（編輯、審核、重新產生認領連結、綁定帳號都會填）。有值時 demo 同步整個跳過這位畫家（2026-11-05） |
| － invite_code | 不再使用（正式版取消邀請碼） |
| 其他欄位 | 沿用：姓名、標籤、一句話介紹、創作故事、頭像、公開 Email／IG、是否接受客製、審核備註、排序 |

**✱ works**
| 變更 | 說明 |
|---|---|
| ✱ medium | 改成固定選項（必填，下拉選單）：油畫、壓克力、水彩、膠彩、水墨、色鉛筆、粉彩、素描、版畫、複合媒材、電繪、其他。膠彩包含礦物顏料；素描包含鉛筆、炭筆 |
| ＋ support | 畫在什麼上（選填）：畫布、紙、木板、麻紙／絹、其他；媒材是「電繪」時為空。網站顯示為「媒材・底材」（例如「水彩・紙」），沒有底材就只顯示媒材。列表卡片（首頁、找畫家、畫家頁、我的帳號等）上底材為「麻紙／絹」時省略、只顯示媒材；作品詳細頁一律顯示完整（例如「膠彩・麻紙／絹」） |
| ＋ status | 可購買／已售出／非賣品 |
| ＋ year | 創作年份（選填） |
| ＋ description | 作品說明（選填） |
| ＋ image_w / image_h | 作品圖片的像素寬高，上傳時由瀏覽器讀出後存入（2026-11-05） |
| 作品數量 | demo 限 1–4 件，正式版放寬到 1–9 件 |

**★ artist_revisions（已上架畫家的待審核修改，2026-11-05）**
| 欄位 | 說明 |
|---|---|
| artist_id | 哪位畫家。一位畫家同時最多一筆還沒結案的修改 |
| data | 整份畫家資料＋作品清單的快照（jsonb）；作品有 id 的是改舊作品，沒有 id 的是新增 |
| status | 修改中（還沒送出）／審核中／退回／已核准（已核准的留作紀錄） |
| review_note | 退回時的審核備註，畫家在畫家後台看得到 |

**審核規則（2026-11-05）**
- 還沒上架（草稿／需修改／待審核）：畫家改的內容直接存進 artists／works，按「送出審核」後變成待審核。
- 已上架的畫家自己修改：**網站繼續顯示舊版**，修改存成 artist_revisions。管理者核准 → 套用到 artists／works；退回 → 舊版不變，附審核備註。畫家在後台看得到「修改審核中」或退回備註，可以繼續編輯待審的版本，也可以「放棄修改」回到網站上的版本。
- 管理者改的直接生效，不用審核（同一個畫家後台 `studio.html?artist=<id>`，頂部顯示「你正在以管理者身分編輯 ○○○」）。
- 送出審核時檢查：姓名、網址必填，至少 1 件作品，每件作品都要有圖片（其他欄位照 2026-11-04 決定暫不必填）。
- 前台對 artists／works／artist_revisions 沒有直接寫入權限，一律走 `sql/02_artists.sql` 的 security definer 函式。

**圖片（Storage bucket `arch-images`，2026-11-05）**：公開讀取；只收 JPG／PNG／WebP、每張 5MB 內（太大的圖瀏覽器會先縮到長邊 3000px）；路徑「畫家 id/檔名」，畫家只能上傳到自己的資料夾，管理者全部可以；不開放覆蓋，每次上傳都是新檔名。圖片網址只接受上傳到這位畫家資料夾的檔案，或原本就有的網址（例如 demo 搬來的）。

~~**✱ invite_codes**~~：**不再使用**。正式版取消邀請碼，任何登入的人都能申請成為畫家，由管理者審核把關（2026-11-04 決定）。

### 2.3 收藏家互動

**★ favorites（收藏）**：誰、收藏了哪件作品或哪位畫家、時間。

**★ inquiries（詢問）**
| 欄位 | 說明 |
|---|---|
| from_user_id | 誰問的 |
| artist_id / work_id | 問哪位畫家、哪件作品（作品可空） |
| message | 詢問內容 |
| status | 新的／已讀／已回覆 |
| contact_email | 送出當下自動抄一份詢問者的 Google 信箱，給被詢問的那位畫家回信用 |

畫家在自己的後台看到詢問與對方 Email，**後續在平台外聯絡**。

**收藏家 Email 的規則**：平常不公開，只有本人與管理者看得到；只有在收藏家**主動送出詢問**、或**選定某位畫家的提案**時，才把 Email 給那一位畫家。送出按鈕旁要寫清楚這件事。這不是聊天室（符合 MVP「不做聊天」），但每一筆詢問都會留下紀錄，可以直接算出第一階段最重要的指標「詢問率」。

### 2.4 許願牆

**★ wishes（許願）**
| 欄位 | 說明 |
|---|---|
| user_id | 誰許的願 |
| title | 標題（選填）；沒填時畫面上取故事的前幾個字當標題 |
| story | 想畫的畫面或故事（純文字，不能附照片） |
| tags / occasion | 題材標籤、場合（生日、紀念、喬遷…） |
| budget_min / budget_max | 預算（選填） |
| show_name | 公開時顯示名字或「匿名收藏家」 |
| status | 待審核／公開中／已結案／未通過 |

**★ proposals（畫家提案）**
| 欄位 | 說明 |
|---|---|
| wish_id / artist_id | 哪位畫家對哪個願望提案（每位畫家對同一個願望只能提一次） |
| message | 想怎麼畫（純文字，不能附圖） |
| price_estimate | 預估價格（選填，**只有許願者看得到**） |
| status | 待審核／公開中／被選中／未通過。新增時一定是「待審核」，管理者通過後才公開 |

提案在許願牆上顯示為：畫家名字（連到畫家頁）＋提案文字。許願者選定提案後，那位畫家才會拿到許願者的 Email。

### 2.5 沿用

**✱ feedback**（「留下你的想法」問卷）：沿用。

---

## 3. 頁面清單

| 頁面 | 誰會用 |
|---|---|
| 首頁 | 所有人 |
| 畫家列表＋搜尋（依風格、媒材、價格、是否接受客製；媒材選項同 works.medium 的 12 個值） | 所有人 |
| 畫家頁 | 所有人 |
| 作品頁 | 所有人 |
| 作品探索：照真實尺寸比例排列的作品牆。桌機／平板隨機 10 幅、共用同一個比例尺排滿一個畫面，可「重新推薦」換一批；手機一次一幅，左滑隨機下一幅、右滑回上一幅。已售出／非賣品照常出現並加標籤 | 所有人 |
| 許願牆、單一願望頁 | 所有人 |
| 登入（Google） | 所有人 |
| 我的帳號：收藏、我的詢問、我的許願與收到的提案 | 收藏家 |
| 畫家後台：編輯資料與作品、收到的詢問、對許願提案 | 畫家 |
| 申請成為畫家（登入後直接填資料，送出審核） | 收藏家 → 畫家 |
| 認領畫家頁：demo 搬來的畫家用專屬連結登入並綁定（見第 5 節） | demo 的畫家 |
| 管理後台：審核畫家、許願、提案；問卷；數據；畫家認領狀態與手動綁定 | 管理者 |

---

## 4. 開發順序

依你的要求，先把**登入**和**完整的資料庫**做好，畫面再一塊一塊接上。

| 階段 | 內容 | 完成時你可以 |
|---|---|---|
| 1. 地基 | 新 Supabase 專案、第 2 節全部資料表與權限（artists 的 `user_id`、`edit_token` 可為空，加 `claimed_at`，供第 5 節認領用）、Google 登入、profiles 自動建立 | 用 Google 登入，看到自己的帳號頁 |
| 2. 畫家 | 申請成為畫家、畫家後台（資料與作品）、管理者審核、公開畫家頁與作品頁；作品探索頁改成從 works 隨機抽取（只抽已上架畫家、有寬高的作品，換掉 `js/explore.js` 的 `getWorks()`）；**認領流程**：認領頁 `claim.html`、管理後台的認領狀態與手動綁定（第 5 節）；做完後**試搬一次** demo 資料測試認領 | 畫家自己上架，你審核；舊畫家能認領自己的畫家頁 |
| 3. 收藏家 | 收藏（含訪客暫存）、詢問、搜尋（找畫家頁的媒材、風格、價格等篩選功能在此階段實作，現在只有選項外觀） | 收藏家逛、收藏、詢問 |
| 4. 許願牆 | 許願、審核、畫家提案、許願者看提案 | 完整的許願牆 |
| 5. 上線 | 從 demo 正式搬資料（先停 demo 修改功能）、發認領連結給舊畫家、Email 通知（新詢問、新提案）、網域 | 正式上線 |

每個階段做完都可以實際操作驗收，再進下一階段。

---

### 3.1 檔案結構（2026-11-03 已建立 HTML／CSS 骨架，內容為示範資料）

| 檔案 | 頁面 |
|---|---|
| `index.html` | 首頁 |
| `artists.html` | 找畫家（看畫家／看作品＋篩選；媒材篩選選項同 works.medium） |
| `artist.html` | 畫家頁（`?slug=`） |
| `work.html` | 作品頁（`?id=`） |
| `explore.html` | 作品探索（樣式 `css/explore.css`、程式 `js/explore.js`） |
| `wishes.html` | 許願牆＋許願對話框 |
| `wish.html` | 單一願望＋提案（`?id=`） |
| `login.html` | Google 登入 |
| `account.html` | 我的帳號 |
| `apply.html` | 申請成為畫家（來源選填＋原創聲明，之後進畫家後台填資料） |
| `studio.html` | 畫家後台 |
| `claim.html` | 認領畫家頁（`?token=`，demo 搬來的畫家用；2026-11-05 建立，程式 `js/claim.js`） |
| `admin.html` | 管理後台 |
| `css/tokens.css` | 顏色、字體、間距等設計變數（沿用 demo 黑白風格） |
| `css/base.css` | Reset、基本排版、無障礙 |
| `css/layout.css` | 容器、頂部導覽、頁尾、格線、側欄版型 |
| `css/components.css` | 按鈕、卡片、表單、狀態標示、對話框、表格等共用元件 |
| `css/pages.css` | 各頁專屬版型 |
| `js/ui.js` | 純介面行為：開關對話框、收起選單（不碰資料） |
| `js/site-chrome.js` | 頁首、頁尾、登入提示對話框（純介面） |
| `js/config.js` | Supabase 的 Project URL 與 Publishable key（公開值） |
| `js/auth.js` | Google 登入、登出、按下才登入（`data-login-reason`）、需登入的頁面 |
| `js/db.js` | 資料存取（所有讀寫資料庫的地方） |
| `js/login.js`、`js/account.js` | 登入頁、我的帳號 |
| `js/cards.js` | 公開頁面共用的畫面工具（純介面）：作品／畫家卡片、媒材・價格・尺寸格式、頭像規則 `ArchAvatar`、載入中／沒有資料／讀取失敗狀態 |
| `js/home.js`、`js/artists.js`、`js/artist.js`、`js/work.js` | 首頁、找畫家、畫家頁、作品頁的資料填入（資料都透過 `db.js` 讀取） |
| `js/apply.js`、`js/studio.js`、`js/admin.js`、`js/claim.js` | 申請成為畫家、畫家後台（資料、作品、圖片上傳）、管理後台的「畫家」分頁、認領頁 |
| `sql/01_foundation.sql` | 階段 1 資料庫：9 張表、權限、公開檢視表、profiles 自動建立（在 Supabase SQL Editor 執行，不用上傳到網站） |
| `sql/02_artists.sql` | 階段 2 資料庫：admin_edited_at、作品圖片寬高、artist_revisions、畫家後台／認領／審核／綁定的函式、Storage bucket 與上傳權限（在 01 之後執行） |
| `sql/sync/` | demo → 正式版資料同步（匯出、設定、匯入三個 SQL；步驟見 `SYNC.md`）。對照表與同步函式放在不對前台公開的 `migrate` schema |

- 單一 RWD 版面，手機與桌機共用同一份 HTML（demo 是兩份）。
- 頁首與頁尾（12 頁共用）由 `js/site-chrome.js` 統一產生（2026-11-04 起），改導覽列只要改這一個檔案。每頁用 `<body data-page="…">` 標出自己是哪一頁。
- 標了 `data-auth="guest|user"`、`data-role="artist|admin"`、`data-slot="…"`、`data-view="…"` 的地方，是之後程式要依登入狀態切換或填入資料的位置。

---

## 5. 從 demo 搬資料

demo 的畫家沒有 Google 帳號，所以先把資料搬過來，再由畫家自己「認領」：用原本的修改連結登入，把畫家頁綁到自己的 Google 帳號。

### 5.1 搬資料

| 項目 | 做法 |
|---|---|
| 怎麼搬 | demo 的 SQL Editor 跑查詢，把資料匯出成一段 JSON → 貼到正式版 SQL Editor 跑匯入 SQL。不需要任何金鑰。**已做好**：`sql/sync/` 三個檔＋步驟說明 [SYNC.md](SYNC.md)；可重複執行，同一份資料重跑不會重複新增；整批在一個交易裡，任一筆不符合正式版限制就全部取消並列出哪位畫家、哪個欄位 |
| 畫家 | 原樣搬（沿用 demo 的畫家 id、作品 id），`user_id` 空著，`edit_token` 照搬（當認領碼），`invite_code` 不搬。**已認領的畫家（user_id 不為空）和管理者在正式版改過的畫家（admin_edited_at 不為空）同步時整個跳過**，以正式版為準；未認領的每次同步都改成和 demo 一樣；demo 已經沒有的畫家只在報告列出，不自動刪除 |
| 畫家狀態 | approved → 已上架、pending → 待審核、rejected → 需修改（審核備註一起搬） |
| slug | demo 沒有，用 slug 對照表 `migrate.slug_map`（demo 畫家 id → slug，已預填已上架畫家）；表裡沒有的先用 `artist-`＋id 前 8 碼，新畫家同步時自動加進對照表讓你填 |
| 作品媒材 | demo 是自由文字（例如「壓克力・畫布」），用媒材對照表 `migrate.medium_map`（原文 → medium＋support，Table Editor 可編輯，已預填建議）換算；對不上的 medium 先留空、報告列為「待對照」，新出現的原文自動加進對照表 |
| 作品新欄位 | status 預設「可購買」，year、description 留空（之後同步不改這三欄） |
| 圖片 | 試搬期間先沿用 demo 的圖片網址（demo 專案不能刪或暫停）。正式搬時從 demo Storage 下載、上傳到正式版 Storage 的同一路徑，再用 SQL 把網址換成新專案 |
| 問卷 feedback | 照搬，id 已經有的略過 |
| 邀請碼、admins | 不搬；管理者在新專案重新設定 |

**搬兩次**：階段 2 做完先**試搬**，用真實資料測試認領；開站前**正式搬**（清掉試搬資料重來），正式搬之前先停用 demo 的「修改資料」功能，避免畫家在 demo 改了卻沒搬到。

### 5.2 認領流程

1. 管理後台列出「還沒認領」的畫家，每位都有「複製認領連結」：`claim.html?token=<edit_token>`。你私訊給畫家。
2. 畫家打開連結 → 頁面顯示他的名字、頭像、作品縮圖，問「這是你的畫家頁嗎？」→ 按「用 Google 登入並認領」。
3. 登入回來後自動完成認領：`user_id` 填入他的帳號、`claimed_at` 記時間、`edit_token` 清空（連結失效）。**狀態不變**，已上架的維持上架，不用重新審核。
4. 認領完直接進畫家後台，看到原本的資料和作品。之後用 Google 登入就好。

**例外：**

| 狀況 | 畫面 | 處理 |
|---|---|---|
| 連結用過或打錯 | 「這個連結已經失效」＋聯絡方式 | 你在後台確認是否已認領；沒認領就重新複製連結給他 |
| 他的帳號已經有畫家頁（例如先自己申請了一個） | 「你的帳號已經有畫家頁，請聯絡我們合併」，不自動認領 | 你在後台手動綁定（見下） |
| 畫家弄丟連結 | — | 你在後台重新複製一份 |

**管理者手動綁定（備案）**：管理後台的畫家資料加「綁定帳號」，輸入畫家登入用的 Google 信箱 → 從 profiles 找到帳號 → 綁上去（效果同認領）。如果那個帳號已經有一個新申請的畫家頁，畫面會列出那一個（名字、狀態、作品數），按「刪掉它並綁定」才會刪掉再綁（2026-11-05 實作：只提供刪掉帳號原本那個；不提供「刪掉 demo 搬來的這個」，因為正式搬家前下次同步又會把它搬回來）。管理後台也可以「重新產生連結」（舊連結立刻失效）。

**不用 Email 自動配對**：demo 的 Email 是畫家自填的公開聯絡信箱，沒驗證過，不一定是他的 Google 信箱，也可能填錯成別人的。

### 5.3 資料庫做法

- 認領用兩個 `security definer` 函式，前台不直接改 artists：
  - `arch_claim_preview(token)`：訪客也能呼叫，只回傳名字、頭像、作品縮圖（不含 Email 等私人資料）；token 無效回傳空值。
  - `arch_claim_artist(token)`：必須登入；檢查 token 有效、該畫家還沒有 `user_id`、這個帳號還沒有畫家頁，通過才綁定並清空 token。
- 手動綁定只有管理者能做（沿用 `arch_is_admin()`）：`arch_admin_bind_artist`、`arch_admin_new_claim_token`。
- 以上都寫在 `sql/02_artists.sql`（2026-11-05）。認領頁 `claim.html`：訪客按「用 Google 登入並認領」→ 登入回來自動認領 → 進 `studio.html`；已登入的人看到目前帳號＋「認領到這個帳號」，也可以登出換帳號。
- 全部舊畫家都認領完之後，可以把 `edit_token` 欄位和認領頁一起拿掉。

---

## 6. 需要你準備的事

| 什麼時候 | 事項 | 我會提供步驟 |
|---|---|---|
| 階段 1 前 | 開一個新的 Supabase 專案 | ✓ |
| 階段 1 前 | 在 Google Cloud 建立 OAuth 用戶端（Google 登入需要） | ✓ |
| 階段 5 前 | 網域（Cloudflare）掛到網站主機 GitHub Pages（見 [domainset.md](domainset.md)） | ✓ |

準備步驟見 [SETUP.md](SETUP.md)。

---

## 變更紀錄

- 2026-11-03：v0.1 初稿
- 2026-11-03：v0.2 確認許願與提案只有文字、提案價格只給許願者看、作品 1–9 件、沿用純 HTML
- 2026-11-03：建立 HTML／CSS 骨架（3.1）；畫家狀態新增「草稿」
- 2026-11-04：首頁開頭改成 demo（html4-desktop）的版型：超大標題、左說明右按鈕、一排可左右滑的作品（目前為示範資料，接上資料庫後換成已上架作品，位置標 `data-slot="hero-works"`）。樣式寫在 index.html 自己的 `<style>`，沒動共用 css；pages.css 裡舊的 `.hero` 樣式已不再使用。備份：`index.backup-20261104.html`
- 2026-11-04：「如何收藏」全站改名為「網站使用方法」（11 頁的導覽列、手機選單、頁尾，以及首頁 #how 區塊標題；連結與 id 不變）。layout.css 修正 320px 寬時導覽列「登入」擠成兩行（按鈕不換行；360px 以下縮小 Logo 與間距）。備份：`old ver/backup-20261104-rename-how-nav/`
- 2026-11-04：首頁「精選畫家」改成漂浮名片（6 位畫家；桌機散佈＋微轉、只在邊角交疊；平板兩欄；手機左右滑）。拿掉此區的客製徽章、收藏愛心與大張作品圖。頭像規則：portrait_url → 第一件作品（works 依 position）→ 名字首字，由 index.html 的 `ArchAvatar.apply()` 依 `data-portrait`／`data-first-work`／`data-initial` 決定。備份：`old ver/backup-20261104-featured-floating/`
- 2026-11-04：取消「成為畫家要邀請碼」：登入後直接申請，管理者審核後上架。apply.html 拿掉邀請碼、新增選填「你從哪裡知道 Arch？」（Threads／Instagram／朋友介紹／其他）；admin.html 拿掉邀請碼分頁，待審核清單改顯示來源；首頁招募文字更新。artists 加 `referral_source`、`invite_code` 與 invite_codes 表不再使用。備份：`old ver/backup-20261104-remove-invite/`
- 2026-11-04：apply.html「下一步：填寫畫家資料」接上 studio.html（沒勾原創聲明會顯示提示、不前往；來源 referral_source 之後接資料庫再存）。layout.css 修正側欄版型（管理後台／畫家後台／我的帳號）在手機寬被撐寬而左右捲動：內容欄改 `minmax(0,1fr)`，手機上側欄分頁是可自己左右滑的一排；數據卡片手機排兩欄。備份：`old ver/backup-20261104-admin-mobile/`
- 2026-11-04：作品媒材改成下拉選單（12 個固定選項，必填），新增選填「畫在什麼上」support（畫布／紙／木板／麻紙／絹／其他，電繪時停用並清空）；網站顯示「媒材・底材」。studio.html 改成兩個選單；artists.html 媒材篩選選項同步；示範資料「紙本」改「紙」、「麻紙」改「麻紙／絹」。components.css 補上停用欄位樣式 `.ctrl:disabled`。備份：`old ver/backup-20261104-medium-select/`
- 2026-11-04：卡片上底材為「麻紙／絹」時不顯示（示範資料卡片改成只寫「膠彩」），作品詳細頁維持完整；找畫家頁篩選功能排在階段 3 實作；畫家後台送出審核暫不加必填檢查。
- 2026-11-04：新增「作品探索」頁 explore.html（css/explore.css、js/explore.js）：桌機依真實尺寸比例排 10 幅展覽牆＋比例尺＋重新推薦；手機一次一幅、左右滑。12 頁的導覽列、手機選單、頁尾加「作品探索」（找畫家之後）。示範資料 w3、w8 已售出、w11 非賣品沿用原有設定。備份：`old ver/backup-20261104-explore/`
- 2026-11-04：補上 demo 畫家「認領」流程（第 5 節重寫）：搬資料做法、試搬／正式搬、認領頁 `claim.html`、例外狀況、管理者手動綁定、兩個認領函式。artists 的 `user_id`、`edit_token` 改為可空，新增 `claimed_at`；階段 1、2、5 內容同步；頁面清單與 3.1 加認領頁（尚未建立）。備份：`old ver/backup-20261104-claim-plan/`
- 2026-11-04：**階段 1 地基**。新增 `sql/01_foundation.sql`（profiles、admins、artists、works、favorites、inquiries、wishes、proposals、feedback 全部開 RLS；公開資料走 public_artists／public_works／public_wishes／public_proposals 檢視表；新帳號自動建立 profile，並替 SQL 執行前就登入過的帳號補建；`arch_me()`、`arch_is_admin()`）。前端用 supabase-js 2.118.0（jsDelivr CDN，固定版本＋SRI 驗證）做 Google 登入（PKCE），轉回網址依目前網頁位置動態產生。頁首頁尾改由 `js/site-chrome.js` 產生（12 頁）。需要登入的按鈕加 `data-login-reason`：訪客按下先跳「先登入再繼續」提示，登入回來自動接著做（許願牆「我要許願」已接上）。account.html 顯示真的名字、大頭貼、Email，可改顯示名稱；收藏／詢問／許願顯示「準備中」。許願對話框加選填標題。決定：管理者也用 Google 登入（Email／密碼登入關閉）；收藏家 Email 只在主動詢問、選定提案時給那位畫家（inquiries.contact_email）；wishes 加選填 title；proposals 加「待審核」；畫家頁網址用 `artist.html?slug=`，slug 草稿可空；第 6 節主機改為 GitHub Pages。備份：`old ver/backup-20261104-stage1-auth/`
- 2026-11-04：**demo → 正式版同步**（5.1 的實作）。新增 `sql/sync/1_demo_匯出.sql`（demo 跑，只讀）、`2_正式版_設定_第一次.sql`（正式版跑一次：`migrate` schema、slug 對照表、媒材對照表、同步紀錄、同步函式 `migrate.sync_from_demo`；前台無任何權限）、`3_正式版_匯入_每次.sql`（貼 JSON 同步），步驟說明 `SYNC.md`。決定：rejected → 需修改；已認領畫家同步時跳過；demo 已刪的畫家只列報告不刪；slug 與媒材用對照表、對不上的媒材先留空；圖片試搬期間沿用 demo 網址。預填 slug 11 位（demo 已上架畫家）、媒材建議 16 種寫法。備份：`old ver/backup-20261104-demo-sync/`
- 2026-11-05：**階段 2：公開頁面接上資料庫**（首頁、找畫家、畫家頁、作品頁、作品探索改讀 public_artists／public_works）。db.js 新增 `getCatalog()`（全部已上架畫家＋作品一次讀完）、`getArtist(slug)`、`getWork(id)`；新增 `js/cards.js`（卡片與格式共用工具；首頁內嵌的 `ArchAvatar` 搬到這裡，用法不變）與各頁的 `home.js`／`artists.js`／`artist.js`／`work.js`；explore.js 的 `getWorks()` 改從資料庫抽（只抽有寬高的）。各頁拿掉示範資料，改成載入中骨架；沒有資料、讀取失敗都有說明；畫家頁 slug 不對、作品頁 id 不對顯示「找不到這位畫家／這件作品」＋回找畫家的連結。決定：首頁精選畫家＝排序最前面 6 位（sort_order → created_at，管理者改 sort_order 就能換人）；首頁作品列＝每位畫家的第一件作品、每次進來順序隨機；首頁「最新作品」＝依作品建立時間、每位畫家最多一件、共 4 件；作品頁大圖照作品真實寬高比例完整顯示（不裁切）；作品沒有價格顯示「價格請洽畫家」；找畫家的搜尋、篩選、排序先停用並加一行「準備中」說明（階段 3 實作），「載入更多」拿掉（一次全部列出）。tokens.css 加 `--skel`；components.css 加骨架、讀取失敗、找不到畫面樣式；pages.css 加 `.work-figure`；explore.css 加 `.ex-msg`。詢問、收藏按鈕維持原樣（階段 3）。備份：`old ver/backup-20261105-public-pages-db/`
- 2026-11-05：**畫家頁 artist.html 改成 demo 的排版**（照 arch-site 畫家個別頁）。桌機（900px 以上）左欄 260–300px：圓形頭像 → 名字 → 標籤 → 「接受客製委託」徽章＋客製說明（custom_ok 才顯示）→ 一句話 → 分隔線 →「對這幅作品有興趣？直接聯絡{名字}。」＋ Email（黑底，mailto 帶主旨「[Arch] 想詢問{名字}的作品」）／Instagram（有 Email 時白底框線）按鈕，各自有值才顯示 → 創作故事（保留換行）；右欄作品卡格線（約 3 欄）。900px 以下改成上下排（畫家資料在上、作品在下），手機作品兩欄、360px 以下一欄；手機與平板的創作故事超過 8 行先收合，按「展開完整故事」看全文。作品卡：白底圓角框、黑底圖片區（4:5、整張畫不裁切）、〈標題〉、媒材／尺寸／價格三列；**整張卡片是連結**，進 `work.html?id=`；已售出在圖片左上角標示，非賣品寫在價格欄。麵包屑改成「← 所有畫家 / 名字」。拿掉這頁的「詢問畫家」「收藏畫家」按鈕與作品卡愛心（demo 沒有，且功能在階段 3 才做）；詢問對話框的 HTML 先留著，**階段 3 要決定詢問／收藏按鈕放在哪**。作品卡只在畫家頁使用，寫在 artist.js，cards.js 與其他頁卡片沒有改。pages.css 換掉畫家頁區塊（舊的 .profile-head／.story／.commission 只有這頁用）。客製徽章沿用 tokens.css 既有的 --ok 系列變數，沒有新增色碼。備份：`old ver/backup-20261105-artist-layout/`
- 2026-11-05：**階段 2：畫家後台接資料庫、認領、審核**。新增 `sql/02_artists.sql`（可重複執行）：artists 加 `admin_edited_at`、works 加 `image_w`／`image_h`、新表 `artist_revisions`（已上架畫家的待審核修改，開 RLS、前台無直接權限）；函式 `arch_start_artist`（申請：建立草稿、存來源）、`arch_studio_load`／`arch_save_artist`／`arch_discard_revision`（畫家後台，整份一起存）、`arch_claim_preview`／`arch_claim_artist`（認領）、`arch_admin_artists`／`arch_admin_review_artist`／`arch_admin_review_revision`／`arch_admin_new_claim_token`／`arch_admin_bind_artist`（管理者）；`arch_me()` 多回傳 `artist.revision`；`public_works` 多給圖片寬高；Storage bucket `arch-images` 與上傳權限。01_foundation.sql 的 public_works 改成先刪再建（重跑 01 後要再跑 02）。同步 `migrate.sync_from_demo` 也跳過 `admin_edited_at` 有值的畫家，報告標出「已認領／管理者改過」（`sql/sync/2_正式版_設定_第一次.sql` 要重跑一次）。頁面：新增 `claim.html`（`js/claim.js`）；`apply.html` 改用 `js/apply.js`，按「下一步」時才請訪客登入、建立草稿畫家頁、存 referral_source，已經有畫家頁的人直接看到「前往畫家後台」；`studio.html` 拿掉示範資料改由 `js/studio.js` 讀寫（畫家資料、作品新增／修改／刪除／排序、頭像與作品圖片上傳、狀態提示、管理者模式、底部固定的儲存列、離開前提醒未儲存），收到的詢問、許願提案顯示「準備中」；`admin.html` 的「畫家審核」改成接資料庫的「畫家」分頁（依狀態篩選、認領連結、綁定帳號、審核新申請、審核修改並列出改了什麼、編輯、看公開頁），非管理者導回首頁；總覽、願望、提案、問卷、會員維持示範畫面。account.js 顯示「修改審核中」等狀態。tokens.css 加 `--accent-border`、`--scrim`；pages.css 加畫家後台、認領頁、管理後台畫家分頁的樣式。demo 不再收新畫家，新畫家從正式版 apply.html 申請。備份：`old ver/backup-20261105-claim-edit/`
