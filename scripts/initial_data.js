/** Default template folders without personal channel data **/
const YT_INITIAL_DATA = {
  "folders": [
    {
      "id": "folder_tech",
      "name": "💻 科技 3C (Tech & AI)",
      "description": "科技最新資訊、AI 工具、軟硬體評測",
      "channels": []
    },
    {
      "id": "folder_gaming",
      "name": "🎮 電玩遊戲 (Gaming)",
      "description": "遊戲實況、新遊試玩、遊戲攻略與精華",
      "channels": []
    },
    {
      "id": "folder_entertainment",
      "name": "🎬 影視娛樂 (Cinema & Movies)",
      "description": "電影影評、電視劇、流行影視解說",
      "channels": []
    },
    {
      "id": "folder_knowledge",
      "name": "🧠 知識成長 (Productivity & Science)",
      "description": "科普知識、思維學習、生產力與個人成長",
      "channels": []
    },
    {
      "id": "folder_music",
      "name": "🎵 音樂生活 (Music & Lifestyle)",
      "description": "音樂串流、生活放鬆、日常休閒",
      "channels": []
    }
  ],
  "channels": [],
  "uncategorizedChannels": []
};
/** Default Channel Avatar SVG (Clean dark theme YouTube user silhouette) **/
const YT_DEFAULT_AVATAR = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiMyODI4MjgiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjgiIHI9IjMuNiIgZmlsbD0iI2FhYWFhYSIvPjxwYXRoIGQ9Ik0xMiAxMy41Yy0zIDAtNi41IDEuNS02LjUgMy41djEuNWgxM3YtMS41YzAtMi0zLjUtMy41LTYuNS0zLjV6IiBmaWxsPSIjYWFhYWFhIi8+PC9zdmc+";

/** Non-channel YouTube system UI action buttons that should never be treated as channel subscriptions **/
const YT_INVALID_CHANNEL_TITLES = new Set([
  'create post', 'create', 'upload video', 'upload', 'go live',
  'your channel', 'your videos', 'settings', 'help', 'feedback', 'send feedback',
  'switch account', 'sign out', 'sign in', 'youtube studio', 'history', 'watch later',
  'liked videos', 'subscriptions', 'trending', 'library', 'explore', 'shorts',
  'your clips', 'your data in youtube', 'purchases and memberships', 'get youtube premium',
  'keyboard shortcuts', 'restricted mode', 'location', 'language',
  '建立貼文', '發布貼文', '发布帖子', '创建帖子', '建立', '创建',
  '上傳影片', '上传视频', '進行直播', '开始直播', '你的頻道', '你的频道',
  '你的影片', '你的视频', '你的剪輯片段', '你的剪辑', '你在 youtube 中的資料',
  '你在 youtube 中的数据', '購買內容與會員資格', '购买内容和会员资格',
  '設定', '设置', '說明', '帮助', '意見反映', '发送反馈', '說明與意見反映',
  '切換帳戶', '切换账号', '登出', '登入', '登錄', '觀看紀錄', '觀看記錄',
  '稍後觀看', '喜歡的影片', '頂過的視頻', '訂閱內容', '订阅内容',
  '發燒影片', '時下流行', '媒體庫', '探索', '鍵盤快速鍵', '键盘快捷键', '嚴格篩選模式', '受限模式',
  '投稿を作成', '動画をアップロード', 'ライブ配信を開始', 'チャンネル', '設定', 'ヘルプ',
  'フィードバックを送信', 'アカウントを切り替え', 'ログアウト', 'ログイン'
]);

function isSystemActionTitle(title) {
  if (!title) return false;
  const clean = String(title).trim().toLowerCase();
  if (YT_INVALID_CHANNEL_TITLES.has(clean)) return true;
  if (/^(create\s+post|upload\s+video|go\s+live|建立貼文|發布貼文|发布帖子|创建帖子)/i.test(clean)) {
    return true;
  }
  return false;
}

if (typeof globalThis !== 'undefined') {
  globalThis.YT_INITIAL_DATA = YT_INITIAL_DATA;
  globalThis.YT_DEFAULT_AVATAR = YT_DEFAULT_AVATAR;
  globalThis.YT_INVALID_CHANNEL_TITLES = YT_INVALID_CHANNEL_TITLES;
  globalThis.isSystemActionTitle = isSystemActionTitle;
}

if (typeof module !== 'undefined') {
  module.exports = YT_INITIAL_DATA;
  module.exports.YT_INITIAL_DATA = YT_INITIAL_DATA;
  module.exports.YT_DEFAULT_AVATAR = YT_DEFAULT_AVATAR;
  module.exports.YT_INVALID_CHANNEL_TITLES = YT_INVALID_CHANNEL_TITLES;
  module.exports.isSystemActionTitle = isSystemActionTitle;
}
