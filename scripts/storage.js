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
    onlyShowLive: false,
    showInSidebar: true,
    showFeedFilter: true,
    activeFeedFolderId: 'all',
    selectedFeedFolderIds: [],
    mutedFeedFolderIds: [],
    feedDurationFilter: 'all',
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

  const ALLOWED_AVATAR_HOSTS = [
    'yt3.ggpht.com',
    'yt3.googleusercontent.com',
    'lh3.googleusercontent.com',
    'ytimg.com',
    'youtube.com',
    'gstatic.com'
  ];

  function isSafeRegexPattern(pattern, flags = '') {
    if (typeof YTFolderUtils !== 'undefined' && YTFolderUtils && typeof YTFolderUtils.isSafeRegexPattern === 'function') {
      return YTFolderUtils.isSafeRegexPattern(pattern, flags);
    }
    if (typeof globalThis !== 'undefined' && globalThis.YTFolderUtils && typeof globalThis.YTFolderUtils.isSafeRegexPattern === 'function') {
      return globalThis.YTFolderUtils.isSafeRegexPattern(pattern, flags);
    }
    if (!pattern || typeof pattern !== 'string' || pattern.length > 120) return false;
    if (flags && !/^[imu]{0,3}$/.test(flags)) return false;
    if (/\([^()]*[+*?][^()]*\)\s*[+*?{]/.test(pattern) || /(\([^)]*[+*?}]\)[+*?{])|(\.\*){3,}/.test(pattern)) {
      return false;
    }
    return true;
  }

  const COMPILED_REGEX_CACHE = new Map();
  const MAX_REGEX_CACHE_SIZE = 500;

  /**
   * Returns a memoized, ReDoS-vetted stateless RegExp instance (or null if unsafe/invalid).
   * Evicts oldest entry (FIFO) when cache reaches MAX_REGEX_CACHE_SIZE.
   */
  function getCompiledSafeRegex(pattern, flags = '') {
    if (!pattern || typeof pattern !== 'string') return null;
    const rawFlagsStr = String(flags || '');
    const safeFlags = (rawFlagsStr.includes('g') || rawFlagsStr.includes('y'))
      ? rawFlagsStr.replace(/[gy]/g, '')
      : rawFlagsStr;
    const cacheKey = `${pattern}///${safeFlags}`;
    if (COMPILED_REGEX_CACHE.has(cacheKey)) {
      return COMPILED_REGEX_CACHE.get(cacheKey);
    }

    let compiled = null;
    if (isSafeRegexPattern(pattern, safeFlags)) {
      try {
        compiled = new RegExp(pattern, safeFlags);
      } catch (e) {
        compiled = null;
      }
    }

    if (COMPILED_REGEX_CACHE.size >= MAX_REGEX_CACHE_SIZE) {
      const oldestKey = COMPILED_REGEX_CACHE.keys().next().value;
      if (oldestKey !== undefined) {
        COMPILED_REGEX_CACHE.delete(oldestKey);
      }
    }
    COMPILED_REGEX_CACHE.set(cacheKey, compiled);
    return compiled;
  }

  function sanitizeAvatarUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let trimmed = url.trim();
    if (!trimmed || /[\s<>"'`]/.test(trimmed)) return '';
    if (/^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
      return trimmed;
    }
    if (/^\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//i.test(trimmed)) {
      trimmed = 'https:' + trimmed;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.username || parsed.password) return '';
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          const host = parsed.hostname.toLowerCase();
          if (ALLOWED_AVATAR_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
            parsed.protocol = 'https:';
            return parsed.toString();
          }
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
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return {};
    const clean = {};
    const validKeys = ['hideWatched', 'hideShorts', 'onlyLive', 'onlyShowLive', 'showInSidebar', 'showFeedFilter', 'activeFeedFolderId', 'expandedFolders', 'dismissedOnboarding'];
    for (const key of validKeys) {
      if (Object.prototype.hasOwnProperty.call(incoming, key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        if (key === 'expandedFolders') {
          if (incoming.expandedFolders && typeof incoming.expandedFolders === 'object' && !Array.isArray(incoming.expandedFolders)) {
            clean.expandedFolders = {};
            for (const [k, v] of Object.entries(incoming.expandedFolders)) {
              if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                clean.expandedFolders[String(k).slice(0, 64)] = Boolean(v);
              }
            }
          }
        } else if (typeof incoming[key] === typeof DEFAULT_SETTINGS[key]) {
          clean[key] = incoming[key];
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'selectedFeedFolderIds') && Array.isArray(incoming.selectedFeedFolderIds)) {
      clean.selectedFeedFolderIds = Array.from(
        new Set(
          incoming.selectedFeedFolderIds
            .filter(id => typeof id === 'string' && id.trim().length > 0)
            .map(id => id.trim())
        )
      ).slice(0, 200);
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'mutedFeedFolderIds') && Array.isArray(incoming.mutedFeedFolderIds)) {
      clean.mutedFeedFolderIds = Array.from(
        new Set(
          incoming.mutedFeedFolderIds
            .filter(id => typeof id === 'string' && id.trim().length > 0)
            .map(id => id.trim())
        )
      ).slice(0, 200);
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'feedDurationFilter') && ['all', 'short', 'medium', 'long'].includes(incoming.feedDurationFilter)) {
      clean.feedDurationFilter = incoming.feedDurationFilter;
    }

    return clean;
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

  async function _getFoldersUnlocked(prefetchedRaw = null) {
    const hasPrefetched = Boolean(prefetchedRaw && typeof prefetchedRaw === 'object');
    let raw = hasPrefetched
      ? prefetchedRaw
      : await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.INITIALIZED]);
    let folders = raw[STORAGE_KEYS.FOLDERS];
    if (!raw[STORAGE_KEYS.INITIALIZED] && (!folders || !Array.isArray(folders))) {
      await _initUnlocked(false);
      raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.INITIALIZED]);
      if (hasPrefetched) {
        Object.assign(prefetchedRaw, raw);
      }
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

    if (hasPrefetched) {
      prefetchedRaw[STORAGE_KEYS.FOLDERS] = folders;
    }
    if (mutated) {
      await setRaw({ [STORAGE_KEYS.FOLDERS]: folders });
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

  async function _getChannelsUnlocked(prefetchedRaw = null) {
    const hasPrefetched = Boolean(prefetchedRaw && typeof prefetchedRaw === 'object');
    let raw = hasPrefetched
      ? prefetchedRaw
      : await getRaw([STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    let channels = raw[STORAGE_KEYS.CHANNELS];
    let migratedOrInvalid = false;

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
      migratedOrInvalid = true;
    }

    if (!raw[STORAGE_KEYS.INITIALIZED] && (!channels || typeof channels !== 'object')) {
      await _initUnlocked(false);
      raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.INITIALIZED]);
      if (hasPrefetched) {
        Object.assign(prefetchedRaw, raw);
      }
      channels = raw[STORAGE_KEYS.CHANNELS] || {};
      migratedOrInvalid = false;
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
      if (hasInvalid) {
        migratedOrInvalid = true;
      }
    }

    const cleanChannels = (channels && typeof channels === 'object') ? channels : {};
    if (hasPrefetched) {
      prefetchedRaw[STORAGE_KEYS.CHANNELS] = cleanChannels;
    }
    if (migratedOrInvalid) {
      await setRaw({ [STORAGE_KEYS.CHANNELS]: cleanChannels });
    }

    return cleanChannels;
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

  function _mergeSettingsFromRaw(storedSettings) {
    const stored = (storedSettings && typeof storedSettings === 'object' && !Array.isArray(storedSettings))
      ? storedSettings
      : {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (stored.onlyShowLive !== undefined && stored.onlyLive === undefined) {
      merged.onlyLive = Boolean(stored.onlyShowLive);
    } else if (stored.onlyLive !== undefined && stored.onlyShowLive === undefined) {
      merged.onlyShowLive = Boolean(stored.onlyLive);
    }
    return merged;
  }

  async function getSettings() {
    const raw = await getRaw([STORAGE_KEYS.SETTINGS]);
    return _mergeSettingsFromRaw(raw[STORAGE_KEYS.SETTINGS]);
  }

  async function updateSettings(partial) {
    return withStorageLock(async () => {
      const current = await getSettings();
      const sanitized = sanitizeSettings(partial);
      if ('onlyShowLive' in sanitized && !('onlyLive' in sanitized)) {
        sanitized.onlyLive = sanitized.onlyShowLive;
      } else if ('onlyLive' in sanitized && !('onlyShowLive' in sanitized)) {
        sanitized.onlyShowLive = sanitized.onlyLive;
      }
      const updated = Object.assign({}, current, sanitized);
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

      const rawFolderId = String(f.id || '').trim();
      const safeFolderId = (!rawFolderId || rawFolderId === '__proto__' || rawFolderId === 'constructor' || rawFolderId === 'prototype')
        ? `folder_${Date.now()}_${cleanFolders.length}`
        : rawFolderId;
      const safeAutoKeywords = Array.isArray(f.autoKeywords)
        ? f.autoKeywords.map(k => String(k).trim()).filter(Boolean).slice(0, 100)
        : (typeof f.autoKeywords === 'string'
            ? f.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean).slice(0, 100)
            : []);
      const normalizedFolder = normalizeFolderIconAndName(f.name || `Folder ${cleanFolders.length + 1}`, f.icon);
      cleanFolders.push({
        id: safeFolderId,
        name: normalizedFolder.name,
        icon: normalizedFolder.icon,
        color: sanitizeFolderColor(f.color),
        description: String(f.description || '').trim(),
        autoKeywords: safeAutoKeywords,
        channels: fChannels
      });
    }

    // 4. Build Clean Channels Dictionary (keyed by canonical ID)
    const cleanChannelsMap = {};
    for (const c of canonicalList) {
      if (!c.id || c.id === '__proto__' || c.id === 'constructor' || c.id === 'prototype') continue;
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
  async function _addChannelToFolderUnlocked(folderId, channelInfo, prefetchedRaw = null) {
    const raw = (prefetchedRaw && typeof prefetchedRaw === 'object')
      ? prefetchedRaw
      : await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    const folders = await _getFoldersUnlocked(raw);
    const channels = await _getChannelsUnlocked(raw);

    const folder = folders.find(f => f.id === folderId);
    if (!folder) return false;

    const chId = channelInfo.id || channelInfo.handle;
    if (!chId) return false;

    // Check if channel already exists under an alias or handle (O(1) via direct key or lookup index)
    let canonicalId = chId;
    const chIdLower = String(chId).toLowerCase();
    const chNorm = normalizeHandle(chId);
    let existing = Object.prototype.hasOwnProperty.call(channels, chId) ? channels[chId] : null;
    if (!existing) {
      const channelIndex = _buildChannelLookupIndex(channels);
      existing = channelIndex.get(chIdLower) ||
                 (chNorm ? (channelIndex.get(chNorm) || channelIndex.get('@' + chNorm)) : null) ||
                 null;
    }
    if (existing) {
      canonicalId = existing.id || chId;
    }

    if (!Array.isArray(folder.channels)) {
      folder.channels = [];
    }

    // Ensure no duplicate in this folder
    const canonLower = String(canonicalId).toLowerCase();
    const existingHandleNorm = existing?.handle ? normalizeHandle(existing.handle) : '';
    const alreadyInFolder = folder.channels.some(id =>
      id && (
        String(id).toLowerCase() === canonLower ||
        (existingHandleNorm && normalizeHandle(id) === existingHandleNorm)
      )
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

  async function _removeChannelFromFolderUnlocked(folderId, channelId, prefetchedRaw = null) {
    const raw = (prefetchedRaw && typeof prefetchedRaw === 'object')
      ? prefetchedRaw
      : await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    const folders = await _getFoldersUnlocked(raw);
    const channels = await _getChannelsUnlocked(raw);
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

  function _setIndexEntry(index, token, ch) {
    if (!token) return;
    const existing = index.get(token);
    if (existing && existing.id && String(existing.id).startsWith('UC') && (!ch.id || !String(ch.id).startsWith('UC'))) {
      return;
    }
    index.set(token, ch);
  }

  function _buildChannelLookupIndex(channelsObj) {
    const index = new Map();
    if (!channelsObj || typeof channelsObj !== 'object') return index;
    const entries = Array.isArray(channelsObj)
      ? channelsObj.map((ch, i) => [String(ch?.id || i), ch])
      : Object.entries(channelsObj);
    for (const [key, ch] of entries) {
      if (!ch || typeof ch !== 'object') continue;
      if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        _setIndexEntry(index, String(key).trim().toLowerCase(), ch);
      }
      if (ch.id) {
        const idLower = String(ch.id).trim().toLowerCase();
        if (idLower) _setIndexEntry(index, idLower, ch);
        if (idLower.startsWith('@')) {
          const idNh = normalizeHandle(idLower);
          if (idNh) {
            _setIndexEntry(index, idNh, ch);
            _setIndexEntry(index, '@' + idNh, ch);
          }
        }
      }
      if (ch.handle) {
        const nh = normalizeHandle(ch.handle);
        if (nh) {
          _setIndexEntry(index, nh, ch);
          _setIndexEntry(index, '@' + nh, ch);
        }
      }
    }
    return index;
  }

  function _buildChannelMatcher(channelKeys, channels, prebuiltIndex = null) {
    const lowerIds = new Set();
    const normHandles = new Set();
    const channelIndex = prebuiltIndex || _buildChannelLookupIndex(channels);

    channelKeys.forEach(k => {
      if (!k) return;
      const strK = String(k).trim();
      if (!strK) return;
      const lowerK = strK.toLowerCase();
      lowerIds.add(lowerK);
      const nh = normalizeHandle(strK);
      if (nh) normHandles.add(nh);

      // O(1) cross-reference via channelIndex
      const ch = (channels && Object.prototype.hasOwnProperty.call(channels, strK) ? channels[strK] : null) ||
                 channelIndex.get(lowerK) ||
                 (nh ? (channelIndex.get(nh) || channelIndex.get('@' + nh)) : null);
      if (ch) {
        if (ch.id) lowerIds.add(String(ch.id).trim().toLowerCase());
        if (ch.handle) {
          const cnh = normalizeHandle(ch.handle);
          if (cnh) normHandles.add(cnh);
        }
      }
    });

    const isMatch = (cid) => {
      if (!cid) return false;
      const cStr = String(cid).trim();
      if (!cStr) return false;
      const cLower = cStr.toLowerCase();
      if (lowerIds.has(cLower)) return true;
      const cNormH = normalizeHandle(cStr);
      if (cNormH && normHandles.has(cNormH)) return true;

      const ch = (channels && Object.prototype.hasOwnProperty.call(channels, cStr) ? channels[cStr] : null) ||
                 channelIndex.get(cLower) ||
                 (cNormH ? (channelIndex.get(cNormH) || channelIndex.get('@' + cNormH)) : null);
      if (ch) {
        if (ch.id && lowerIds.has(String(ch.id).trim().toLowerCase())) return true;
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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);
      const targetFolder = folders.find(f => f.id === targetFolderId);
      if (!targetFolder) return { success: false, movedCount: 0 };
      if (!Array.isArray(targetFolder.channels)) targetFolder.channels = [];

      const sourceFolder = (sourceFolderId && sourceFolderId !== '__uncategorized__')
        ? folders.find(f => f.id === sourceFolderId)
        : null;

      const channelIndex = _buildChannelLookupIndex(channels);
      const { isMatch } = _buildChannelMatcher(channelKeys, channels, channelIndex);

      const targetExistingSet = new Set();
      const registerTargetEntry = (rawEntry) => {
        if (!rawEntry) return;
        const s = String(rawEntry).trim();
        if (!s) return;
        const sLower = s.toLowerCase();
        targetExistingSet.add(sLower);
        const nh = normalizeHandle(s);
        if (nh && s.startsWith('@')) {
          targetExistingSet.add(nh);
          targetExistingSet.add('@' + nh);
        }
        const canon = canonicalizeChannelId(s, channels, channelIndex);
        if (canon) {
          targetExistingSet.add(canon.toLowerCase());
        }
        const chObj = (channels && Object.prototype.hasOwnProperty.call(channels, s) ? channels[s] : null) ||
                      channelIndex.get(sLower) ||
                      (nh ? (channelIndex.get(nh) || channelIndex.get('@' + nh)) : null);
        if (chObj) {
          if (chObj.id) targetExistingSet.add(String(chObj.id).trim().toLowerCase());
          if (chObj.handle) {
            const cnh = normalizeHandle(chObj.handle);
            if (cnh) {
              targetExistingSet.add(cnh);
              targetExistingSet.add('@' + cnh);
            }
          }
        }
      };

      for (const existingCid of targetFolder.channels) {
        registerTargetEntry(existingCid);
      }

      let movedCount = 0;
      for (const k of channelKeys) {
        if (!k) continue;
        const strK = String(k).trim();
        if (!strK) continue;
        const lowerK = strK.toLowerCase();
        const nh = normalizeHandle(strK);
        const ch = (channels && Object.prototype.hasOwnProperty.call(channels, strK) ? channels[strK] : null) ||
                   channelIndex.get(lowerK) ||
                   (nh ? (channelIndex.get(nh) || channelIndex.get('@' + nh)) : null);
        const canonicalId = (ch && ch.id && String(ch.id).startsWith('UC'))
          ? String(ch.id).trim()
          : (ch && ch.id ? String(ch.id).trim() : strK);
        const canonLower = canonicalId.toLowerCase();
        const chHandleNorm = ch && ch.handle ? normalizeHandle(ch.handle) : (strK.startsWith('@') ? nh : '');

        const existsInTarget =
          targetExistingSet.has(canonLower) ||
          targetExistingSet.has(lowerK) ||
          (chHandleNorm ? (targetExistingSet.has(chHandleNorm) || targetExistingSet.has('@' + chHandleNorm)) : false);

        if (!existsInTarget) {
          targetFolder.channels.push(canonicalId);
          registerTargetEntry(canonicalId);
          movedCount++;
        }
      }

      if (sourceFolder && sourceFolder.id !== targetFolder.id && Array.isArray(sourceFolder.channels)) {
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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);
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
    const safeName = String(channelName || '').slice(0, 300);
    const safeHandle = String(channelHandle || '').slice(0, 150);
    const safeDesc = String(channelDesc || '').slice(0, 500);
    const nameStr = safeName.toLowerCase();
    const handleLower = safeHandle.toLowerCase();
    const handleStr = handleLower.startsWith('@') ? handleLower.slice(1) : handleLower;
    const descStr = safeDesc.toLowerCase();

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      if (!kw || typeof kw !== 'string') continue;
      const cleanKw = kw.trim();
      if (!cleanKw) continue;
      if (cleanKw.charCodeAt(0) === 47) {
        const lastSlash = cleanKw.lastIndexOf('/');
        if (lastSlash > 1) {
          const pattern = cleanKw.slice(1, lastSlash);
          const rawFlags = cleanKw.slice(lastSlash + 1) || 'i';
          const re = getCompiledSafeRegex(pattern, rawFlags);
          if (re && (re.test(safeName) || re.test(safeHandle) || re.test(safeDesc))) return true;
          continue;
        }
      }
      const kwLower = cleanKw.toLowerCase();
      if (nameStr.includes(kwLower) || handleStr.includes(kwLower) || (descStr && descStr.includes(kwLower))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Pre-parses folder autoKeywords and initializes O(1) channel membership Sets
   * prior to batch channel loops.
   */
  function _prepareKeywordFolders(folders) {
    const prepared = [];
    if (!Array.isArray(folders)) return prepared;
    for (const folder of folders) {
      if (!folder || typeof folder !== 'object') continue;
      const kwList = Array.isArray(folder.autoKeywords)
        ? folder.autoKeywords
        : (typeof folder.autoKeywords === 'string'
            ? folder.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean)
            : []);
      if (kwList.length === 0) continue;
      if (!Array.isArray(folder.channels)) {
        folder.channels = [];
      }
      prepared.push({
        folder,
        kwList,
        channelSet: new Set(folder.channels)
      });
    }
    return prepared;
  }

  /**
   * Synchronously removes a channel from all folders and marks it as unsubscribed.
   * Matches across folder lists by canonical ID, @handle, aliases, and channel registry.
   */
  async function removeChannelFromAllFolders(channelId, channelHandle = '', channelName = '', { purgeFromStorage = false } = {}) {
    if (!channelId && !channelHandle && !channelName) return { success: false, removedCount: 0, affectedFolderIds: [] };

    return withStorageLock(async () => {
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);

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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);

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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);
      let updatedCount = 0;
      let foldersChanged = false;

      // Pre-parse autoKeywords and build O(1) membership sets once before channel loop
      const preparedKeywordFolders = _prepareKeywordFolders(folders);

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

        // Phase 4.1: Smart Auto-Categorization based on pre-indexed autoKeywords & Set membership
        if (targetObj && preparedKeywordFolders.length > 0) {
          const evalId = targetObj.id || lId;
          const evalName = targetObj.name || lName;
          const evalHandle = targetObj.handle || lHandle;
          const evalDesc = liveCh.description || targetObj.description || '';
          for (let i = 0; i < preparedKeywordFolders.length; i++) {
            const entry = preparedKeywordFolders[i];
            if (entry.channelSet.has(evalId)) continue;
            const matched = evalDesc
              ? matchesAutoKeywords({ name: evalName, handle: evalHandle, description: evalDesc }, entry.kwList)
              : matchesAutoKeywords(evalName, evalHandle, entry.kwList);
            if (matched) {
              entry.folder.channels.push(evalId);
              entry.channelSet.add(evalId);
              foldersChanged = true;
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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);
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
        await _removeChannelFromFolderUnlocked(folderId, chId, raw);
        return false; // Removed
      } else {
        await _addChannelToFolderUnlocked(folderId, channelInfo, raw);
        return true; // Added
      }
    });
  }

  async function getFoldersByChannel(channelId, channelHandle = '') {
    const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    const folders = await _getFoldersUnlocked(raw);
    const channels = await _getChannelsUnlocked(raw);
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

  /**
   * Pure in-memory calculation of uncategorized subscribed channels using O(1) hash indexing.
   */
  function computeUncategorizedChannels(folders = [], channels = {}) {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const safeChannels = (channels && typeof channels === 'object') ? channels : {};
    const assignedTokens = new Set();

    const channelByToken = _buildChannelLookupIndex(safeChannels);
    const isDict = !Array.isArray(safeChannels);
    const channelList = Array.isArray(safeChannels) ? safeChannels : Object.values(safeChannels);

    for (const f of safeFolders) {
      if (!f || !Array.isArray(f.channels)) continue;
      for (const chRef of f.channels) {
        if (!chRef) continue;
        const refStr = String(chRef).trim();
        if (!refStr) continue;
        const refLower = refStr.toLowerCase();
        assignedTokens.add(refLower);
        const nh = normalizeHandle(refStr);
        if (nh) {
          assignedTokens.add(nh);
          assignedTokens.add('@' + nh);
        }

        const chObj = (isDict && Object.prototype.hasOwnProperty.call(safeChannels, refStr) ? safeChannels[refStr] : null) ||
                      channelByToken.get(refLower) ||
                      (nh ? (channelByToken.get(nh) || channelByToken.get('@' + nh)) : null);
        if (chObj) {
          if (chObj.id) assignedTokens.add(String(chObj.id).trim().toLowerCase());
          if (chObj.handle) {
            const chH = normalizeHandle(chObj.handle);
            if (chH) {
              assignedTokens.add(chH);
              assignedTokens.add('@' + chH);
            }
          }
        }
      }
    }

    const uncategorized = [];
    for (const ch of channelList) {
      if (!ch) continue;
      const idStr = ch.id ? String(ch.id).trim().toLowerCase() : '';
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

  async function getUncategorizedChannels() {
    const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
    const folders = await _getFoldersUnlocked(raw);
    const channels = await _getChannelsUnlocked(raw);
    return computeUncategorizedChannels(folders, channels);
  }

  async function batchAddChannels(channelsArray) {
    return withStorageLock(async () => {
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const channels = await _getChannelsUnlocked(raw);
      const folders = await _getFoldersUnlocked(raw);
      let newCount = 0;
      let foldersChanged = false;

      // Pre-parse autoKeywords and build O(1) membership sets once before channel loop
      const preparedKeywordFolders = _prepareKeywordFolders(folders);

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

        // Phase 4.1: Smart Auto-Categorization based on pre-indexed autoKeywords & Set membership
        if (preparedKeywordFolders.length > 0) {
          const evalName = ch.name || targetKey;
          const evalDesc = ch.description || existingCh?.description || '';
          for (let i = 0; i < preparedKeywordFolders.length; i++) {
            const entry = preparedKeywordFolders[i];
            if (entry.channelSet.has(targetKey)) continue;
            const matched = evalDesc
              ? matchesAutoKeywords({ name: evalName, handle: ch.handle, description: evalDesc }, entry.kwList)
              : matchesAutoKeywords(evalName, ch.handle, entry.kwList);
            if (matched) {
              entry.folder.channels.push(targetKey);
              entry.channelSet.add(targetKey);
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
      let ch = (channelId && Object.prototype.hasOwnProperty.call(channels, channelId))
        ? channels[channelId]
        : null;
      if (!ch && channelId) {
        const targetLower = String(channelId).trim().toLowerCase();
        const normH = normalizeHandle(channelId);
        const channelIndex = _buildChannelLookupIndex(channels);
        ch = channelIndex.get(targetLower) ||
             (normH ? (channelIndex.get(normH) || channelIndex.get('@' + normH)) : null) ||
             null;
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
    const raw = await getRaw([
      STORAGE_KEYS.FOLDERS,
      STORAGE_KEYS.CHANNELS,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.INITIALIZED
    ]);
    const folders = await _getFoldersUnlocked(raw);
    const channels = await _getChannelsUnlocked(raw);
    const settings = _mergeSettingsFromRaw(raw[STORAGE_KEYS.SETTINGS]);
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

        incomingFolders.forEach((f, idx) => {
          if (!f || typeof f !== 'object') return;
          const rawFId = String(f.id || '').trim();
          const safeFId = (!rawFId || rawFId === '__proto__' || rawFId === 'constructor' || rawFId === 'prototype')
            ? `folder_${Date.now()}_${idx}`
            : rawFId;
          const incKw = Array.isArray(f.autoKeywords)
            ? f.autoKeywords.map(k => String(k).trim()).filter(Boolean)
            : (typeof f.autoKeywords === 'string' ? f.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean) : []);
          if (mergedFoldersMap.has(safeFId)) {
            const ex = mergedFoldersMap.get(safeFId);
            ex.channels = [...ex.channels, ...(f.channels || [])];
            if (incKw.length > 0) {
              const exKw = Array.isArray(ex.autoKeywords) ? ex.autoKeywords : [];
              ex.autoKeywords = Array.from(new Set([...exKw, ...incKw])).slice(0, 100);
            }
          } else {
            const incNormName = normalizeFolderIconAndName(f.name || '', f.icon).name.toLowerCase();
            const matchByName = Array.from(mergedFoldersMap.values()).find(ex =>
              normalizeFolderIconAndName(ex.name || '', ex.icon).name.toLowerCase() === incNormName
            );
            if (matchByName) {
              matchByName.channels = [...matchByName.channels, ...(f.channels || [])];
              if (incKw.length > 0) {
                const exKw = Array.isArray(matchByName.autoKeywords) ? matchByName.autoKeywords : [];
                matchByName.autoKeywords = Array.from(new Set([...exKw, ...incKw])).slice(0, 100);
              }
            } else {
              mergedFoldersMap.set(safeFId, { ...f, id: safeFId, autoKeywords: incKw.slice(0, 100), channels: [...(f.channels || [])] });
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
      const raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.CHANNELS, STORAGE_KEYS.INITIALIZED]);
      const folders = await _getFoldersUnlocked(raw);
      const channels = await _getChannelsUnlocked(raw);

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

  function sanitizeRemoteFolder(rf, fallbackIdx = 0) {
    if (!rf || typeof rf !== 'object' || Array.isArray(rf)) return null;
    const rawId = typeof rf.id === 'string' ? rf.id.trim() : String(rf.id || '').trim();
    if (!rawId || rawId === '__proto__' || rawId === 'constructor' || rawId === 'prototype') {
      return null;
    }
    const normalized = normalizeFolderIconAndName(rf.name || `Folder ${fallbackIdx + 1}`, rf.icon);
    const safeAutoKeywords = Array.isArray(rf.autoKeywords)
      ? Array.from(new Set(rf.autoKeywords.map(k => String(k || '').trim()).filter(Boolean))).slice(0, 100)
      : (typeof rf.autoKeywords === 'string'
          ? Array.from(new Set(rf.autoKeywords.split(/[,，\n]/).map(k => k.trim()).filter(Boolean))).slice(0, 100)
          : []);
    const safeChannels = Array.isArray(rf.channels)
      ? Array.from(new Set(
          rf.channels
            .filter(c => typeof c === 'string')
            .map(c => c.trim())
            .filter(c => c.length > 0 && c !== '__proto__' && c !== 'constructor' && c !== 'prototype' && !checkSystemActionTitle(c))
        ))
      : [];
    return {
      id: rawId.slice(0, 128),
      name: normalized.name,
      icon: normalized.icon,
      color: sanitizeFolderColor(rf.color),
      description: String(rf.description || '').trim().slice(0, 500),
      autoKeywords: safeAutoKeywords,
      channels: safeChannels
    };
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
        for (let i = 0; i < remote.folders.length; i++) {
          const cleanRf = sanitizeRemoteFolder(remote.folders[i], localFolders.length + i);
          if (!cleanRf) continue;
          if (folderMap.has(cleanRf.id)) {
            const ex = folderMap.get(cleanRf.id);
            const existingSafeChannels = Array.isArray(ex.channels)
              ? ex.channels.filter(c => typeof c === 'string' && c.trim() && c !== '__proto__' && c !== 'constructor' && c !== 'prototype' && !checkSystemActionTitle(c))
              : [];
            ex.channels = Array.from(new Set([...existingSafeChannels, ...cleanRf.channels]));
            if (cleanRf.autoKeywords.length > 0) {
              const existingKw = Array.isArray(ex.autoKeywords)
                ? ex.autoKeywords.map(k => String(k || '').trim()).filter(Boolean)
                : [];
              ex.autoKeywords = Array.from(new Set([...existingKw, ...cleanRf.autoKeywords])).slice(0, 100);
            }
          } else {
            localFolders.push(cleanRf);
            folderMap.set(cleanRf.id, cleanRf);
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
      for (let i = 0; i < remote.folders.length; i++) {
        const cleanRf = sanitizeRemoteFolder(remote.folders[i], localFolders.length + i);
        if (!cleanRf) continue;
        if (folderMap.has(cleanRf.id)) {
          const ex = folderMap.get(cleanRf.id);
          const existingSafeChannels = Array.isArray(ex.channels)
            ? ex.channels.filter(c => typeof c === 'string' && c.trim() && c !== '__proto__' && c !== 'constructor' && c !== 'prototype' && !checkSystemActionTitle(c))
            : [];
          ex.channels = Array.from(new Set([...existingSafeChannels, ...cleanRf.channels]));
          if (cleanRf.autoKeywords.length > 0) {
            const existingKw = Array.isArray(ex.autoKeywords)
              ? ex.autoKeywords.map(k => String(k || '').trim()).filter(Boolean)
              : [];
            ex.autoKeywords = Array.from(new Set([...existingKw, ...cleanRf.autoKeywords])).slice(0, 100);
          }
        } else {
          localFolders.push(cleanRf);
          folderMap.set(cleanRf.id, cleanRf);
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

  async function _setStorageUnlocked(items) {
    await setRaw(items);
    notifyChange();
  }

  async function setStorage(items) {
    return withStorageLock(() => _setStorageUnlocked(items));
  }

  function canonicalizeChannelId(rawId, subscribedChannels = {}, prebuiltIndex = null) {
    if (!rawId) return '';
    const strId = String(rawId).trim();
    if (!strId) return '';
    if (subscribedChannels && typeof subscribedChannels === 'object' && !Array.isArray(subscribedChannels)) {
      const direct = Object.prototype.hasOwnProperty.call(subscribedChannels, strId) ? subscribedChannels[strId] : null;
      if (direct && direct.id) {
        return String(direct.id).trim();
      }
    }
    if (prebuiltIndex instanceof Map) {
      const lowerId = strId.toLowerCase();
      const normH = normalizeHandle(strId);
      const hit = prebuiltIndex.get(lowerId) || (normH ? (prebuiltIndex.get(normH) || prebuiltIndex.get('@' + normH)) : null);
      if (hit) {
        return String(hit.id || strId).trim();
      }
      return strId;
    }
    if (subscribedChannels && typeof subscribedChannels === 'object') {
      const lowerId = strId.toLowerCase();
      const normH = normalizeHandle(strId);
      const list = Array.isArray(subscribedChannels) ? subscribedChannels : Object.values(subscribedChannels);
      for (const ch of list) {
        if (!ch) continue;
        if (ch.id && String(ch.id).trim().toLowerCase() === lowerId) {
          return String(ch.id).trim();
        }
        if (normH && ch.handle && normalizeHandle(ch.handle) === normH) {
          return String(ch.id || strId).trim();
        }
      }
    }
    return strId;
  }

  async function getAllData() {
    let raw = await getRaw([
      STORAGE_KEYS.FOLDERS,
      STORAGE_KEYS.CHANNELS,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.INITIALIZED
    ]);
    const missingFolders = !Array.isArray(raw[STORAGE_KEYS.FOLDERS]);
    const missingChannels = !raw[STORAGE_KEYS.CHANNELS] || typeof raw[STORAGE_KEYS.CHANNELS] !== 'object';
    if (!raw[STORAGE_KEYS.INITIALIZED] && (missingFolders || missingChannels)) {
      await _initUnlocked(false);
      raw = await getRaw([
        STORAGE_KEYS.FOLDERS,
        STORAGE_KEYS.CHANNELS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.INITIALIZED
      ]);
    }
    const folders = await _getFoldersUnlocked(raw);
    const subscribedChannels = await _getChannelsUnlocked(raw);
    const settings = _mergeSettingsFromRaw(raw[STORAGE_KEYS.SETTINGS]);
    const uncategorizedChannels = computeUncategorizedChannels(folders, subscribedChannels);
    return {
      folders,
      channels: subscribedChannels,
      subscribedChannels,
      uncategorizedChannels,
      settings
    };
  }

  async function runAutoCategorization(options = {}) {
    return withStorageLock(async () => {
      const includeCategorized = !!(options && options.includeCategorized);
      const data = await getAllData();
      const subscribedChannels = data.subscribedChannels || {};
      const folders = Array.isArray(data.folders) ? data.folders : [];
      const channelIndex = _buildChannelLookupIndex(subscribedChannels);

      let candidateChannels = [];
      if (!includeCategorized) {
        const categorizedSet = new Set();
        for (const f of folders) {
          if (!f || !Array.isArray(f.channels)) continue;
          for (const cid of f.channels) {
            if (!cid) continue;
            const rawStr = String(cid).trim();
            if (rawStr) {
              categorizedSet.add(rawStr);
              categorizedSet.add(rawStr.toLowerCase());
            }
            const canonId = canonicalizeChannelId(cid, subscribedChannels, channelIndex);
            if (canonId) {
              categorizedSet.add(canonId);
              categorizedSet.add(canonId.toLowerCase());
            }
          }
        }
        candidateChannels = Object.values(subscribedChannels).filter(ch => {
          if (!ch || !ch.id) return false;
          const rawId = String(ch.id).trim();
          const canonId = canonicalizeChannelId(rawId, subscribedChannels, channelIndex);
          return !categorizedSet.has(rawId) &&
                 !categorizedSet.has(rawId.toLowerCase()) &&
                 !categorizedSet.has(canonId) &&
                 !categorizedSet.has(canonId.toLowerCase());
        });
      } else {
        candidateChannels = Object.values(subscribedChannels);
      }

      const keywordFolderEntries = [];
      for (const f of folders) {
        if (!f || !Array.isArray(f.autoKeywords) || f.autoKeywords.length === 0) continue;
        if (!Array.isArray(f.channels)) {
          f.channels = [];
        }
        const canonSet = new Set();
        for (const existingId of f.channels) {
          if (!existingId) continue;
          canonSet.add(existingId);
          const canon = canonicalizeChannelId(existingId, subscribedChannels, channelIndex);
          if (canon) canonSet.add(canon);
        }
        keywordFolderEntries.push({ folder: f, canonSet });
      }

      let matchedChannelsCount = 0;
      let totalAssignments = 0;
      const affectedFolderIdSet = new Set();

      for (const ch of candidateChannels) {
        if (!ch || !ch.id || checkSystemActionTitle(ch.name)) {
          continue;
        }
        const targetId = canonicalizeChannelId(ch.id, subscribedChannels, channelIndex);
        if (!targetId) continue;

        let channelMatchedAny = false;
        for (let i = 0; i < keywordFolderEntries.length; i++) {
          const { folder, canonSet } = keywordFolderEntries[i];
          if (canonSet.has(targetId) || canonSet.has(ch.id)) continue;
          if (!matchesAutoKeywords(ch, folder.autoKeywords)) continue;
          folder.channels.push(targetId);
          canonSet.add(targetId);
          canonSet.add(ch.id);
          totalAssignments++;
          affectedFolderIdSet.add(folder.id);
          channelMatchedAny = true;
        }
        if (channelMatchedAny) {
          matchedChannelsCount++;
        }
      }

      if (totalAssignments > 0) {
        await _setStorageUnlocked({ [STORAGE_KEYS.FOLDERS]: data.folders });
      }

      return {
        success: true,
        matchedChannelsCount,
        totalAssignments,
        affectedFolderIds: Array.from(affectedFolderIdSet)
      };
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
    setStorage,
    getAllData,
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
    computeUncategorizedChannels,
    batchAddChannels,
    setChannelSubscribed,
    batchUpdateChannels,
    deduplicateData,
    cleanDuplicates,
    exportData,
    importData,
    exportSyncSkeleton,
    syncWithCloud,
    runAutoCategorization,
    canonicalizeChannelId,
    matchesAutoKeywords,
    getCompiledSafeRegex,
    isSafeRegexPattern,
    ALLOWED_AVATAR_HOSTS,
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

