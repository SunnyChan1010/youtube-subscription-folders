# 🧪 專案品質保證與驗證標準手冊 (Verification Playbook)

## 1. 自動化測試驗證 (Automated Verification)

在進行任何 Git 提交前，**必須**在本地終端運行以下自動化測試腳本：

```bash
# 1. 驗證取消訂閱比對算法與進度條回呼
node -e "require('./test/test_unsubscribe.js')"

# 2. 驗證空資料夾保存、Continuation Token 解析與 cross-referencing
node -e "require('./test/test_audit_fixes.js')"
```

**合格標準**：兩項測試均必須輸出 `ALL TESTS PASSED`，退出代碼為 0。

---

## 2. 瀏覽器實機端到端檢測 (E2E Manual & BrowserOS Protocol)

每次修改前端或注入腳本後，依序執行下列檢驗：

| 檢驗步驟 | 測試標的 | 預期正確結果 |
| :--- | :--- | :--- |
| **1. 擴充健康度** | `chrome://extensions` | 重新載入擴充後，頁面上**無任何「錯誤」按鈕**，Service Worker 狀態為「已啟用」。 |
| **2. 頻道主頁** | 訪問任意頻道（如 `/@mkbhd`） | 官方訂閱按鈕旁精確注入「📁 加入分組 ▼」，點擊後浮動選單正確列出所有分組。 |
| **3. 影片播放頁** | 訪問任意影片（如 `/watch?v=...`） | 影片播放器下方作者欄位旁正確顯示「📁 加入分組 ▼」，無遮擋原生按鈕。 |
| **4. 訂閱動態牆** | 訪問 `/feed/subscriptions` | 頂部成功注入分組過濾 Chips 與「👁️ 隱藏已看」按鈕，點擊分組後正確過濾影片卡片。 |
| **5. 管理設定頁** | 開啟 `options.html` | 分組管理、頻道手動新增、拖拉備份匯入正常，操作時彈出藍色邊條 Toast 通知。 |
