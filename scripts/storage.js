/**
 * YouTube Subscription Folders - Storage Helper
 * Provides unified access to chrome.storage.local with pre-bundled fallback data.
 */

const YTFolderStorage = (() => {
  const STORAGE_KEYS = {
    FOLDERS: 'yt_folders',
    CHANNELS: 'yt_channels',
    SETTINGS: 'yt_settings',
    INITIALIZED: 'yt_initialized'
  };

  const DEFAULT_SETTINGS = {
    hideWatched: false,
    showInSidebar: true,
    showFeedFilter: true,
    activeFeedFolderId: 'all',
    expandedFolders: {}
  };

  async function getRaw(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  async function setRaw(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve(true));
    });
  }

  function getFallbackData() {
    if (typeof YT_INITIAL_DATA !== 'undefined' && YT_INITIAL_DATA) {
      return YT_INITIAL_DATA;
    }
    return { channels: [], folders: [] };
  }

  // Initialize data from bundled YT_INITIAL_DATA
  async function init(force = false) {
    const raw = await getRaw([STORAGE_KEYS.INITIALIZED, STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS]);
    const hasFolders = Array.isArray(raw[STORAGE_KEYS.FOLDERS]) && raw[STORAGE_KEYS.FOLDERS].length > 0;
    const hasChannels = raw[STORAGE_KEYS.CHANNELS] && Object.keys(raw[STORAGE_KEYS.CHANNELS]).length > 0;

    if (!force && raw[STORAGE_KEYS.INITIALIZED] && hasFolders && hasChannels) {
      return;
    }

    try {
      const data = getFallbackData();

      const channelsMap = {};
      if (Array.isArray(data.channels)) {
        for (const ch of data.channels) {
          if (ch && (ch.id || ch.handle)) {
            const id = ch.id || ch.handle;
            channelsMap[id] = {
              id: id,
              name: ch.name || ch.handle || '',
              handle: ch.handle || '',
              avatarUrl: ch.avatarUrl || ''
            };
          }
        }
      }

      const folders = [];
      const defaultColors = [
        '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
        '#2196f3', '#009688', '#4caf50', '#ff9800', '#795548'
      ];

      if (Array.isArray(data.folders)) {
        data.folders.forEach((f, idx) => {
          const emojiMatch = f.name.match(/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u);
          const icon = emojiMatch ? emojiMatch[0] : '📁';
          folders.push({
            id: f.id || `folder_${Date.now()}_${idx}`,
            name: f.name || `Folder ${idx + 1}`,
            description: f.description || '',
            icon: icon,
            color: defaultColors[idx % defaultColors.length],
            channels: Array.isArray(f.channels) ? f.channels : []
          });
        });
      }

      await setRaw({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.CHANNELS]: channelsMap,
        [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
        [STORAGE_KEYS.INITIALIZED]: true
      });
      console.log(`[YTFolderStorage] Initialized ${folders.length} folders & ${Object.keys(channelsMap).length} channels.`);
    } catch (err) {
      console.error('[YTFolderStorage] Error initializing data:', err);
    }
  }

  async function getFolders() {
    let raw = await getRaw([STORAGE_KEYS.FOLDERS]);
    let folders = raw[STORAGE_KEYS.FOLDERS];
    if (!folders || !Array.isArray(folders) || folders.length === 0) {
      await init(true);
      raw = await getRaw([STORAGE_KEYS.FOLDERS]);
      folders = raw[STORAGE_KEYS.FOLDERS] || [];
    }
    return folders;
  }

  async function setFolders(folders) {
    await setRaw({ [STORAGE_KEYS.FOLDERS]: folders });
    notifyChange();
  }

  async function getChannels() {
    let raw = await getRaw([STORAGE_KEYS.CHANNELS]);
    let channels = raw[STORAGE_KEYS.CHANNELS];
    if (!channels || Object.keys(channels).length === 0) {
      await init(true);
      raw = await getRaw([STORAGE_KEYS.CHANNELS]);
      channels = raw[STORAGE_KEYS.CHANNELS] || {};
    }
    return channels;
  }

  async function setChannels(channels) {
    await setRaw({ [STORAGE_KEYS.CHANNELS]: channels });
    notifyChange();
  }

  async function getSettings() {
    const raw = await getRaw([STORAGE_KEYS.SETTINGS]);
    return Object.assign({}, DEFAULT_SETTINGS, raw[STORAGE_KEYS.SETTINGS]);
  }

  async function updateSettings(partial) {
    const current = await getSettings();
    const updated = Object.assign({}, current, partial);
    await setRaw({ [STORAGE_KEYS.SETTINGS]: updated });
    notifyChange();
    return updated;
  }

  async function addFolder({ name, icon = '📁', color = '#2196f3', description = '' }) {
    const folders = await getFolders();
    const newFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: name.trim(),
      icon: icon || '📁',
      color: color || '#2196f3',
      description: description || '',
      channels: []
    };
    folders.push(newFolder);
    await setFolders(folders);
    return newFolder;
  }

  async function updateFolder(id, changes) {
    const folders = await getFolders();
    const idx = folders.findIndex(f => f.id === id);
    if (idx === -1) return null;
    folders[idx] = Object.assign({}, folders[idx], changes);
    await setFolders(folders);
    return folders[idx];
  }

  async function deleteFolder(id) {
    const folders = await getFolders();
    const filtered = folders.filter(f => f.id !== id);
    await setFolders(filtered);
  }

  async function addChannelToFolder(folderId, channelInfo) {
    const folders = await getFolders();
    const channels = await getChannels();

    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    const chId = channelInfo.id || channelInfo.handle;
    if (!chId) return false;

    if (!folder.channels.includes(chId)) {
      folder.channels.push(chId);
    }

    channels[chId] = {
      id: chId,
      name: channelInfo.name || channels[chId]?.name || chId,
      handle: channelInfo.handle || channels[chId]?.handle || '',
      avatarUrl: channelInfo.avatarUrl || channels[chId]?.avatarUrl || ''
    };

    await setRaw({
      [STORAGE_KEYS.FOLDERS]: folders,
      [STORAGE_KEYS.CHANNELS]: channels
    });
    notifyChange();
    return true;
  }

  async function removeChannelFromFolder(folderId, channelId) {
    const folders = await getFolders();
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    folder.channels = folder.channels.filter(id => id !== channelId);
    await setFolders(folders);
    return true;
  }

  async function toggleChannelInFolder(folderId, channelInfo) {
    const folders = await getFolders();
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    const chId = channelInfo.id || channelInfo.handle;
    // Check match by ID or handle
    const exists = folder.channels.some(id => id === chId || (channelInfo.handle && id === channelInfo.handle));

    if (exists) {
      folder.channels = folder.channels.filter(id => id !== chId && id !== channelInfo.handle);
      await setFolders(folders);
      return false; // Removed
    } else {
      await addChannelToFolder(folderId, channelInfo);
      return true; // Added
    }
  }

  async function getFoldersByChannel(channelId, channelHandle = '') {
    const folders = await getFolders();
    const channels = await getChannels();
    const matchedFolderIds = [];

    const normHandle = channelHandle ? channelHandle.toLowerCase().replace('@', '') : '';
    const normId = channelId ? channelId.toLowerCase() : '';

    for (const folder of folders) {
      if (!Array.isArray(folder.channels)) continue;

      let matched = false;
      if (channelId && folder.channels.includes(channelId)) {
        matched = true;
      }
      if (!matched && channelHandle && folder.channels.includes(channelHandle)) {
        matched = true;
      }
      if (!matched && (normHandle || normId)) {
        matched = folder.channels.some(chId => {
          if (normId && chId.toLowerCase() === normId) return true;
          const ch = channels[chId];
          if (ch) {
            const h = (ch.handle || '').toLowerCase().replace('@', '');
            if (normHandle && h === normHandle) return true;
          }
          return false;
        });
      }

      if (matched) {
        matchedFolderIds.push(folder.id);
      }
    }
    return matchedFolderIds;
  }

  async function getUncategorizedChannels() {
    const folders = await getFolders();
    const channels = await getChannels();
    const assignedIds = new Set();

    folders.forEach(f => {
      if (Array.isArray(f.channels)) {
        f.channels.forEach(id => {
          assignedIds.add(id);
          const ch = channels[id];
          if (ch && ch.handle) assignedIds.add(ch.handle);
        });
      }
    });

    const uncategorized = [];
    for (const [id, ch] of Object.entries(channels)) {
      if (!assignedIds.has(id) && (!ch.handle || !assignedIds.has(ch.handle))) {
        uncategorized.push(ch);
      }
    }
    return uncategorized;
  }

  async function batchAddChannels(channelsArray) {
    const channels = await getChannels();
    let newCount = 0;

    for (const ch of channelsArray) {
      const id = ch.id || ch.handle;
      if (!id) continue;
      if (!channels[id]) {
        newCount++;
      }
      channels[id] = {
        id: id,
        name: ch.name || channels[id]?.name || id,
        handle: ch.handle || channels[id]?.handle || '',
        avatarUrl: ch.avatarUrl || channels[id]?.avatarUrl || ''
      };
    }

    await setRaw({ [STORAGE_KEYS.CHANNELS]: channels });
    notifyChange();
    return { total: Object.keys(channels).length, newCount };
  }

  async function exportData() {
    const folders = await getFolders();
    const channels = await getChannels();
    const settings = await getSettings();
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      folders,
      channels,
      settings
    }, null, 2);
  }

  async function importData(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || (!parsed.folders && !parsed.channels)) {
      throw new Error('無效的備份格式');
    }

    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    const channels = parsed.channels || {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings);

    await setRaw({
      [STORAGE_KEYS.FOLDERS]: folders,
      [STORAGE_KEYS.CHANNELS]: channels,
      [STORAGE_KEYS.SETTINGS]: settings,
      [STORAGE_KEYS.INITIALIZED]: true
    });
    notifyChange();
    return { folderCount: folders.length, channelCount: Object.keys(channels).length };
  }

  function notifyChange() {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('yt-folders-storage-updated'));
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'STORAGE_UPDATED' }).catch(() => {});
    }
  }

  return {
    init,
    getFolders,
    setFolders,
    getChannels,
    setChannels,
    getSettings,
    updateSettings,
    addFolder,
    updateFolder,
    deleteFolder,
    addChannelToFolder,
    removeChannelFromFolder,
    toggleChannelInFolder,
    getFoldersByChannel,
    getUncategorizedChannels,
    batchAddChannels,
    exportData,
    importData
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = YTFolderStorage;
}
