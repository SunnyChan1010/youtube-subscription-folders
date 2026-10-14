# 📜 變更日誌 (Changelog)

本專案遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-TW/) 語意化版本規範，並採用 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/) 格式記錄變更。

---

## [1.2.0] - 2026-10-14

### 🛡️ 架構重構與穩定性防線 (Architectural Resilience)
- **修復跨頁狀態失聯（`chrome.storage.onChanged` 鍵名對齊）**：
  - 修正 `content.js` 與 `options.js` 中對錯誤鍵名（`_v1` 後綴）的檢查，精確對齊 `storage.js` 的 `yt_folders`、`yt_channels`、`yt_settings`，並引入 120ms~150ms 防抖，徹底消除跨分頁編輯導致的陳舊快照覆蓋（Lost Update）。
- **側邊欄單雙擊 DOM 衝突修復與捲動位置保留**：
  - 在 `renderSidebarContent()` 前後自動記錄並還原 `scrollTop`，切換分組時不再彈回頂部。
  - 分離箭頭展開（0ms）與資料夾點擊，加入 180ms 單雙擊區分計時器與 `suppressNextStorageSidebarRebuild` 旗標，雙擊跳轉 `/feed/subscriptions` 時穩定合成原生事件，不再因 `updateSettings` 寫入導致節點銷毀重建。
  - 拔除側邊欄阻塞式 `window.prompt()`，改為優雅的非阻塞行內快速輸入框（`#yt-org-sidebar-new-folder-box`，支援 `Enter` 建立與 `Escape` 取消）。
- **消除批次訂閱/退訂之 N+1 儲存寫入雪崩**：
  - 於批次退訂與自動訂閱期間停用逐筆 Storage 寫入，批次完成後一次性原子呼叫 `batchRemoveUnsubscribedChannels` / `batchUpdateChannels`，將原先 50 筆操作的 150 次磁碟寫入與廣播壓縮為嚴格的 **1 次**。
- **網路請求超時防線與重度用戶分頁同步保護**：
  - 為 `youtube_api.js` 所有 6 處 `fetch` 加上統一的 `fetchWithTimeout()`（`AbortController` 超時防禦），防止網路掛起造成無限轉圈。
  - 將分頁委託同步超時從 15 秒調升至 **60 秒**，徹底杜絕 >800 頻道的重度用戶在 15 秒時觸發的雙倍請求風暴。
- **多帳號與品牌頻道（Brand Account）認證支援**：
  - 於 `getAuthSession` 與 `content.js` 動態提取 `SESSION_INDEX` (`X-Goog-AuthUser`) 與 `DELEGATED_SESSION_ID` (`X-Goog-PageId`)，並在 InnerTube API 遭遇 401/403 時自動清理快取自癒重試 1 次。
- **@handle 本地雙層快取與消除殘留 $O(F \times C^2)$ 線性掃描**：
  - `resolveChannelDetails` 優先查詢記憶體快取與本地 `YTFolderStorage.getChannels()`，已存在的 Handle 享 **0 網路請求** 即時解析，省去 90%+ 的 2MB 網頁 HTML 下載。
  - `handleCheckUnsubscribedChannels` 預先建立 `channelByToken` `Map` 索引，降至 $O(F + C)$。

---

## [1.1.1] - 2026-10-14

### 🛡️ 安全性強化 (Security)
- **修補 DOM XSS 與屬性注入弱點**：
  - 於 `popup.js` 與 `options.js` 的搜尋無結果狀態中強制對查詢字串執行 `escapeHtml(query)` 轉義，並在所有頻道寫入端點強制執行 `sanitizeAvatarUrl()` 與 `sanitizeUrl()`。
  - 收緊 `sanitizeFolderColor()` 正規表達式，僅允許標準 3/4/6/8 碼 Hex 色碼（`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`）。
- **防禦 SSRF 與路徑穿越 (`buildSafeYouTubeChannelUrl`)**：
  - 於 `youtube_api.js` 與 `options.js` 新增嚴格 YouTube 官方網域白名單（`www.youtube.com` / `youtube.com` / `m.youtube.com`）與頻道路徑格式校驗，阻絕外部主機請求與路徑穿越。
- **擴充套件訊息邊界驗證**：
  - 於 `background.js` 與 `content.js` 的 `chrome.runtime.onMessage` 強制驗證 `sender.id === chrome.runtime.id` 與特權指令發起端來源。
- **最小權限與純淨打包**：
  - 移除 `manifest.json` 中未使用的 `web_accessible_resources` 項目，並重構 `release.js` 僅將執行期必要檔案打包入 Release ZIP。

### 🐛 問題修復與穩定性提升 (Fixed)
- **解決可重入非同步互斥鎖 (`withStorageLock`) 並發競爭條件**：
  - 序列化 `storage.js` 所有 `chrome.storage.local` 的 Read-Modify-Write 操作，徹底根除快速連續點擊分組或背景同步同時觸發時的資料覆蓋遺失（Lost Update）。
- **修復新同步與去重後「未分類頻道」被隱藏的問題**：
  - 修正 `batchAddChannels()` 與 `deduplicateData()` 中 `isSubscribed` 預設值為 `true`（`raw.isSubscribed !== false`），並於 `/feed/channels` 一鍵同步時顯式標記 `isSubscribed: true`。
- **跨分頁即時狀態同步 (`chrome.storage.onChanged`)**：
  - 於 `background.js`、`content.js` 與 `options.js` 補齊 `STORAGE_UPDATED` 廣播與 `chrome.storage.onChanged` 監聽，確保多開分頁與管理後台即時同步。
- **移除無效分頁 Fallback 與死碼**：
  - 移除 `acquireExecutionTab()` 對無回應 YouTube 分頁的盲目回退，並清理 `options.js` 重複綁定的事件處理器。

### ⚡ 效能最佳化 (Changed)
- **$O(N)$ 雜湊索引取代 $O(N^2)$ 線性掃描**：
  - 重構 `deduplicateData()`、`getUncategorizedChannels()`、`enrichChannelsMetadata()` 與 `batchAddChannels()`，預先建立 `Map` / `Set` 索引，大幅提升數百個訂閱頻道下的去重與檢索速度。
- **YouTube DOM 查詢範圍收斂與 Fast-Path**：
  - 於 `checkAndInjectChannelTagger()` 新增 `dataset.urlKey` 快速返回守衛，並將 `applyFeedFilters()` 查詢範圍限制於活躍的 `ytd-browse` 容器。

---

## [1.1.0] - 2026-10-11

### 🚀 新增功能 (Added)
- **動態牆自動推進機制 (Scroll Pump Engine)**：
  - 徹底解決冷門分組與強過濾條件下的「分頁飢餓 / 滾動卡死 (Feed Starvation)」問題。
  - 當過濾後可視影片數量小於 6 部且 YouTube 底部 continuation 載入哨兵存在時，自動發起安全且限額（上限 5 次）的自動推進滾動，確保頻道歷史影片正常載入。
- **🚫 隱藏 Shorts 短片專屬過濾開關**：
  - 於訂閱動態牆頂部 Chips 區域加入「🚫 隱藏 Shorts」獨立快捷按鈕，即時過濾動態牆中所有的 Shorts 短片卡片及 Shorts 推薦貨架。
- **🔴 直播中節目快篩開關**：
  - 新增「🔴 僅顯示直播」開關，即時掃描並篩選出正在進行實況直播的頻道，方便快速追蹤熱門動態。
- **側邊欄分組即時搜尋框 (`#yt-org-sidebar-search-input`)**：
  - 於左側邊欄「📁 分組訂閱」頂部加入緊湊搜尋列，輸入關鍵字即時篩選分組名稱與所屬頻道，並自動展開匹配分組之子頻道列表。
- **鍵盤快捷鍵切換 (`Alt + 0~9`)**：
  - 在 `/feed/subscriptions` 頁面支援快捷鍵導航：`Alt + 0` 快速切換至「全部動態」，`Alt + 1` 至 `Alt + 9` 快速切換前 9 個分組，具備操作 Toast 視覺反饋。
- **Options 管理後台功能強化**：
  - 左側邊欄新增分組即時搜尋框 (`#input-search-folders`)，方便快速篩選查找大量分組。
  - 正常分組視圖新增 `select-folder-move` 一鍵跨組遷移選單，可直接將頻道移動至其他分組，免去手動刪除重新添加的步驟。
- **自適應容錯 DOM 選擇器引擎 (Resilient Fallback Selectors)**：
  - 支援 `yt-lockup-view-model`、`.yt-core-attributed-string a` 等 YouTube 最新 Web Components / Polymer 節點結構，大幅提升抗改版穩定性。

### ⚡ 效能極致優化 (Changed)
- **消除 800ms 磁碟 I/O 輪詢 (Zero-I/O Polling Loop)**：
  - 實作純記憶體快取解析 `getCachedFolderIdsByChannel`，在觀看影片及頻道頁面時完全隔絕頻繁的 `chrome.storage.local.get` 磁碟讀取，每小時節省逾 4,500 次磁碟存取；並加入訂閱狀態防抖守衛，大幅降低 CPU 與記憶體負擔。

### 🐛 問題修復 (Fixed)
- **YouTube SPA 內部導航狀態保持 (Sidebar State Persistence)**：
  - 修復點擊 YouTube 影片或頻道跳轉時邊欄分組展開狀態自動摺疊問題，點擊展開即時持久化至 `settings.expandedFolders`，並保留邊欄搜尋關鍵字與過濾結果。
- **消除重複事件監聽器與記憶體洩漏風險 (Idempotent Event Listeners)**：
  - 為浮動選單全域事件引入冪等保護標誌，統一圖片錯誤降級監聽器，防止多重註冊。

---

## [1.0.4] - 2026-09-23

### 🐛 問題修復 (Fixed)
- **徹底過濾與清理 YouTube 系統 UI 操作按鈕（如 "Create post" / "建立貼文" 等）**：
  - **根本原因排查**：在透過 YouTube InnerTube API 獲取已訂閱頻道清單（`browseId: 'FEchannels'`）時，YouTube 回傳之 JSON 結構頂層包含導覽列與頂部操作選單（`topbar`）。該選單內含有指向使用者自身頻道社群分頁的「建立貼文」（`Create post` / `建立貼文`）按鈕，過去的遞迴遍歷無差別掃描整個 JSON，導致該按鈕名稱被誤識別為頻道名稱並存入本地儲存，最終出現在「未分類頻道」中。
  - **API 提取防護**：於 `extractChannelsFromBrowseData` 中全面忽略 `topbar`、`header`、`masthead`、`guide` 及 `responseContext`，並在收集頻道前嚴格校驗標題與 Handle，徹底阻絕非頻道操作按鈕。
  - **儲存層自動淨化 (Auto-Sanitization)**：在 `getChannels()` 讀取時自動過濾並刪除已污染的系統操作按鈕（包括 `Create post`, `Upload video`, `Settings`, `建立貼文`, `上傳影片`, `設定` 等繁簡日英名稱），同時在 `getUncategorizedChannels()`、`batchAddChannels()`、`deduplicateData()` 與 `options.js` 中實施多層安全過濾，杜絕任何幽靈按鈕卡片。

---

## [1.0.3] - 2026-09-23

### 🚀 新增功能 (Added)
- **「🔍 檢查退訂頻道」一鍵檢測與批量清理**：
  - 於管理頁面（Options）頂部操作列新增「**🔍 檢查退訂頻道**」專屬按鈕。
  - 即時連線 YouTube InnerTube 比對當前真實訂閱狀態，精準篩選出已在 YouTube 取消訂閱但仍留在擴充功能分組中的頻道。
  - 提供專屬清理確認視窗（`#cleanup-unsubscribed-modal`），顯示頻道頭像、名稱、Handle 及目前所屬分組標籤，支援全選/反選，一鍵自所有分組徹底清除。
- **頻道頭像與元數據自動補全 (Channel Metadata Enrichment)**：
  - 比對訂閱清單時，自動將 YouTube 回傳之最新真實高畫質頭像 (`avatarUrl`) 與頻道名稱補全至本地儲存，解決 Takeout 匯入頻道只有 `UC...` 原始 ID 且無頭像之問題。

### 🐛 問題修復 (Fixed)
- **修復預設頭像 404 破圖問題**：
  - 原先使用的預設頭像 URL `https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png` 伺服器端已返回 404 Not Found。
  - 改用現代深色 YouTube 風格人像剪影 SVG（Base64 Data URI），完全**本地端運作、零網路請求、永不失效**。
  - 加入全域 Capture 階段圖片加載錯誤事件監聽器，確保任何圖片載入異常時自動平滑降級，徹底杜絕破圖圖示。
- **修復退訂頻道流入「未分類」問題**：
  - 修正 `YTFolderStorage.getUncategorizedChannels()`，嚴格過濾排除 `isSubscribed === false` 的頻道，防止已退訂頻道意外出現在未分類頻道列表中。

### ⚡ 效能與架構優化 (Changed)
- **原子化批次寫入 (`batchRemoveUnsubscribedChannels`)**：
  - 批次移除多個已退訂頻道時改採單次原子寫入，避免多次頻繁觸發 `chrome.storage.local` I/O。

---

## [1.0.2] - 2026-09-23

### 🐛 問題修復 (Fixed)
- **未訂閱頻道即時狀態偵測與分組強制同步清理**：
  - 強化即時監聽與攔截 YouTube 退訂行為，確保頻道退訂時立即同步將該頻道自所有分組中移除。

---

## [1.0.1] - 2026-09-23

### 🚀 新增功能 (Added)
- **取消訂閱頻道時同步取消分組**：
  - 增加即時監聽使用者在 YouTube 點擊取消訂閱時的事件，自動觸發資料庫分組清理。

---

## [1.0.0] - 2026-09-22

### 🚀 新增功能 (Added)
- **自訂訂閱分組管理**：
  - 支援建立、重新命名、自訂 Emoji 圖示與色標的分組資料夾。
  - 內建 10 大預設分類結構（遊戲、時事、科技、日韓文化、體育、思維學習等）。
- **YouTube 側邊欄原生整合**：
  - 在 YouTube 左側導覽列無縫注入「📁 分組訂閱」區塊。
  - 支援資料夾樹狀收合、頻道計數徽章與快捷新增按鈕。
- **訂閱動態牆即時過濾 (`/feed/subscriptions`)**：
  - 動態牆頂部自動注入分組 Filter Chips，支援一鍵切換特定分組的影片動態。
  - 加入「👁️ 隱藏已看」過濾按鈕，自動過濾已觀看過之影片卡片。
- **頻道頁面與影片播放頁快捷標籤**：
  - 頻道主頁訂閱按鈕旁注入「📁 加入分組 ▼」浮動選單。
  - 影片播放器下方作者資訊旁同步注入分組選單，支援影片觀看中即時歸類。
- **一鍵全頻道同步 (`/feed/channels`)**：
  - 於 YouTube 訂閱頻道清單頁面注入同步橫幅，一鍵掃描所有已訂閱之頻道、Handle 與高畫質頭像。
- **智慧備份與還原**：
  - 支援完整 JSON 匯出與拖曳匯入。
  - 匯入時提供「多餘訂閱頻道檢測」，可自動對比並批次取消訂閱已自備份中移除的頻道。

### 🔒 安全性與穩定性 (Security & Reliability)
- **零依賴純原生架構 (Zero-Dependency)**：
  - 全面採用原生 ES2022+，移除任何前端打包與編譯黑盒，安裝體積低於 500KB。
- **嚴格 CSP 合規 (Strict MV3 CSP)**：
  - 移除所有行內事件處理器（`onerror`, `onclick`），改採全域 Capture 事件與事件委派，Chrome 擴充狀態為 0 錯誤、0 警告。
- **無秘密外洩防護 (Zero Exposed Secrets)**：
  - 徹底移除硬編碼金鑰，全面改用 YouTube 第一方會話動態憑證提取。
- **混合上下文執行路由 (Hybrid Execution Routing)**：
  - 解決擴充後台跨域 Cookie 隔離問題，自動路由至 YouTube 前端執行訂閱操作。
- **深層 InnerTube 回應驗證**：
  - 杜絕 HTTP 200 假成功，深入驗證 `updateSubscribeButtonAction` 與過期彈窗狀態。

---

## 版本發布規則 (Versioning Guidelines)

- **MAJOR (主版本號)**：當有不相容的存儲結構變更或重大架構重構時遞增（如 `2.0.0`）。
- **MINOR (次版本號)**：當有向下相容的新功能或介面改進時遞增（如 `1.1.0`）。
- **PATCH (修訂號)**：當有向下相容的 Bug 修復或相容性修訂時遞增（如 `1.0.1`）。
