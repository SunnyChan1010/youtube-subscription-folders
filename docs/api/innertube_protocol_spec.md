# YouTube InnerTube 通訊協議規範 (InnerTube Protocol Spec)

## 1. 協議概覽 (Protocol Overview)
YouTube 網頁客戶端透過其私有 InnerTube JSON REST API 執行所有核心互動（包括訂閱、取消訂閱、動態牆載入）。

- **基礎端點 (Base URL)**: `https://www.youtube.com/youtubei/v1/`
- **內容類型 (Content-Type)**: `application/json`
- **憑證模式 (Credentials)**: `include` (必須攜帶第一方 Cookie: `SID`, `HSID`, `SSID`, `SAPISID`, `LOGIN_INFO`)
- **鑑權機制**:
  - `Authorization: SAPISIDHASH <timestamp>_<sha1(timestamp + " " + SAPISID + " " + origin)>`
  - `X-Origin: https://www.youtube.com`

---

## 2. 核心端點定義 (Endpoints)

### 2.1 訂閱頻道 (Subscribe)
- **POST** `/youtubei/v1/subscription/subscribe`
- **Payload 結構**:
  ```json
  {
    "context": {
      "client": {
        "clientName": "WEB",
        "clientVersion": "2.20240000.00.00",
        "hl": "zh-TW",
        "gl": "TW"
      }
    },
    "channelIds": ["UC..."],
    "params": "..."
  }
  ```
- **成功判定標準 (Success Verification)**:
  回傳 JSON 內之 `actions` 陣列必須包含以下至少一項：
  1. `updateSubscribeButtonAction: { subscribed: true }`
  2. `addToGuideSectionAction: { ... }`
  3. `openPopupAction` 內帶有 Toast 提示（如 `Subscription added` 或 `已新增訂閱`）。
- **失敗/過期判定 (Failure Verification)**:
  若回傳內包含 `modalWithTitleAndButtonRenderer`（如 Session Expired），必須立即標記為 `SESSION_EXPIRED` 錯誤。

### 2.2 取消訂閱 (Unsubscribe)
- **POST** `/youtubei/v1/subscription/unsubscribe`
- **Payload 結構**: 與訂閱相同，傳入目標頻道 `channelIds: ["UC..."]`。
- **成功判定標準**:
  `actions` 陣列包含 `updateSubscribeButtonAction: { subscribed: false }` 或 `removeFromGuideSectionAction`。

### 2.3 解析頻道規範資訊 (Channel Canonical Info)
- **GET** `https://www.youtube.com/@handle` 或 `/channel/UC...`
- **提取標籤**:
  - 頻道 ID: `<meta itemprop="channelId" content="(UC...)">`
  - 頻道名稱: `<meta property="og:title" content="...">`
  - 頭像網址: `<meta property="og:image" content="...">`
  - Canonical Handle: `<link rel="canonical" href="https://www.youtube.com/@...">`
