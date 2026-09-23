# 📜 變更日誌 (Changelog)

本專案遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-TW/) 語意化版本規範，並採用 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/) 格式記錄變更。

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
