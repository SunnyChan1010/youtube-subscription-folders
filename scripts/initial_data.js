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

if (typeof module !== 'undefined') {
  module.exports = YT_INITIAL_DATA;
  module.exports.YT_INITIAL_DATA = YT_INITIAL_DATA;
  module.exports.YT_DEFAULT_AVATAR = YT_DEFAULT_AVATAR;
}
