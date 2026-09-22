---
adr_id: "0002"
title: "零依賴純原生 (Zero-Dependency Vanilla JS) MV3 架構"
status: "ACCEPTED"
date: "2026-09-22"
deciders: ["Lead Architect", "AI Core Agent"]
technical_area: "Tooling & Runtime"
replaces: ""
superseded_by: ""
tags: ["vanilla-js", "zero-dependency", "mv3", "csp", "buildless"]
---

# ADR 0002: 零依賴純原生 (Zero-Dependency Vanilla JS) MV3 架構

## 1. 背景與問題陳述 (Context and Problem Statement)

現代瀏覽器擴充開發常有團隊傾向引入 React、Vue、Tailwind、Webpack、Vite 等現代前端工具鏈。然而在 Chrome Manifest V3 環境與 AI Agent 自動化維護的情境下，這類工具鏈會引入顯著痛點：
1. **構建黑盒與調試困難**：生成編譯後的 Bundle 代碼大幅增加了 AI Agent 直接閱讀與局部修改的難度，容易產生 Source Map 不匹配與無效替換。
2. **審核阻礙 (Chrome Web Store Review)**：高度混淆或巨量打包的代碼會顯著拉長 Chrome 應用程式商店的審核週期，並增加安全審查拒絕率。
3. **CSP 衝突**：部分前端框架內部使用的動態樣式注入或 Eval/Function 會直接觸發 MV3 的 CSP 違規。

## 2. 決策驅動因素 (Decision Drivers)

- **開箱即用與零構建**：開發者或 AI Agent 修改任何 `.js` / `.css` 後，使用者只需在 `chrome://extensions` 點擊重新載入即可即時生效，無需 `npm run build`。
- **極致上下文效率 (Token Efficiency)**：原始碼即為執行代碼，AI Agent 無需解析打包配置或巨型依賴樹，節省大幅 Token。
- **極小體積與極高載入速度**：擴充安裝包體積小於 500KB，DOM 注入零框架水合（Hydration）開銷。

## 3. 備選方案矩陣 (Considered Options)

### 方案 A: 純原生 ES2022+ 模組化無構建架構 [選定]
- **實現**：利用現代瀏覽器原生的 DOM API、CSS Custom Properties、Fetch API、Async/Await，代碼依職責拆分為 `storage.js`、`youtube_api.js`、`content.js`、`options.js`。
- **優點 (+)**：
  - 零依賴、零構建時間、零工具鏈脆弱性。
  - AI Agent 閱讀與修改效率最高。
  - Chrome 審核零阻礙。
- **缺點 (-)**：
  - 需手動管理狀態更新與 DOM 渲染（需嚴格落實 `escapeHtml` 防範 XSS）。

### 方案 B: React / Vue + Vite + CRXJS 打包方案
- **實現**：標準現代 SPA 擴充開發腳手架。
- **優點 (+)**：組件化宣告式狀態管理。
- **缺點 (-)**：
  - 引入數百個 `node_modules` 依賴。
  - 編譯後檔案極大，AI Agent 容易在構建配置或 Hot Reload 發生異常。

## 4. 決策結果與合理性論證 (Decision Outcome)

選定 **方案 A (純原生 ES2022+ 模組化無構建架構)**。
本專案為瀏覽器注入型工具，核心在於穩健操作 YouTube 原生 DOM 與 InnerTube 協議。原生架構在穩定性、透明度與 AI 協作效率上全面優於打包框架。

## 5. 架構負面約束（防禦性條款） (Negative Constraints & Guardrails)

- ⚠️ **禁止引入打包工具**：嚴禁建立 `webpack.config.js`、`vite.config.ts` 或引入需要編譯步驟的框架。
- ⚠️ **禁止行內事件**：在原生拼接 HTML 字串時，嚴禁使用 `onerror`、`onclick` 等行內屬性，必須採用原生 `addEventListener` 或全域 Capture 事件。
- ⚠️ **XSS 強制防禦**：所有使用者輸入與 YouTube 抓取文字在拼接進 DOM 前必須經過 `escapeHtml()`。

## 6. 驗證與合規檢查 (Validation & Compliance)

- **靜態檢查**：檢查專案根目錄中不存在 `package.json` 中的運行時依賴或構建腳本。
- **運行時檢查**：在 `chrome://extensions` 載入未封裝項目，確認所有功能開箱即用且 CSP 報錯為 0。
