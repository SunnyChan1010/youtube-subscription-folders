# 📚 專案文檔架構體系與檢索地圖 (Documentation Hierarchy)

```
youtube-subscription-folders/
├── AGENT_CONTEXT.md                    # [核心] AI Agent 最高行為準則與系統架構邊界
├── .cursorrules                        # [IDE] Cursor / Windsurf / Copilot 快速索引指令檔
├── README.md                           # [用戶] 面向終端使用者與開源社群之產品說明與安裝指南
└── docs/
    ├── DOCUMENTATION_HIERARCHY.md      # [導航] 本文檔：全域文檔架構與檢索職責分工
    ├── adr/                            # [架構決策] Architecture Decision Records
    │   ├── ADR_TEMPLATE.md             # AI 優化版架構決策記錄模版
    │   ├── 0001-innertube-hybrid-execution-routing.md # ADR 0001: InnerTube 混合上下文執行路由
    │   └── 0002-zero-dependency-mv3-architecture.md   # ADR 0002: 零依賴原生 MV3 架構決策
    ├── api/                            # [協議規範] API & Protocol Specifications
    │   └── innertube_protocol_spec.md  # YouTube InnerTube 逆向通訊協議與資料結構規範
    └── qa/                             # [驗證準則] Quality Assurance & Test Playbooks
        └── verification_playbook.md    # 自動化測試與實機測試覆蓋標準
```

---

## 1. 各層級文檔職責劃分 (Separation of Concerns)

| 文檔路徑 / 類別 | 受眾 (Audience) | 職責與用途 (Purpose) | 何時讀取 / 更新 |
| :--- | :--- | :--- | :--- |
| `AGENT_CONTEXT.md` | **所有 AI Agent** | 專案唯一最高指導文檔。定義架構層級、型別邊界、安全負面約束（Negative Constraints）與 DoD。 | **進入專案任何任務時必讀**；架構規則變更時更新。 |
| `.cursorrules` | **Cursor / IDE Agent** | 快速引導與最高警戒規則，避免 AI 因上下文長度而遺漏核心約束。 | IDE 初始化自動讀取；新增全域強制約束時更新。 |
| `docs/adr/*.md` | **架構師 / AI Agent** | 記錄關鍵技術選型決策，解釋「為何選 A 而非 B/C」，防止 AI 進行無效重構或逆向選型。 | 涉及底層通訊、存儲結構、框架選擇時讀取；做出重大技術取捨時建立新 ADR。 |
| `docs/api/*.md` | **開發者 / AI Agent** | 定義 YouTube InnerTube 協議端點封包、Cookie 鑑權結構、參數 Payload 與錯誤碼處理。 | 修改 `scripts/youtube_api.js` 前必讀；YouTube 協議變更時更新。 |
| `docs/qa/*.md` | **測試者 / AI Agent** | 提供端到端驗證清單、自動化測試命令、邊界測試案例集。 | 在提交任何代碼前執行自檢時查閱。 |
| `README.md` | **終端使用者 / 社群** | 提供擴充功能特點、Chrome 手動安裝步驟、備份資料夾說明。 | 僅在新增重大使用者面向功能或發布新版本時更新。 |

---

## 2. AI 檢索與載入優化指南 (RAG & Token Efficiency)

為確保 AI Agent 在長上下文視窗中保持高精確度與低 Token 消耗，請遵循以下載入原則：

1. **基礎任務（小型 Bug 修復、CSS 樣式調整）**：
   - 僅需載入 `AGENT_CONTEXT.md` 的前置約束與目標檔案。
2. **通訊與訂閱協議相關任務**：
   - 載入 `AGENT_CONTEXT.md` + `docs/adr/0001-innertube-hybrid-execution-routing.md` + `scripts/youtube_api.js`。
3. **新增功能或重構任務**：
   - 審閱 `docs/adr/` 中現有決策，確保新設計不違背既定架構模式。
