---
adr_id: "0001"
title: "採用 InnerTube 混合上下文執行路由架構"
status: "ACCEPTED"
date: "2026-09-22"
deciders: ["Lead Architect", "AI Core Agent"]
technical_area: "Network & Security"
replaces: ""
superseded_by: ""
tags: ["innertube", "chrome-extension", "cors", "credentials", "mv3"]
---

# ADR 0001: 採用 InnerTube 混合上下文執行路由架構

## 1. 背景與問題陳述 (Context and Problem Statement)

在擴充功能的備份匯入或訂閱同步流程中，用戶需要在擴充管理頁面（`options.html`）批次訂閱或取消訂閱頻道。
原先的實現直接在 `options.js` 透過 `fetch('https://www.youtube.com/youtubei/v1/subscription/subscribe', ...)` 發出請求。然而在實際測試中發現：
1. **瀏覽器 Origin 限制**：從 `chrome-extension://...` 發出的跨域請求會攜帶擴充自身的 Origin，導致 YouTube 伺服器校驗 `SAPISIDHASH` 時因 Origin 不符而拒絕。
2. **第一方 Cookie 分區隔離**：擴充後台頁面無法自動攜帶完整的第一方 Session Cookies（`SID`, `HSID`, `SSID`, `LOGIN_INFO`）。
3. **InnerTube 假成功 (Deceptive HTTP 200)**：YouTube InnerTube 即使在未授權時亦返回 HTTP 200，僅在回傳 JSON 中附帶 `openPopupAction`，造成先前版本錯誤誤判為成功，但使用者帳號實際上並未建立訂閱。

## 2. 決策驅動因素 (Decision Drivers)

- **真實生效性**：訂閱與取消訂閱操作必須在用戶真實的 YouTube 帳號中 100% 生效。
- **無縫用戶體驗**：使用者在 `options.html` 進行批次匯入時，不應強制彈出繁瑣的第三方 OAuth 視窗或登入授權。
- **安全性與最小權限**：避免硬編碼任何 Google API Key，符合 GitHub Secret Scanning 與 Chrome Web Store 審核標準。

## 3. 備選方案矩陣 (Considered Options)

### 方案 A: 混合上下文標籤頁委派路由（Hybrid Execution Routing）[選定]
- **實現**：
  - 若在 YouTube 頁面（`content.js`），直接透過原生同源上下文執行。
  - 若在擴充頁面（`options.html` / `popup.html`），透過 `acquireExecutionTab()` 自動尋找現存就緒的 YouTube 標籤頁（或開啟單一臨時後台標籤頁），利用 `chrome.tabs.sendMessage` 委派給該頁面之 Content Script 同源執行，任務完成後釋放。
- **優點 (+)**：
  - 100% 保留第一方 Cookie、同源 Origin 與最新 CSRF Token。
  - 徹底杜絕 `SAPISIDHASH` 不符與過期彈窗。
  - 零需用戶手動配置 Google Cloud 憑證或登入授權。
- **缺點 (-)**：
  - 需處理標籤頁生命週期與擴充間的非同步 Message Passing。

### 方案 B: 申請官方 YouTube Data API v3 OAuth
- **實現**：建立 GCP 專案，引導用戶申請 OAuth Client ID 與 API Key。
- **優點 (+)**：官方標準 REST API。
- **缺點 (-)**：
  - 每日配額極低（Quota Limit 僅 10,000 點，一次訂閱消耗 50 點，單日僅可訂閱 200 次）。
  - 對終端用戶而言門檻過高，幾乎無法在開源擴充中推廣。

### 方案 C: Background Service Worker 劫持並修改 Request Headers (`declarativeNetRequest`)
- **實現**：透過 DNR 規則覆寫請求頭中的 `Origin: https://www.youtube.com`。
- **優點 (+)**：後台直接發送。
- **缺點 (-)**：Chrome MV3 對 Cookie 的同源憑證與 Sec-Fetch-* 標頭有嚴格安全防護，難以保證跨版本穩定性。

## 4. 決策結果與合理性論證 (Decision Outcome)

選定 **方案 A (混合上下文標籤頁委派路由)**。
- 實現於 `scripts/youtube_api.js` 之 `acquireExecutionTab()`、`releaseExecutionTab()` 與 `executeSubscribeDirect()`。
- 搭配 `verifySubscriptionResult()` 深入校驗回傳 JSON 中的 `updateSubscribeButtonAction`，確保每筆操作真實生效。

## 5. 架構負面約束（防禦性條款） (Negative Constraints & Guardrails)

- ⚠️ **禁止逆向修改**：任何未來的 AI Agent **絕對不得**刪除標籤頁路由邏輯或將請求改回直接在 `options.js` 跨域 fetch。
- ⚠️ **禁止以 HTTP 200 代表成功**：必須維持 `verifySubscriptionResult` 對 `modalWithTitleAndButtonRenderer` 與 `actions` 的結構化解析。
- ⚠️ **禁止洩漏憑證**：不得重新加入任何寫死之 API Key。

## 6. 驗證與合規檢查 (Validation & Compliance)

- **自動化測試**：`test/test_unsubscribe.js` 必須覆蓋標籤頁路由與結果校驗邏輯。
- **實機驗證**：在 BrowserOS 或 Chrome 中，打開任意未訂閱之頻道進行訂閱操作，重新整理後原生訂閱按鈕必須變更為「已訂閱」。
