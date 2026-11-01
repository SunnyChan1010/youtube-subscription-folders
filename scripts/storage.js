/**
 * YouTube Subscription Folders - Storage Helper
 * Provides unified access to chrome.storage.local with pre-bundled fallback data.
 * Enhanced with intelligent channel deduplication (prioritizing categorized channels).
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
    hideShorts: false,
    onlyLive: false,
    showInSidebar: true,
    showFeedFilter: true,
    activeFeedFolderId: 'all',
    expandedFolders: {},
    dismissedOnboarding: false
  };

  function normalizeHandle(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase().replace(/^@/, '');
  }

  function checkSystemActionTitle(title) {
    if (!title) return false;
    if (typeof isSystemActionTitle === 'function') {
      return isSystemActionTitle(title);
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.isSystemActionTitle === 'function') {
      return globalThis.isSystemActionTitle(title);
    }
    if (typeof YT_INITIAL_DATA !== 'undefined' && typeof YT_INITIAL_DATA.isSystemActionTitle === 'function') {
      return YT_INITIAL_DATA.isSystemActionTitle(title);
    }
    if (typeof require !== 'undefined') {
      try {
        const initData = require('./initial_data.js');
        if (typeof initData.isSystemActionTitle === 'function') {
          return initData.isSystemActionTitle(title);
        }
      } catch (e) {}
    }
    return false;
  }

  function sanitizeAvatarUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let trimmed = url.trim();
    if (/[\s<>"'`]/.test(trimmed)) return '';
    if (/^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
      return trimmed;
    }
    if (/^\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//i.test(trimmed)) {
      trimmed = 'https:' + trimmed;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return trimmed;
        }
      } catch (e) {}
    }
    return '';
  }

  function sanitizeFolderColor(color) {
    if (!color || typeof color !== 'string') return '#2196f3';
    const trimmed = color.trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ? trimmed : '#2196f3';
  }

  function sanitizeFolderIcon(icon) {
    if (!icon || typeof icon !== 'string') return '📁';
    const clean = icon.replace(/[<>"'&]/g, '').trim();
    return clean ? clean.slice(0, 10) : '📁';
  }

  const LEADING_EMOJI_RE = /^((?:[\u{1F1E6}-\u{1F1FF}]{2})|(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F)?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F)?)*))\s*/u;

  function normalizeFolderIconAndName(rawName, rawIcon) {
    let name = String(rawName || '').trim();
    let icon = sanitizeFolderIcon(rawIcon);
    const hasExplicitCustomIcon = Boolean(rawIcon && String(rawIcon).trim() && sanitizeFolderIcon(rawIcon) !== '📁');

    const match = name.match(LEADING_EMOJI_RE);
    if (match) {
      const leadEmoji = match[1];
      if (!hasExplicitCustomIcon || icon === leadEmoji) {
        icon = sanitizeFolderIcon(leadEmoji);
      }
      if (icon === leadEmoji) {
        while (true) {
          const m = name.match(LEADING_EMOJI_RE);
          if (m && m[1] === leadEmoji) {
            const stripped = name.slice(m[0].length).trim();
            if (stripped.length > 0) {
              name = stripped;
              continue;
            }
          }
          break;
        }
      }
    }

    if (icon && name.startsWith(icon)) {
      const stripped = name.slice(icon.length).trim();
      if (stripped.length > 0) {
        name = stripped;
      }
    }

    return { icon, name };
  }

  function sanitizeSettings(incoming) {
    if (!incoming || typeof incoming !== 'object') return {};
    const safe = {};
    const validKeys = ['hideWatched', 'hideShorts', 'onlyLive', 'showInSidebar', 'showFeedFilter', 'activeFeedFolderId', 'expandedFolders', 'dismissedOnboarding'];
    for (const key of validKeys) {
      if (key in incoming && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        if (key === 'expandedFolders') {
          if (incoming.expandedFolders && typeof incoming.expandedFolders === 'object' && !Array.isArray(incoming.expandedFolders)) {
            safe.expandedFolders = {};
            for (const [k, v] of Object.entries(incoming.expandedFolders)) {
              if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                safe.expandedFolders[String(k).slice(0, 64)] = Boolean(v);
              }
            }
          }
        } else if (typeof incoming[key] === typeof DEFAULT_SETTINGS[key]) {
          safe[key] = incoming[key];
        }
      }
    }
    return safe;
  }

  // Strict FIFO async mutex lock to prevent concurrent Read-Modify-Write race conditions
  let storageMutex = Promise.resolve();

  function withStorageLock(taskFn) {
    const next = storageMutex.then(() => taskFn(), () => taskFn());
    storageMutex = next.catch(() => {});
    return next;
  }

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

  // Unlocked initialization logic
  async function _initUnlocked(force = false) {
    const raw = await getRaw([STORAGE_KEYS.INITIALIZED, STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS]);

    // If already initialized once and not force-resetting, respect existing user data (even if empty)
    if (!force && raw[STORAGE_KEYS.INITIALIZED]) {
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
              avatarUrl: sanitizeAvatarUrl(ch.avatarUrl)
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
          const normalized = normalizeFolderIconAndName(f.name || `Folder ${idx + 1}`, f.icon);
          folders.push({
            id: f.id || `folder_${Date.now()}_${idx}`,
            name: normalized.name,
            description: f.description || '',
            icon: normalized.icon,
            color: defaultColors[idx % defaultColors.length],
            autoKeywords: Array.isArray(f.autoKeywords) ? f.autoKeywords : [],
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

  // Initialize data from bundled YT_INITIAL_DATA
  async function init(force = false) {
    return withStorageLock(() => _initUnlocked(force));
  }

  async function _getFoldersUnlocked() {
    let raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.INITIALIZED]);
    let folders = raw[STORAGE_KEYS.FOLDERS];
    if (!raw[STORAGE_KEYS.INITIALIZED] && (!folders || !Array.isArray(folders))) {
      await _initUnlocked(false);
      raw = await getRaw([STORAGE_KEYS.FOLDERS]);
      folders = raw[STORAGE_KEYS.FOLDERS] || [];
    }
    if (!Array.isArray(folders)) return [];

    // Auto-heal any stored folders that have duplicate leading emoji in name/icon
    let mutated = false;
    for (const f of folders) {
      if (!f || typeof f !== 'object') continue;
      const normalized = normalizeFolderIconAndName(f.name, f.icon);
      if (normalized.name !== f.name || normalized.icon !== f.icon) {
        f.name = normalized.name;
        f.icon = normalized.icon;
        mutated = true;
      }
      if (!Array.isArray(f.autoKeywords)) {
        if (typeof f.autoKeywords === 'string' && f.autoKeywords.trim()) {
          f.autoKeywords = f.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean);
          mutated = true;
        } else {
          f.autoKeywords = [];
        }
      }
    }

    return folders;
  }

  async function getFolders() {
    return await _getFoldersUnlocked();
  }

  async function _setFoldersUnlocked(folders) {
    await setRaw({ [STORAGE_KEYS.FOLDERS]: folders });
    notifyChange();
  }

  async function setFolders(folders) {
    return withStorageLock(() => _setFoldersUnlocked(folders));
  }

  async function _getChannelsUnlocked() {
    let raw = await getRaw([STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    let channels = raw[STORAGE_KEYS.CHANNELS];

    // Auto-migrate array storage into dictionary format if needed
    if (Array.isArray(channels)) {
      const map = {};
      channels.forEach(ch => {
        if (ch && (ch.id || ch.handle)) {
          const cid = ch.id || ch.handle;
          map[cid] = {
            id: cid,
            name: ch.name || ch.handle || cid,
            handle: ch.handle || '',
            avatarUrl: sanitizeAvatarUrl(ch.avatarUrl)
          };
        }
      });
      channels = map;
    }

    if (!raw[STORAGE_KEYS.INITIALIZED] && (!channels || typeof channels !== 'object')) {
      await _initUnlocked(false);
      raw = await getRaw([STORAGE_KEYS.CHANNELS]);
      channels = raw[STORAGE_KEYS.CHANNELS] || {};
    }

    // Auto-sanitize channels against non-channel system action titles (e.g. "Create post", "Settings", etc.)
    if (channels && typeof channels === 'object') {
      let hasInvalid = false;
      for (const [key, ch] of Object.entries(channels)) {
        if (!ch) continue;
        const testName = ch.name || '';
        const testHandle = ch.handle || '';
        if (checkSystemActionTitle(testName) || checkSystemActionTitle(key) || checkSystemActionTitle(testHandle)) {
          delete channels[key];
          hasInvalid = true;
        }
      }
    }

    return (channels && typeof channels === 'object') ? channels : {};
  }

  async function getChannels() {
    return await _getChannelsUnlocked();
  }

  async function _setChannelsUnlocked(channels) {
    await setRaw({ [STORAGE_KEYS.CHANNELS]: channels });
    notifyChange();
  }

  async function setChannels(channels) {
    return withStorageLock(() => _setChannelsUnlocked(channels));
  }

  async function getSettings() {
    const raw = await getRaw([STORAGE_KEYS.SETTINGS]);
    return Object.assign({}, DEFAULT_SETTINGS, raw[STORAGE_KEYS.SETTINGS]);
  }

  async function updateSettings(partial) {
    return withStorageLock(async () => {
      const current = await getSettings();
      const updated = Object.assign({}, current, sanitizeSettings(partial));
      await setRaw({ [STORAGE_KEYS.SETTINGS]: updated });
      notifyChange();
      return updated;
    });
  }

  async function addFolder({ name, icon = '📁', color = '#2196f3', description = '', autoKeywords = [] }) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const normalized = normalizeFolderIconAndName(name, icon);
      const safeKeywords = Array.isArray(autoKeywords)
        ? autoKeywords.map(k => String(k).trim()).filter(Boolean)
        : (typeof autoKeywords === 'string' ? autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);
      const newFolder = {
        id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: normalized.name,
        icon: normalized.icon,
        color: sanitizeFolderColor(color),
        description: String(description || '').trim(),
        autoKeywords: safeKeywords,
        channels: []
      };
      folders.push(newFolder);
      await _setFoldersUnlocked(folders);
      return newFolder;
    });
  }

  async function updateFolder(id, changes) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const idx = folders.findIndex(f => f.id === id);
      if (idx === -1) return null;
      const safeChanges = { ...changes };
      if (safeChanges.color !== undefined) safeChanges.color = sanitizeFolderColor(safeChanges.color);
      if (safeChanges.description !== undefined) safeChanges.description = String(safeChanges.description).trim();
      if (safeChanges.autoKeywords !== undefined) {
        safeChanges.autoKeywords = Array.isArray(safeChanges.autoKeywords)
          ? safeChanges.autoKeywords.map(k => String(k).trim()).filter(Boolean)
          : (typeof safeChanges.autoKeywords === 'string' ? safeChanges.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);
      }
      if (safeChanges.name !== undefined || safeChanges.icon !== undefined) {
        const nextRawName = safeChanges.name !== undefined ? safeChanges.name : folders[idx].name;
        const nextRawIcon = safeChanges.icon !== undefined ? safeChanges.icon : folders[idx].icon;
        const normalized = normalizeFolderIconAndName(nextRawName, nextRawIcon);
        safeChanges.name = normalized.name;
        safeChanges.icon = normalized.icon;
      }
      folders[idx] = Object.assign({}, folders[idx], safeChanges);
      await _setFoldersUnlocked(folders);
      return folders[idx];
    });
  }

  async function deleteFolder(id) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const filtered = folders.filter(f => f.id !== id);
      await _setFoldersUnlocked(filtered);
      return true;
    });
  }

  async function reorderFolders(newOrderIds) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const folderMap = new Map(folders.map(f => [f.id, f]));
      const reordered = [];
      for (const id of newOrderIds) {
        if (folderMap.has(id)) {
          reordered.push(folderMap.get(id));
          folderMap.delete(id);
        }
      }
      for (const remaining of folderMap.values()) {
        reordered.push(remaining);
      }
      await _setFoldersUnlocked(reordered);
      return reordered;
    });
  }

  // ---------------------------------------------------------------------------
  // Core Deduplication Engine
  // ---------------------------------------------------------------------------
  function deduplicateData({
    folders = [],
    channels = [],
    uncategorizedChannels = [],
    options = {}
  }) {
    const singleFolderMode = options.singleFolderMode !== false; // default true
    const prioritizeCategorized = options.prioritizeCategorized !== false; // default true

    // 1. Gather all raw channel objects
    const rawChannelsList = [];
    function addRaw(item) {
      if (!item) return;
      if (Array.isArray(item)) {
        item.forEach(addRaw);
      } else if (typeof item === 'object') {
        if (item.id || item.handle || item.name) {
          if (!checkSystemActionTitle(item.name) && !checkSystemActionTitle(item.handle) && !checkSystemActionTitle(item.id)) {
            rawChannelsList.push(item);
          }
        } else {
          Object.values(item).forEach(addRaw);
        }
      }
    }

    addRaw(channels);
    addRaw(uncategorizedChannels);

    folders.forEach(f => {
      if (Array.isArray(f.channels)) {
        f.channels.forEach(chItem => {
          if (typeof chItem === 'object' && chItem !== null) {
            addRaw(chItem);
          }
        });
      }
    });

    // 2. Build Canonical Channel Registry (O(1) hash-indexed merging)
    const canonicalList = [];
    const canonicalByKey = new Map();
    const aliasToCanonicalId = {};

    function registerCanonicalKeys(canon, rawId = '', rawHandle = '') {
      const candidates = [canon.id, canon.handle, rawId, rawHandle];
      for (const token of candidates) {
        if (!token) continue;
        const lower = String(token).trim().toLowerCase();
        const norm = normalizeHandle(lower);
        if (lower) canonicalByKey.set(lower, canon);
        if (norm) {
          canonicalByKey.set(norm, canon);
          canonicalByKey.set('@' + norm, canon);
        }
      }
    }

    function findCanonical(item) {
      if (!item) return null;
      const idStr = item.id ? String(item.id).trim().toLowerCase() : '';
      const idNorm = normalizeHandle(idStr);
      const hStr = normalizeHandle(item.handle);

      if (idStr && canonicalByKey.has(idStr)) return canonicalByKey.get(idStr);
      if (hStr && canonicalByKey.has(hStr)) return canonicalByKey.get(hStr);
      if (hStr && canonicalByKey.has('@' + hStr)) return canonicalByKey.get('@' + hStr);
      if (idNorm && canonicalByKey.has(idNorm)) return canonicalByKey.get(idNorm);
      return null;
    }

    for (const raw of rawChannelsList) {
      const rawId = raw.id ? String(raw.id).trim() : '';
      const rawHandle = raw.handle ? String(raw.handle).trim() : '';
      const rawName = raw.name ? String(raw.name).trim() : '';
      const rawAvatar = raw.avatarUrl || '';

      let canon = findCanonical(raw);
      if (!canon) {
        canon = {
          id: rawId || (rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle),
          handle: rawHandle ? (rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle) : '',
          name: rawName || rawHandle || rawId,
          avatarUrl: sanitizeAvatarUrl(rawAvatar),
          isSubscribed: raw.isSubscribed !== false
        };
        canonicalList.push(canon);
      } else {
        // Merge attributes: prioritize real UC channel ID
        if (rawId && rawId.startsWith('UC')) {
          canon.id = rawId;
        }
        if (!canon.handle && rawHandle) {
          canon.handle = rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle;
        }
        if (!canon.avatarUrl && rawAvatar) {
          canon.avatarUrl = sanitizeAvatarUrl(rawAvatar);
        }
        if (rawName && (!canon.name || canon.name.startsWith('@') || canon.name.startsWith('UC'))) {
          canon.name = rawName;
        }
        if (raw.isSubscribed === true) {
          canon.isSubscribed = true;
        } else if (raw.isSubscribed === false && canon.isSubscribed !== true) {
          canon.isSubscribed = false;
        }
      }

      registerCanonicalKeys(canon, rawId, rawHandle);

      if (rawId) {
        aliasToCanonicalId[rawId.toLowerCase()] = canon.id;
      }
      if (rawHandle) {
        const nh = normalizeHandle(rawHandle);
        aliasToCanonicalId[nh] = canon.id;
        aliasToCanonicalId['@' + nh] = canon.id;
      }
    }

    function resolveToCanonicalId(ref) {
      if (!ref) return null;
      if (typeof ref === 'object') {
        const direct = findCanonical(ref);
        const resolvedId = direct ? direct.id : (ref.id || ref.handle);
        if (checkSystemActionTitle(resolvedId) || checkSystemActionTitle(ref.name) || checkSystemActionTitle(ref.handle)) {
          return null;
        }
        return resolvedId;
      }
      const str = String(ref).trim();
      if (checkSystemActionTitle(str)) return null;
      const lower = str.toLowerCase();
      if (aliasToCanonicalId[lower]) return aliasToCanonicalId[lower];
      const nh = normalizeHandle(str);
      if (aliasToCanonicalId[nh]) return aliasToCanonicalId[nh];
      if (aliasToCanonicalId['@' + nh]) return aliasToCanonicalId['@' + nh];

      const direct = findCanonical({ id: str, handle: str });
      return direct ? direct.id : str;
    }

    // 3. Process Folders & Deduplicate Channel References
    let dupInSameFolder = 0;
    let dupAcrossFolders = 0;
    const seenInAnyFolder = new Set();
    const cleanFolders = [];

    for (const f of folders) {
      const fChannels = [];
      const seenInThisFolder = new Set();
      const rawRefs = Array.isArray(f.channels) ? f.channels : [];

      for (const rawRef of rawRefs) {
        const canonId = resolveToCanonicalId(rawRef);
        if (!canonId) continue;

        const canonKey = canonId.toLowerCase();

        // Check duplicate within the same folder
        if (seenInThisFolder.has(canonKey)) {
          dupInSameFolder++;
          continue;
        }

        // Check duplicate across folders (if singleFolderMode is enabled)
        if (singleFolderMode && seenInAnyFolder.has(canonKey)) {
          dupAcrossFolders++;
          continue; // Prioritize keeping in the first folder, delete redundant subsequent assignment
        }

        seenInThisFolder.add(canonKey);
        seenInAnyFolder.add(canonKey);
        fChannels.push(canonId);

        // Ensure canonicalList has this channel (O(1) via canonicalByKey)
        if (!canonicalByKey.has(canonKey)) {
          const newCanon = {
            id: canonId,
            handle: canonId.startsWith('@') ? canonId : '',
            name: canonId,
            avatarUrl: '',
            isSubscribed: true
          };
          canonicalList.push(newCanon);
          registerCanonicalKeys(newCanon, canonId, newCanon.handle);
        }
      }

      const normalizedFolder = normalizeFolderIconAndName(f.name || `Folder ${cleanFolders.length + 1}`, f.icon);
      cleanFolders.push({
        id: String(f.id || `folder_${Date.now()}_${cleanFolders.length}`).trim(),
        name: normalizedFolder.name,
        icon: normalizedFolder.icon,
        color: sanitizeFolderColor(f.color),
        description: String(f.description || '').trim(),
        channels: fChannels
      });
    }

    // 4. Build Clean Channels Dictionary (keyed by canonical ID)
    const cleanChannelsMap = {};
    for (const c of canonicalList) {
      cleanChannelsMap[c.id] = c;
    }

    // 5. Deduplicate Uncategorized Channels
    // Channels categorized in any folder are prioritized; redundant uncategorized copies are deleted.
    let dupUncategorizedRemoved = 0;
    const cleanUncategorized = [];
    const seenUncategorized = new Set();

    for (const u of uncategorizedChannels) {
      const uId = resolveToCanonicalId(u.id || u.handle || u);
      if (!uId) continue;
      const uKey = uId.toLowerCase();

      if (prioritizeCategorized && seenInAnyFolder.has(uKey)) {
        dupUncategorizedRemoved++;
      } else if (!seenInAnyFolder.has(uKey)) {
        if (!seenUncategorized.has(uKey)) {
          seenUncategorized.add(uKey);
          const chObj = cleanChannelsMap[uId] || {
            id: uId,
            name: u.name || uId,
            handle: u.handle || '',
            avatarUrl: sanitizeAvatarUrl(u.avatarUrl),
            isSubscribed: u.isSubscribed !== false
          };
          cleanUncategorized.push(chObj);
        } else {
          dupUncategorizedRemoved++;
        }
      }
    }

    const totalRemoved = dupInSameFolder + dupAcrossFolders + dupUncategorizedRemoved;

    return {
      cleanFolders,
      cleanChannelsMap,
      cleanUncategorized,
      removedCount: totalRemoved,
      stats: {
        dupInSameFolder,
        dupAcrossFolders,
        dupUncategorizedRemoved
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Channel CRUD & Management
  // ---------------------------------------------------------------------------
  async function _addChannelToFolderUnlocked(folderId, channelInfo) {
    const folders = await _getFoldersUnlocked();
    const channels = await _getChannelsUnlocked();

    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    const chId = channelInfo.id || channelInfo.handle;
    if (!chId) return false;

    // Check if channel already exists under an alias or handle
    let canonicalId = chId;
    const chNorm = normalizeHandle(chId);
    const existing = Object.values(channels).find(c =>
      (c.id && c.id.toLowerCase() === chId.toLowerCase()) ||
      (c.handle && normalizeHandle(c.handle) === chNorm)
    );
    if (existing) {
      canonicalId = existing.id || chId;
    }

    if (!Array.isArray(folder.channels)) {
      folder.channels = [];
    }

    // Ensure no duplicate in this folder
    const alreadyInFolder = folder.channels.some(id =>
      id.toLowerCase() === canonicalId.toLowerCase() ||
      (existing?.handle && normalizeHandle(id) === normalizeHandle(existing.handle))
    );

    if (!alreadyInFolder) {
      folder.channels.push(canonicalId);
    }

    channels[canonicalId] = {
      id: canonicalId,
      name: channelInfo.name || existing?.name || canonicalId,
      handle: channelInfo.handle || existing?.handle || (canonicalId.startsWith('@') ? canonicalId : ''),
      avatarUrl: sanitizeAvatarUrl(channelInfo.avatarUrl) || sanitizeAvatarUrl(existing?.avatarUrl) || '',
      isSubscribed: channelInfo.isSubscribed !== undefined ? Boolean(channelInfo.isSubscribed) : (existing?.isSubscribed !== false)
    };

    await setRaw({
      [STORAGE_KEYS.FOLDERS]: folders,
      [STORAGE_KEYS.CHANNELS]: channels
    });
    notifyChange();
    return true;
  }

  async function addChannelToFolder(folderId, channelInfo) {
    return withStorageLock(() => _addChannelToFolderUnlocked(folderId, channelInfo));
  }

  async function _removeChannelFromFolderUnlocked(folderId, channelId) {
    const folders = await _getFoldersUnlocked();
    const channels = await _getChannelsUnlocked();
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !Array.isArray(folder.channels)) return false;

    const normTarget = normalizeHandle(channelId);
    const targetLower = (channelId || '').toLowerCase();

    folder.channels = folder.channels.filter(id => {
      if (!id) return false;
      if (id === channelId) return false;
      if (id.toLowerCase() === targetLower) return false;
      if (normTarget && normalizeHandle(id) === normTarget) return false;

      // Cross-reference via channels dictionary
      const ch = channels[id];
      if (ch) {
        if (targetLower && ch.id && ch.id.toLowerCase() === targetLower) return false;
        if (normTarget && ch.handle && normalizeHandle(ch.handle) === normTarget) return false;
      }
      return true;
    });

    await _setFoldersUnlocked(folders);
    return true;
  }

  async function removeChannelFromFolder(folderId, channelId) {
    return withStorageLock(() => _removeChannelFromFolderUnlocked(folderId, channelId));
  }

  function _buildChannelMatcher(channelKeys, channels) {
    const lowerIds = new Set();
    const normHandles = new Set();

    channelKeys.forEach(k => {
      if (!k) return;
      const strK = String(k).trim();
      lowerIds.add(strK.toLowerCase());
      const nh = normalizeHandle(strK);
      if (nh) normHandles.add(nh);

      // Cross-reference channels dictionary
      let ch = channels[strK];
      if (!ch) {
        ch = Object.values(channels).find(c =>
          (c.id && c.id.toLowerCase() === strK.toLowerCase()) ||
          (c.handle && normalizeHandle(c.handle) === nh)
        );
      }
      if (ch) {
        if (ch.id) lowerIds.add(ch.id.toLowerCase());
        if (ch.handle) {
          const cnh = normalizeHandle(ch.handle);
          if (cnh) normHandles.add(cnh);
        }
      }
    });

    const isMatch = (cid) => {
      if (!cid) return false;
      const cStr = String(cid).trim();
      const cLower = cStr.toLowerCase();
      if (lowerIds.has(cLower)) return true;
      const cNormH = normalizeHandle(cStr);
      if (cNormH && normHandles.has(cNormH)) return true;

      const ch = channels[cStr];
      if (ch) {
        if (ch.id && lowerIds.has(ch.id.toLowerCase())) return true;
        if (ch.handle && normHandles.has(normalizeHandle(ch.handle))) return true;
      }
      return false;
    };

    return { lowerIds, normHandles, isMatch };
  }

  /**
   * Atomically moves a batch of channels into a target folder and optionally removes them from source folder.
   */
  async function batchMoveChannels(sourceFolderId, targetFolderId, channelKeys) {
    if (!targetFolderId || !Array.isArray(channelKeys) || channelKeys.length === 0) {
      return { success: false, movedCount: 0 };
    }
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();
      const targetFolder = folders.find(f => f.id === targetFolderId);
      if (!targetFolder) return { success: false, movedCount: 0 };
      if (!Array.isArray(targetFolder.channels)) targetFolder.channels = [];

      const sourceFolder = (sourceFolderId && sourceFolderId !== '__uncategorized__')
        ? folders.find(f => f.id === sourceFolderId)
        : null;

      const { isMatch } = _buildChannelMatcher(channelKeys, channels);

      let movedCount = 0;
      for (const k of channelKeys) {
        const strK = String(k).trim();
        let ch = channels[strK];
        if (!ch) {
          const nh = normalizeHandle(strK);
          ch = Object.values(channels).find(c =>
            (c.id && c.id.toLowerCase() === strK.toLowerCase()) ||
            (c.handle && normalizeHandle(c.handle) === nh)
          );
        }
        const canonicalId = (ch && ch.id && ch.id.startsWith('UC')) ? ch.id : (ch?.id || strK);

        const existsInTarget = targetFolder.channels.some(cid => {
          if (cid === canonicalId) return true;
          const singleMatcher = _buildChannelMatcher([canonicalId], channels);
          return singleMatcher.isMatch(cid);
        });

        if (!existsInTarget) {
          targetFolder.channels.push(canonicalId);
          movedCount++;
        }
      }

      if (sourceFolder && Array.isArray(sourceFolder.channels)) {
        sourceFolder.channels = sourceFolder.channels.filter(cid => !isMatch(cid));
      }

      await _setFoldersUnlocked(folders);
      return { success: true, movedCount };
    });
  }

  /**
   * Atomically removes a batch of channels from a single folder.
   */
  async function batchRemoveChannelsFromFolder(folderId, channelKeys) {
    if (!folderId || !Array.isArray(channelKeys) || channelKeys.length === 0) {
      return { success: false, removedCount: 0 };
    }
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();
      const folder = folders.find(f => f.id === folderId);
      if (!folder || !Array.isArray(folder.channels)) return { success: false, removedCount: 0 };

      const { isMatch } = _buildChannelMatcher(channelKeys, channels);

      const prevCount = folder.channels.length;
      folder.channels = folder.channels.filter(cid => !isMatch(cid));

      const removedCount = prevCount - folder.channels.length;
      await _setFoldersUnlocked(folders);
      return { success: true, removedCount };
    });
  }

  /**
   * Helper to determine if two channel representations are conclusively distinct entities
   * (e.g. they possess two different verified UC IDs or two different non-empty handles).
   */
  function isDistinctChannel(targetId, targetHandle, candidateId, candidateHandle) {
    const tId = String(targetId || '').trim();
    const cId = String(candidateId || '').trim();
    if (tId && cId && tId.startsWith('UC') && cId.startsWith('UC') && tId.toLowerCase() !== cId.toLowerCase()) {
      return true; // Two distinct verified UC IDs
    }
    const tH = normalizeHandle(targetHandle || (tId.startsWith('@') ? tId : ''));
    const cH = normalizeHandle(candidateHandle || (cId.startsWith('@') ? cId : ''));
    if (tH && cH && tH !== cH) {
      return true; // Two distinct handles
    }
    return false;
  }

  /**
   * Checks if a channel name or handle matches any defined folder autoKeywords
   */
  function matchesAutoKeywords(channelOrName, channelHandleOrKeywords, maybeKeywords) {
    let channelName = '';
    let channelHandle = '';
    let rawKeywords = null;

    let channelDesc = '';

    if (channelOrName && typeof channelOrName === 'object') {
      channelName = channelOrName.name || channelOrName.title || '';
      channelHandle = channelOrName.handle || '';
      channelDesc = channelOrName.description || '';
      rawKeywords = channelHandleOrKeywords;
    } else {
      channelName = channelOrName || '';
      channelHandle = channelHandleOrKeywords || '';
      rawKeywords = maybeKeywords;
    }

    const keywords = Array.isArray(rawKeywords)
      ? rawKeywords
      : (typeof rawKeywords === 'string' ? rawKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);

    if (keywords.length === 0) return false;
    const nameStr = String(channelName || '').toLowerCase();
    const handleStr = String(channelHandle || '').toLowerCase().replace(/^@/, '');
    const descStr = String(channelDesc || '').toLowerCase();

    for (const kw of keywords) {
      if (!kw || typeof kw !== 'string') continue;
      const cleanKw = kw.trim();
      if (!cleanKw) continue;
      if (cleanKw.startsWith('/') && cleanKw.lastIndexOf('/') > 1) {
        try {
          const pattern = cleanKw.slice(1, cleanKw.lastIndexOf('/'));
          const flags = cleanKw.slice(cleanKw.lastIndexOf('/') + 1) || 'i';
          const re = new RegExp(pattern, flags);
          if (re.test(channelName || '') || re.test(channelHandle || '') || re.test(channelDesc || '')) return true;
        } catch (e) {}
      } else {
        const kwLower = cleanKw.toLowerCase();
        if (nameStr.includes(kwLower) || handleStr.includes(kwLower) || (descStr && descStr.includes(kwLower))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Synchronously removes a channel from all folders and marks it as unsubscribed.
   * Matches across folder lists by canonical ID, @handle, aliases, and channel registry.
   */
  async function removeChannelFromAllFolders(channelId, channelHandle = '', channelName = '', { purgeFromStorage = false } = {}) {
    if (!channelId && !channelHandle && !channelName) return { success: false, removedCount: 0, affectedFolderIds: [] };

    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();

      const normTargetHandle = normalizeHandle(channelHandle || channelId);
      const targetLower = (channelId || '').toLowerCase();
      const handleLower = (channelHandle || '').toLowerCase();
      const nameLower = (channelName || '').trim().toLowerCase();

      // Identify all matching aliases/keys representing this channel
      const matchingIds = new Set();
      if (targetLower) matchingIds.add(targetLower);
      if (handleLower) {
        matchingIds.add(handleLower);
        if (!handleLower.startsWith('@')) matchingIds.add('@' + handleLower);
      }
      if (normTargetHandle) {
        matchingIds.add(normTargetHandle);
        matchingIds.add('@' + normTargetHandle);
      }

      // Expand matches using channels dictionary
      const keysToDelete = new Set();
      for (const [key, ch] of Object.entries(channels)) {
        if (!ch) continue;
        const kLower = key.toLowerCase();
        const kNorm = normalizeHandle(key);
        const chIdLower = (ch.id || '').toLowerCase();
        const chHandleNorm = normalizeHandle(ch.handle || '');
        const chHandleLower = (ch.handle || '').toLowerCase();
        const chNameLower = (ch.name || '').trim().toLowerCase();

        const isMatch = (
          matchingIds.has(kLower) ||
          (kNorm && matchingIds.has(kNorm)) ||
          (chIdLower && matchingIds.has(chIdLower)) ||
          (chHandleNorm && matchingIds.has(chHandleNorm)) ||
          (chHandleLower && matchingIds.has(chHandleLower)) ||
          (nameLower && chNameLower && chNameLower === nameLower && !isDistinctChannel(channelId, channelHandle, ch.id, ch.handle))
        );

        if (isMatch) {
          matchingIds.add(kLower);
          if (ch.id) matchingIds.add(ch.id.toLowerCase());
          if (ch.handle) {
            matchingIds.add(ch.handle.toLowerCase());
            const hNorm = normalizeHandle(ch.handle);
            if (hNorm) {
              matchingIds.add(hNorm);
              matchingIds.add('@' + hNorm);
            }
          }
          if (purgeFromStorage) {
            keysToDelete.add(key);
          } else {
            ch.isSubscribed = false;
          }
        }
      }

      if (purgeFromStorage) {
        for (const k of keysToDelete) {
          delete channels[k];
        }
        if (targetLower && channels[targetLower]) {
          delete channels[targetLower];
        }
      } else {
        // Direct key check
        if (targetLower && channels[targetLower]) {
          channels[targetLower].isSubscribed = false;
        }
      }

      let totalRemoved = 0;
      const affectedFolderIds = [];

      // Filter each folder's channel list
      for (const folder of folders) {
        if (!Array.isArray(folder.channels) || folder.channels.length === 0) continue;

        const prevLen = folder.channels.length;
        folder.channels = folder.channels.filter(id => {
          if (!id) return false;
          const idLower = String(id).toLowerCase();
          const idNorm = normalizeHandle(id);

          if (matchingIds.has(idLower)) return false;
          if (idNorm && matchingIds.has(idNorm)) return false;

          const ch = channels[id];
          if (ch) {
            if (ch.id && matchingIds.has(ch.id.toLowerCase())) return false;
            if (ch.handle) {
              if (matchingIds.has(ch.handle.toLowerCase())) return false;
              const hNorm = normalizeHandle(ch.handle);
              if (hNorm && matchingIds.has(hNorm)) return false;
            }
            if (nameLower && ch.name && ch.name.trim().toLowerCase() === nameLower && !isDistinctChannel(channelId, channelHandle, ch.id, ch.handle)) return false;
          }

          return true;
        });

        const removedInFolder = prevLen - folder.channels.length;
        if (removedInFolder > 0) {
          totalRemoved += removedInFolder;
          affectedFolderIds.push(folder.id);
        }
      }

      await setRaw({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.CHANNELS]: channels
      });
      notifyChange();

      return {
        success: true,
        removedCount: totalRemoved,
        affectedFolderIds
      };
    });
  }

  /**
   * Atomically removes a batch of unsubscribed channels across all folders and purges them from channels registry.
   */
  async function batchRemoveUnsubscribedChannels(channelsList = [], { purgeFromStorage = true } = {}) {
    if (!Array.isArray(channelsList) || channelsList.length === 0) {
      return { success: true, removedChannelsCount: 0, totalFolderEntriesRemoved: 0, affectedFolderIds: [] };
    }

    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();

      // 1. Build a comprehensive set of tokens/IDs/handles to remove
      const matchingIds = new Set();
      const namesToPurge = new Set();

      for (const item of channelsList) {
        if (!item) continue;
        const id = typeof item === 'string' ? item : (item.id || '');
        const handle = typeof item === 'object' ? (item.handle || '') : '';
        const name = typeof item === 'object' ? (item.name || '') : '';

        const targetLower = (id || '').toLowerCase().trim();
        const handleLower = (handle || '').toLowerCase().trim();
        const normHandle = normalizeHandle(handle || id);
        const nameLower = (name || '').toLowerCase().trim();

        if (targetLower) matchingIds.add(targetLower);
        if (handleLower) {
          matchingIds.add(handleLower);
          if (!handleLower.startsWith('@')) matchingIds.add('@' + handleLower);
        }
        if (normHandle) {
          matchingIds.add(normHandle);
          matchingIds.add('@' + normHandle);
        }
        if (nameLower && nameLower !== targetLower) {
          namesToPurge.add(nameLower);
        }
      }

      // 2. Expand matches using channels dictionary
      const keysToDelete = new Set();
      for (const [key, ch] of Object.entries(channels)) {
        if (!ch) continue;
        const kLower = key.toLowerCase();
        const kNorm = normalizeHandle(key);
        const chIdLower = (ch.id || '').toLowerCase();
        const chHandleNorm = normalizeHandle(ch.handle || '');
        const chHandleLower = (ch.handle || '').toLowerCase();
        const chNameLower = (ch.name || '').trim().toLowerCase();

        let isNameMatched = false;
        if (chNameLower && namesToPurge.has(chNameLower)) {
          for (const item of channelsList) {
            const iName = (item.name || '').trim().toLowerCase();
            if (iName === chNameLower && !isDistinctChannel(item.id, item.handle, ch.id, ch.handle)) {
              isNameMatched = true;
              break;
            }
          }
        }

        const isMatch = (
          matchingIds.has(kLower) ||
          (kNorm && matchingIds.has(kNorm)) ||
          (chIdLower && matchingIds.has(chIdLower)) ||
          (chHandleNorm && matchingIds.has(chHandleNorm)) ||
          (chHandleLower && matchingIds.has(chHandleLower)) ||
          isNameMatched
        );

        if (isMatch) {
          matchingIds.add(kLower);
          if (ch.id) matchingIds.add(ch.id.toLowerCase());
          if (ch.handle) {
            matchingIds.add(ch.handle.toLowerCase());
            const hNorm = normalizeHandle(ch.handle);
            if (hNorm) {
              matchingIds.add(hNorm);
              matchingIds.add('@' + hNorm);
            }
          }
          if (purgeFromStorage) {
            keysToDelete.add(key);
          } else {
            ch.isSubscribed = false;
          }
        }
      }

      if (purgeFromStorage) {
        for (const k of keysToDelete) {
          delete channels[k];
        }
      }

      // 3. Filter all folders
      let totalFolderEntriesRemoved = 0;
      const affectedFolderIds = [];

      for (const folder of folders) {
        if (!Array.isArray(folder.channels) || folder.channels.length === 0) continue;

        const prevLen = folder.channels.length;
        folder.channels = folder.channels.filter(id => {
          if (!id) return false;
          const idLower = String(id).toLowerCase();
          const idNorm = normalizeHandle(id);

          if (matchingIds.has(idLower)) return false;
          if (idNorm && matchingIds.has(idNorm)) return false;

          const ch = channels[id];
          if (ch) {
            if (ch.id && matchingIds.has(ch.id.toLowerCase())) return false;
            if (ch.handle) {
              if (matchingIds.has(ch.handle.toLowerCase())) return false;
              const hNorm = normalizeHandle(ch.handle);
              if (hNorm && matchingIds.has(hNorm)) return false;
            }
            if (ch.name && namesToPurge.has(ch.name.trim().toLowerCase())) {
              for (const item of channelsList) {
                if ((item.name || '').trim().toLowerCase() === ch.name.trim().toLowerCase() && !isDistinctChannel(item.id, item.handle, ch.id, ch.handle)) {
                  return false;
                }
              }
            }
          }

          return true;
        });

        const removedInFolder = prevLen - folder.channels.length;
        if (removedInFolder > 0) {
          totalFolderEntriesRemoved += removedInFolder;
          affectedFolderIds.push(folder.id);
        }
      }

      await setRaw({
        [STORAGE_KEYS.FOLDERS]: folders,
        [STORAGE_KEYS.CHANNELS]: channels
      });
      notifyChange();

      return {
        success: true,
        removedChannelsCount: channelsList.length,
        totalFolderEntriesRemoved,
        affectedFolderIds
      };
    });
  }

  /**
   * Enriches stored channels metadata (avatarUrl, name, handle) from live YouTube subscription data.
   */
  async function enrichChannelsMetadata(liveChannelsList = []) {
    if (!Array.isArray(liveChannelsList) || liveChannelsList.length === 0) {
      return { updatedCount: 0 };
    }

    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();
      let updatedCount = 0;
      let foldersChanged = false;

      // Build O(1) lookup index for existing channels
      const keyByIdOrHandle = new Map();
      for (const [key, ch] of Object.entries(channels)) {
        if (!ch) continue;
        keyByIdOrHandle.set(key.toLowerCase(), key);
        const kNorm = normalizeHandle(key);
        if (kNorm) keyByIdOrHandle.set(kNorm, key);
        if (ch.id) keyByIdOrHandle.set(ch.id.toLowerCase(), key);
        if (ch.handle) {
          const chH = normalizeHandle(ch.handle);
          if (chH) keyByIdOrHandle.set(chH, key);
        }
      }

      for (const liveCh of liveChannelsList) {
        if (!liveCh) continue;
        const lId = liveCh.id ? String(liveCh.id).trim() : '';
        const lHandle = liveCh.handle ? String(liveCh.handle).trim() : '';
        const lNormHandle = normalizeHandle(lHandle);
        const lName = liveCh.name ? String(liveCh.name).trim() : '';
        const lAvatar = sanitizeAvatarUrl(liveCh.avatarUrl);

        if (!lId && !lHandle) continue;
        if (checkSystemActionTitle(lName) || checkSystemActionTitle(lHandle) || checkSystemActionTitle(lId)) continue;

        const foundKey = (lId && keyByIdOrHandle.get(lId.toLowerCase())) ||
                         (lNormHandle && keyByIdOrHandle.get(lNormHandle)) ||
                         null;

        let targetObj = null;
        if (foundKey && channels[foundKey]) {
          const target = channels[foundKey];
          let changed = false;

          if (lAvatar && (!target.avatarUrl || target.avatarUrl.includes('default_avatar'))) {
            target.avatarUrl = lAvatar;
            changed = true;
          }
          if (lName && (!target.name || target.name === target.id || target.name.startsWith('UC') || target.name === target.handle)) {
            target.name = lName;
            changed = true;
          }
          if (lHandle && !target.handle) {
            target.handle = lHandle.startsWith('@') ? lHandle : `@${lHandle}`;
            changed = true;
          }
          if (lId && lId.startsWith('UC') && (!target.id || !target.id.startsWith('UC'))) {
            target.id = lId;
            changed = true;
          }
          if (target.isSubscribed !== true) {
            target.isSubscribed = true;
            changed = true;
          }
          if (lId && lId.startsWith('UC') && foundKey !== lId && !channels[lId]) {
            channels[lId] = target;
            changed = true;
          }

          if (changed) updatedCount++;
          targetObj = target;
        } else if (lId) {
          // Channel exists in live YouTube subs but not in local channels dictionary; add it
          const newCh = {
            id: lId,
            name: lName || lHandle || lId,
            handle: lHandle ? (lHandle.startsWith('@') ? lHandle : `@${lHandle}`) : '',
            avatarUrl: lAvatar || '',
            isSubscribed: true
          };
          channels[lId] = newCh;
          keyByIdOrHandle.set(lId.toLowerCase(), lId);
          if (lNormHandle) keyByIdOrHandle.set(lNormHandle, lId);
          updatedCount++;
          targetObj = newCh;
        }

        // Phase 4.1: Smart Auto-Categorization based on autoKeywords
        if (targetObj) {
          const evalId = targetObj.id || lId;
          const evalName = targetObj.name || lName;
          const evalHandle = targetObj.handle || lHandle;
          for (const f of folders) {
            const kwList = Array.isArray(f.autoKeywords)
              ? f.autoKeywords
              : (typeof f.autoKeywords === 'string' ? f.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);
            if (kwList.length > 0 && matchesAutoKeywords(evalName, evalHandle, kwList)) {
              if (!Array.isArray(f.channels)) f.channels = [];
              if (!f.channels.includes(evalId)) {
                f.channels.push(evalId);
                foldersChanged = true;
              }
            }
          }
        }
      }

      if (updatedCount > 0 || foldersChanged) {
        const payload = { [STORAGE_KEYS.CHANNELS]: channels };
        if (foldersChanged) {
          payload[STORAGE_KEYS.FOLDERS] = folders;
        }
        await setRaw(payload);
        notifyChange();
      }

      return { updatedCount };
    });
  }

  async function toggleChannelInFolder(folderId, channelInfo) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();
      const folder = folders.find(f => f.id === folderId);
      if (!folder) return false;

      const chId = channelInfo.id || channelInfo.handle || '';
      const chNorm = normalizeHandle(channelInfo.handle || chId);
      const chLower = chId.toLowerCase();

      const exists = Array.isArray(folder.channels) && folder.channels.some(id => {
        if (!id) return false;
        if (id.toLowerCase() === chLower) return true;
        if (chNorm && normalizeHandle(id) === chNorm) return true;

        // Cross-reference via channels dictionary
        const ch = channels[id];
        if (ch) {
          if (chLower && ch.id && ch.id.toLowerCase() === chLower) return true;
          if (chNorm && ch.handle && normalizeHandle(ch.handle) === chNorm) return true;
        }
        return false;
      });

      if (exists) {
        await _removeChannelFromFolderUnlocked(folderId, chId);
        return false; // Removed
      } else {
        await _addChannelToFolderUnlocked(folderId, channelInfo);
        return true; // Added
      }
    });
  }

  async function getFoldersByChannel(channelId, channelHandle = '') {
    const folders = await _getFoldersUnlocked();
    const channels = await _getChannelsUnlocked();
    const matchedFolderIds = [];

    const normHandle = normalizeHandle(channelHandle);
    const normId = channelId ? channelId.toLowerCase() : '';

    for (const folder of folders) {
      if (!Array.isArray(folder.channels)) continue;

      let matched = false;
      for (const chRef of folder.channels) {
        if (!chRef) continue;
        const refLower = chRef.toLowerCase();
        const refNorm = normalizeHandle(chRef);

        if (normId && refLower === normId) {
          matched = true;
          break;
        }
        if (normHandle && (refNorm === normHandle || refLower === '@' + normHandle)) {
          matched = true;
          break;
        }

        // Check via channels dictionary
        const ch = channels[chRef];
        if (ch) {
          if (normId && ch.id && ch.id.toLowerCase() === normId) {
            matched = true;
            break;
          }
          if (normHandle && ch.handle && normalizeHandle(ch.handle) === normHandle) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        matchedFolderIds.push(folder.id);
      }
    }
    return matchedFolderIds;
  }

  async function getUncategorizedChannels() {
    const folders = await _getFoldersUnlocked();
    const channels = await _getChannelsUnlocked();
    const assignedTokens = new Set();

    // Build O(1) index of channels by lowercase id and normalized handle
    const channelByToken = new Map();
    const channelList = Array.isArray(channels) ? channels : Object.values(channels);
    for (const ch of channelList) {
      if (!ch) continue;
      if (ch.id) channelByToken.set(String(ch.id).toLowerCase(), ch);
      if (ch.handle) {
        const nh = normalizeHandle(ch.handle);
        if (nh) channelByToken.set(nh, ch);
      }
    }

    folders.forEach(f => {
      if (Array.isArray(f.channels)) {
        f.channels.forEach(chRef => {
          if (!chRef) return;
          const refStr = String(chRef).trim();
          const refLower = refStr.toLowerCase();
          assignedTokens.add(refLower);
          const nh = normalizeHandle(refStr);
          if (nh) {
            assignedTokens.add(nh);
            assignedTokens.add('@' + nh);
          }

          const chObj = channels[refStr] || channelByToken.get(refLower) || (nh ? channelByToken.get(nh) : null);
          if (chObj) {
            if (chObj.id) assignedTokens.add(String(chObj.id).toLowerCase());
            if (chObj.handle) {
              const chH = normalizeHandle(chObj.handle);
              assignedTokens.add(chH);
              assignedTokens.add('@' + chH);
            }
          }
        });
      }
    });

    const uncategorized = [];

    for (const ch of channelList) {
      if (!ch) continue;
      const idStr = ch.id ? String(ch.id).toLowerCase() : '';
      const handleStr = ch.handle ? normalizeHandle(ch.handle) : '';

      const isAssigned = (idStr && assignedTokens.has(idStr)) ||
                         (handleStr && (assignedTokens.has(handleStr) || assignedTokens.has('@' + handleStr)));

      if (!isAssigned && ch.isSubscribed !== false) {
        if (!checkSystemActionTitle(ch.name) && !checkSystemActionTitle(ch.handle) && !checkSystemActionTitle(ch.id)) {
          uncategorized.push(ch);
        }
      }
    }
    return uncategorized;
  }

  async function batchAddChannels(channelsArray) {
    return withStorageLock(async () => {
      const channels = await _getChannelsUnlocked();
      const folders = await _getFoldersUnlocked();
      let newCount = 0;
      let foldersChanged = false;

      // Build O(1) lookup index
      const keyByToken = new Map();
      for (const [k, ch] of Object.entries(channels)) {
        keyByToken.set(k.toLowerCase(), k);
        if (ch?.id) keyByToken.set(String(ch.id).toLowerCase(), k);
        if (ch?.handle) {
          const nh = normalizeHandle(ch.handle);
          if (nh) keyByToken.set(nh, k);
        }
      }

      for (const ch of channelsArray) {
        const id = ch.id || ch.handle;
        if (!id) continue;
        if (checkSystemActionTitle(ch.name) || checkSystemActionTitle(ch.handle) || checkSystemActionTitle(id)) {
          continue;
        }

        const normH = normalizeHandle(ch.handle || id);
        const existingKey = keyByToken.get(String(id).toLowerCase()) || (normH ? keyByToken.get(normH) : undefined);

        const targetKey = existingKey || id;
        if (!existingKey) {
          newCount++;
        }

        const existingCh = channels[targetKey];
        channels[targetKey] = {
          id: existingCh?.id || id,
          name: ch.name || existingCh?.name || id,
          handle: ch.handle || existingCh?.handle || '',
          avatarUrl: sanitizeAvatarUrl(ch.avatarUrl) || sanitizeAvatarUrl(existingCh?.avatarUrl) || '',
          isSubscribed: ch.isSubscribed !== undefined ? Boolean(ch.isSubscribed) : (existingCh?.isSubscribed !== false)
        };

        keyByToken.set(String(targetKey).toLowerCase(), targetKey);
        if (normH) keyByToken.set(normH, targetKey);

        // Phase 4.1: Smart Auto-Categorization based on autoKeywords
        for (const f of folders) {
          const kwList = Array.isArray(f.autoKeywords)
            ? f.autoKeywords
            : (typeof f.autoKeywords === 'string' ? f.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);
          if (kwList.length > 0 && matchesAutoKeywords(ch.name || targetKey, ch.handle, kwList)) {
            if (!Array.isArray(f.channels)) f.channels = [];
            if (!f.channels.includes(targetKey)) {
              f.channels.push(targetKey);
              foldersChanged = true;
            }
          }
        }
      }

      const savePayload = { [STORAGE_KEYS.CHANNELS]: channels };
      if (foldersChanged) {
        savePayload[STORAGE_KEYS.FOLDERS] = folders;
      }
      await setRaw(savePayload);
      notifyChange();
      return { total: Object.keys(channels).length, newCount };
    });
  }

  async function setChannelSubscribed(channelId, isSubscribed = true) {
    return withStorageLock(async () => {
      const channels = await _getChannelsUnlocked();
      let ch = channels[channelId];
      if (!ch && channelId) {
        const targetLower = channelId.toLowerCase();
        const normH = normalizeHandle(channelId);
        const chKey = Object.keys(channels).find(k =>
          k.toLowerCase() === targetLower ||
          (channels[k].handle && normalizeHandle(channels[k].handle) === normH) ||
          (channels[k].id && channels[k].id.toLowerCase() === targetLower)
        );
        if (chKey) ch = channels[chKey];
      }
      if (ch) {
        ch.isSubscribed = Boolean(isSubscribed);
        await _setChannelsUnlocked(channels);
        return true;
      }
      return false;
    });
  }

  async function batchUpdateChannels(updates) {
    return withStorageLock(async () => {
      const channels = await _getChannelsUnlocked();
      for (const u of updates) {
        if (!u || typeof u !== 'object') continue;
        const id = u.id || u.handle;
        if (!id || id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
        if (checkSystemActionTitle(u.name) || checkSystemActionTitle(u.handle) || checkSystemActionTitle(id)) {
          continue;
        }
        const prev = channels[id] || {};
        channels[id] = {
          id: String(u.id || prev.id || id).trim(),
          name: String(u.name || prev.name || id).trim(),
          handle: String(u.handle !== undefined ? u.handle : (prev.handle || '')).trim(),
          avatarUrl: u.avatarUrl !== undefined ? sanitizeAvatarUrl(u.avatarUrl) : sanitizeAvatarUrl(prev.avatarUrl),
          isSubscribed: u.isSubscribed !== undefined ? Boolean(u.isSubscribed) : (prev.isSubscribed !== false)
        };
      }
      await _setChannelsUnlocked(channels);
    });
  }

  // ---------------------------------------------------------------------------
  // Backup Export, Import & Clean Duplicates
  // ---------------------------------------------------------------------------
  async function exportData() {
    const folders = await _getFoldersUnlocked();
    const channels = await _getChannelsUnlocked();
    const settings = await getSettings();
    return JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      folders,
      channels,
      settings
    }, null, 2);
  }

  async function importData(jsonString, options = {}) {
    return withStorageLock(async () => {
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      if (!parsed || (!parsed.folders && !parsed.channels && !Array.isArray(parsed))) {
        throw new Error('無效的備份格式');
      }

      const mergeWithExisting = Boolean(options.mergeWithExisting);
      const singleFolderMode = options.singleFolderMode !== false; // default true
      const prioritizeCategorized = options.prioritizeCategorized !== false; // default true

      let incomingFolders = [];
      let incomingChannels = [];
      let incomingUncategorized = [];

      if (Array.isArray(parsed)) {
        incomingChannels = parsed;
      } else {
        incomingFolders = Array.isArray(parsed.folders) ? parsed.folders : [];
        incomingChannels = parsed.channels || [];
        incomingUncategorized = Array.isArray(parsed.uncategorizedChannels) ? parsed.uncategorizedChannels : [];
      }

      let foldersToProcess = incomingFolders;
      let channelsToProcess = incomingChannels;

      if (mergeWithExisting) {
        const existingFolders = await _getFoldersUnlocked();
        const existingChannels = await _getChannelsUnlocked();

        const mergedFoldersMap = new Map();
        existingFolders.forEach(f => {
          mergedFoldersMap.set(f.id, { ...f, channels: [...(f.channels || [])] });
        });

        incomingFolders.forEach(f => {
          if (mergedFoldersMap.has(f.id)) {
            const ex = mergedFoldersMap.get(f.id);
            ex.channels = [...ex.channels, ...(f.channels || [])];
          } else {
            const incNormName = normalizeFolderIconAndName(f.name || '', f.icon).name.toLowerCase();
            const matchByName = Array.from(mergedFoldersMap.values()).find(ex =>
              normalizeFolderIconAndName(ex.name || '', ex.icon).name.toLowerCase() === incNormName
            );
            if (matchByName) {
              matchByName.channels = [...matchByName.channels, ...(f.channels || [])];
            } else {
              mergedFoldersMap.set(f.id, { ...f, channels: [...(f.channels || [])] });
            }
          }
        });

        foldersToProcess = Array.from(mergedFoldersMap.values());
        channelsToProcess = [existingChannels, incomingChannels];
      }

      const dedupResult = deduplicateData({
        folders: foldersToProcess,
        channels: channelsToProcess,
        uncategorizedChannels: incomingUncategorized,
        options: { singleFolderMode, prioritizeCategorized }
      });

      const currentSettings = await getSettings();
      const safeIncomingSettings = sanitizeSettings(parsed.settings);
      const settings = Object.assign({}, currentSettings, safeIncomingSettings);

      await setRaw({
        [STORAGE_KEYS.FOLDERS]: dedupResult.cleanFolders,
        [STORAGE_KEYS.CHANNELS]: dedupResult.cleanChannelsMap,
        [STORAGE_KEYS.SETTINGS]: settings,
        [STORAGE_KEYS.INITIALIZED]: true
      });

      notifyChange();

      return {
        folderCount: dedupResult.cleanFolders.length,
        channelCount: Object.keys(dedupResult.cleanChannelsMap).length,
        channelsList: Object.values(dedupResult.cleanChannelsMap),
        cleanFolders: dedupResult.cleanFolders,
        removedDuplicates: dedupResult.removedCount,
        stats: dedupResult.stats
      };
    });
  }

  // Standalone duplicate cleaner for current storage
  async function cleanDuplicates(singleFolderMode = true) {
    return withStorageLock(async () => {
      const folders = await _getFoldersUnlocked();
      const channels = await _getChannelsUnlocked();

      const dedupResult = deduplicateData({
        folders,
        channels,
        options: { singleFolderMode, prioritizeCategorized: true }
      });

      await setRaw({
        [STORAGE_KEYS.FOLDERS]: dedupResult.cleanFolders,
        [STORAGE_KEYS.CHANNELS]: dedupResult.cleanChannelsMap
      });

      notifyChange();

      return {
        folderCount: dedupResult.cleanFolders.length,
        channelCount: Object.keys(dedupResult.cleanChannelsMap).length,
        removedCount: dedupResult.removedCount,
        stats: dedupResult.stats
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 4.3: Zero-Server Cross-Device Sync Skeleton (chrome.storage.sync)
  // ---------------------------------------------------------------------------
  async function exportSyncSkeleton() {
    const folders = await _getFoldersUnlocked();
    return {
      version: 1,
      timestamp: Date.now(),
      folders: folders.map(f => ({
        id: f.id,
        name: f.name,
        icon: f.icon,
        color: f.color,
        description: f.description || '',
        autoKeywords: Array.isArray(f.autoKeywords) ? f.autoKeywords : [],
        channels: Array.isArray(f.channels) ? [...f.channels] : []
      }))
    };
  }

  const SYNC_META_KEY = 'yt_sync_meta';
  const CHUNK_PREFIX = 'yt_sync_c_';
  const CHUNK_SIZE = 6000;
  const LEGACY_SYNC_KEY = 'yt_folders_sync_skeleton';

  async function _writeSyncSkeleton(skeleton) {
    const json = JSON.stringify(skeleton);
    const chunkCount = Math.max(1, Math.ceil(json.length / CHUNK_SIZE));

    // Clean up obsolete chunks if previous payload had more chunks
    try {
      const prevMeta = await new Promise(resolve => {
        chrome.storage.sync.get([SYNC_META_KEY], (res) => resolve(res || {}));
      });
      const prevChunks = prevMeta?.[SYNC_META_KEY]?.chunks;
      const obsoleteKeys = [];
      if (typeof prevChunks === 'number' && prevChunks > chunkCount) {
        for (let i = chunkCount; i < prevChunks; i++) {
          obsoleteKeys.push(`${CHUNK_PREFIX}${i}`);
        }
      }
      if (json.length > 7500) {
        obsoleteKeys.push(LEGACY_SYNC_KEY);
      }
      if (obsoleteKeys.length > 0 && typeof chrome.storage.sync.remove === 'function') {
        await new Promise(resolve => {
          chrome.storage.sync.remove(obsoleteKeys, () => resolve());
        });
      }
    } catch (_) {}

    const items = {
      [SYNC_META_KEY]: {
        version: 1,
        timestamp: skeleton.timestamp || Date.now(),
        chunks: chunkCount,
        folderCount: skeleton.folders ? skeleton.folders.length : 0,
        channelCount: skeleton.folders ? skeleton.folders.reduce((acc, f) => acc + (f.channels?.length || 0), 0) : 0
      }
    };
    for (let i = 0; i < chunkCount; i++) {
      items[`${CHUNK_PREFIX}${i}`] = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    // Also store in legacy key for backwards compatibility if within 7500 bytes
    if (json.length <= 7500) {
      items[LEGACY_SYNC_KEY] = skeleton;
    }
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  async function _readSyncSkeleton() {
    const meta = await new Promise(resolve => {
      chrome.storage.sync.get([SYNC_META_KEY, LEGACY_SYNC_KEY], (res) => resolve(res || {}));
    });
    if (meta && meta[SYNC_META_KEY] && typeof meta[SYNC_META_KEY].chunks === 'number') {
      const numChunks = meta[SYNC_META_KEY].chunks;
      const keys = Array.from({ length: numChunks }, (_, i) => `${CHUNK_PREFIX}${i}`);
      const chunksData = await new Promise(resolve => {
        chrome.storage.sync.get(keys, (res) => resolve(res || {}));
      });
      let fullJson = '';
      for (let i = 0; i < numChunks; i++) {
        fullJson += chunksData[`${CHUNK_PREFIX}${i}`] || '';
      }
      try {
        const parsed = JSON.parse(fullJson);
        if (parsed && Array.isArray(parsed.folders)) return parsed;
      } catch (e) {
        console.warn('[YTFolderStorage] Error parsing sharded sync data:', e);
      }
    }
    if (meta && meta[LEGACY_SYNC_KEY] && Array.isArray(meta[LEGACY_SYNC_KEY].folders)) {
      return meta[LEGACY_SYNC_KEY];
    }
    return null;
  }

  async function syncWithCloud(directionOrData = 'auto') {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      return { success: false, reason: 'STORAGE_SYNC_UNAVAILABLE' };
    }
    return withStorageLock(async () => {
      const direction = typeof directionOrData === 'string' ? directionOrData : 'upload';
      const customData = (typeof directionOrData === 'object' && directionOrData) ? directionOrData : null;

      if (customData) {
        try {
          await _writeSyncSkeleton(customData);
          const channelCount = (customData.folders || []).reduce((acc, f) => acc + (f.channels?.length || 0), 0);
          return { success: true, direction: 'upload', count: customData.folders?.length || 0, channelIdCount: channelCount };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      if (direction === 'upload') {
        const skeleton = await exportSyncSkeleton();
        try {
          await _writeSyncSkeleton(skeleton);
          const channelCount = skeleton.folders.reduce((acc, f) => acc + (f.channels?.length || 0), 0);
          return { success: true, direction: 'upload', count: skeleton.folders.length, channelIdCount: channelCount };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      if (direction === 'download') {
        const remote = await _readSyncSkeleton();
        if (!remote || !Array.isArray(remote.folders)) {
          return { success: false, reason: 'NO_REMOTE_DATA' };
        }
        const localFolders = await _getFoldersUnlocked();
        const folderMap = new Map(localFolders.map(f => [f.id, f]));
        for (const rf of remote.folders) {
          if (!rf || !rf.id) continue;
          if (folderMap.has(rf.id)) {
            const ex = folderMap.get(rf.id);
            ex.channels = Array.from(new Set([...(ex.channels || []), ...(rf.channels || [])]));
            if (Array.isArray(rf.autoKeywords) && rf.autoKeywords.length > 0) {
              ex.autoKeywords = Array.from(new Set([...(ex.autoKeywords || []), ...rf.autoKeywords]));
            }
          } else {
            localFolders.push({
              id: rf.id,
              name: rf.name,
              icon: rf.icon,
              color: rf.color,
              description: rf.description || '',
              autoKeywords: rf.autoKeywords || [],
              channels: Array.isArray(rf.channels) ? rf.channels : []
            });
          }
        }
        await _setFoldersUnlocked(localFolders);
        const channelCount = localFolders.reduce((acc, f) => acc + (f.channels?.length || 0), 0);
        return { success: true, direction: 'download', count: localFolders.length, channelIdCount: channelCount };
      }

      // 'auto' mode: Bi-directional synchronization
      const remote = await _readSyncSkeleton();
      const localFolders = await _getFoldersUnlocked();

      if (!remote || !Array.isArray(remote.folders) || remote.folders.length === 0) {
        // No remote data -> perform initial upload
        const skeleton = await exportSyncSkeleton();
        await _writeSyncSkeleton(skeleton);
        const channelCount = skeleton.folders.reduce((acc, f) => acc + (f.channels?.length || 0), 0);
        return { success: true, direction: 'upload', count: skeleton.folders.length, channelIdCount: channelCount };
      }

      // Merge remote with local (two-way union)
      const folderMap = new Map(localFolders.map(f => [f.id, f]));
      for (const rf of remote.folders) {
        if (!rf || !rf.id) continue;
        if (folderMap.has(rf.id)) {
          const ex = folderMap.get(rf.id);
          ex.channels = Array.from(new Set([...(ex.channels || []), ...(rf.channels || [])]));
          if (Array.isArray(rf.autoKeywords) && rf.autoKeywords.length > 0) {
            ex.autoKeywords = Array.from(new Set([...(ex.autoKeywords || []), ...rf.autoKeywords]));
          }
        } else {
          localFolders.push({
            id: rf.id,
            name: rf.name,
            icon: rf.icon,
            color: rf.color,
            description: rf.description || '',
            autoKeywords: rf.autoKeywords || [],
            channels: Array.isArray(rf.channels) ? rf.channels : []
          });
        }
      }

      // Save locally and write updated union back to cloud
      await _setFoldersUnlocked(localFolders);
      const mergedSkeleton = await exportSyncSkeleton();
      await _writeSyncSkeleton(mergedSkeleton);
      const channelCount = localFolders.reduce((acc, f) => acc + (f.channels?.length || 0), 0);
      return { success: true, direction: 'merge', count: localFolders.length, channelIdCount: channelCount };
    });
  }

  function notifyChange() {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('yt-folders-storage-updated'));
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const p = chrome.runtime.sendMessage({ action: 'STORAGE_UPDATED' });
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch (e) {}
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
    reorderFolders,
    addChannelToFolder,
    removeChannelFromFolder,
    batchMoveChannels,
    batchRemoveChannelsFromFolder,
    removeChannelFromAllFolders,
    batchRemoveUnsubscribedChannels,
    enrichChannelsMetadata,
    toggleChannelInFolder,
    getFoldersByChannel,
    getUncategorizedChannels,
    batchAddChannels,
    setChannelSubscribed,
    batchUpdateChannels,
    deduplicateData,
    cleanDuplicates,
    exportData,
    importData,
    exportSyncSkeleton,
    syncWithCloud,
    matchesAutoKeywords,
    sanitizeAvatarUrl,
    sanitizeFolderColor,
    sanitizeFolderIcon,
    normalizeFolderIconAndName,
    sanitizeSettings,
    normalizeHandle,
    checkSystemActionTitle,
    STORAGE_KEYS,
    DEFAULT_SETTINGS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = YTFolderStorage;
}

