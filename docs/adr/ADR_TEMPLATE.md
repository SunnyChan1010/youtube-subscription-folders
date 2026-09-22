---
adr_id: "0000"
title: "短標題：動作 + 決策核心 (例如：採用混合上下文路由替代純後台Fetch)"
status: "PROPOSED | ACCEPTED | SUPERSEDED | DEPRECATED"
date: "YYYY-MM-DD"
deciders: ["架構師或 Agent 角色"]
technical_area: "Storage | Network | DOM | Security | UI"
replaces: "" # 若有覆蓋舊 ADR 則填入對應 ID，例如 "0001"
superseded_by: ""
tags: ["mv3", "architecture", "innertube"]
---

# ADR [0000]: [決策標題]

## 1. 背景與問題陳述 (Context and Problem Statement)
- 描述觸發此決策的實際工程痛點、業務需求或環境限制（例如：瀏覽器沙盒限制、跨域 Cookie 丟失、效能瓶頸）。
- 必須包含可客觀衡量的技術現狀，避免主觀推測。

## 2. 決策驅動因素 (Decision Drivers)
- 關鍵驅動目標（例如：安全性、零 CSP 違規、相容 YouTube 現代 SPA 架構）。
- 必須遵守的外部約束（例如：Chrome Manifest V3 規範、零第三方依賴政策）。

## 3. 備選方案矩陣 (Considered Options)

### 方案 A: [方案名稱 - 例如：原生同源 Content Script 委派]
- **說明**：方案簡述與實現方式。
- **優點 (+)**：
  - 完整保留第一方 Cookie 與 Origin 憑證。
  - 零額外依賴。
- **缺點 (-)**：
  - 當用戶無開啟 YouTube 分頁時需後台建立臨時分頁。

### 方案 B: [方案名稱 - 例如：Background Service Worker 宣告式 NetRequest 注入]
- **說明**：方案簡述。
- **優點 (+)**：無需透過 Content Script 即可發出請求。
- **缺點 (-)**：無法動態讀取 HttpOnly 以外的前端 Session 狀態，複雜度極高。

### 方案 C: [方案名稱 - 例如：引入第三方封裝庫如 Axios / YouTube.js]
- **說明**：方案簡述。
- **優點 (+)**：開箱即用。
- **缺點 (-)**：違反零第三方依賴政策，體積過大且有供應鏈安全風險。

## 4. 決策結果與合理性論證 (Decision Outcome)
- **最終選定方案**：方案 [A/B/C]。
- **核心依據**：說明為何此方案在評估矩陣中最佳化了主要驅動因素，並妥協了可接受的次要缺點。

## 5. 架構負面約束（防禦性條款） (Negative Constraints & Guardrails)
- ⚠️ **禁止逆向選型**：未來的 AI Agent **絕對不得**擅自將此決策改回已否決的 [方案 B/C]。
- ⚠️ **代碼邊界**：明確指出受此 ADR 保護的關鍵檔案與函式。

## 6. 驗證與合規檢查 (Validation & Compliance)
- **自動化測試**：指明能驗證此架構不發生漂移的測試檔案（如 `test/test_xxx.js`）。
- **人工 / 實機驗證步驟**：如何在瀏覽器中確實驗證該決策已按預期生效。
