# 🏷️ 版本控制與發布規範 (Versioning & Release Guide)

## 1. 語意化版本規範 (Semantic Versioning 2.0.0)

本專案遵循嚴格的 [SemVer 2.0.0](https://semver.org/lang/zh-TW/) 規範，版本格式為 `MAJOR.MINOR.PATCH`（如 `1.0.0`）：

| 級別 | 範例 | 何時遞增 | 影響範圍 |
| :--- | :--- | :--- | :--- |
| **MAJOR (主版本)** | `1.0.0 -> 2.0.0` | 存儲結構重大不相容變更、YouTube 協議大改版导致向後不相容。 | 需使用者手動升級或資料移轉。 |
| **MINOR (次版本)** | `1.0.0 -> 1.1.0` | 新增功能（如新增頻道搜尋、統計儀表板、快捷鍵），但向下相容。 | 推薦所有使用者更新。 |
| **PATCH (修訂版本)** | `1.0.0 -> 1.0.1` | Bug 修復、CSS 樣式相容性微調、安全性更新，且向下相容。 | 自動或常規修訂。 |

---

## 2. 版本號單一真實來源 (Single Source of Version Truth)

為避免版本號在專案各處不一致，本專案由 `package.json` 與 `manifest.json` 協同作為版本源，以下三個檔案必須**嚴格保持同步**：

1. `manifest.json` -> `"version": "X.Y.Z"` (Chrome 擴充識別版本)
2. `package.json` -> `"version": "X.Y.Z"` (Node / 套件管理版本)
3. `AGENT_CONTEXT.md` -> `agent_rules_version: "X.Y.Z"` (AI Agent 規則識別)
4. `CHANGELOG.md` -> `## [X.Y.Z] - YYYY-MM-DD` (發布記錄)

---

## 3. Git 提交規範 (Conventional Commits)

每次 Commit 訊息必須遵循語意化提交規範：

```
<類型>(<可選範疇>): <簡短描述>

[可選詳細說明]
```

### 常用類型 (Types):
- `feat`: 新增功能（例如：`feat(feed): add watched video filter button`）
- `fix`: 修復 Bug（例如：`fix(auth): resolve SAPISIDHASH cross-origin failure`）
- `docs`: 僅修改文檔（例如：`docs: add AGENT_CONTEXT and ADRs`）
- `refactor`: 重構代碼（無新增功能亦無 Bug 修復）
- `test`: 新增或調整測試案例
- `chore`: 構建、工具鏈或版本發布管理（例如：`chore(release): bump version to v1.0.1`）

---

## 4. 自動化版本發布流程 (Release Protocol)

專案內建 `scripts/release.js` 自動化腳本，簡化發布流程：

### 發布當前版本標籤 (Current Release)
```bash
node scripts/release.js current
```

### 遞增版本並發布 (Bump & Release)
```bash
# 修訂版本 (1.0.0 -> 1.0.1)
node scripts/release.js patch

# 次版本 (1.0.0 -> 1.1.0)
node scripts/release.js minor

# 主版本 (1.0.0 -> 2.0.0)
node scripts/release.js major
```

### 腳本執行動作：
1. 自動解析並遞增版本號。
2. 一鍵同步更新 `manifest.json`、`package.json` 與 `AGENT_CONTEXT.md`。
3. 自動自 `CHANGELOG.md` 提取該版本之變更摘要。
4. 調用 GitHub REST API 在遠端倉庫自動建立 Git Tag（如 `v1.0.0`）。
5. 自動於 GitHub 建立正式版 Release 發布頁面。
6. **同步更新本地審計日誌**：於 `PROJECT_METRICS_AUDIT.md` 與 `docs/audit/PROJECT_METRICS_AUDIT.md` 流水帳中追加該版本之**本次變化 (Delta)** 與**變更後累計總數 (Cumulative Totals)**（受 `.gitignore` 保護，永不上傳 GitHub）。
