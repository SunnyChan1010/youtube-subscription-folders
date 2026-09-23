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
    showInSidebar: true,
    showFeedFilter: true,
    activeFeedFolderId: 'all',
    expandedFolders: {}
  };

  function normalizeHandle(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase().replace(/^@/, '');
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

  // Initialize data from bundled YT_INITIAL_DATA
  async function init(force = false) {
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
    let raw = await getRaw([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.INITIALIZED]);
    let folders = raw[STORAGE_KEYS.FOLDERS];
    if (!raw[STORAGE_KEYS.INITIALIZED] && (!folders || !Array.isArray(folders))) {
      await init(false);
      raw = await getRaw([STORAGE_KEYS.FOLDERS]);
      folders = raw[STORAGE_KEYS.FOLDERS] || [];
    }
    return Array.isArray(folders) ? folders : [];
  }

  async function setFolders(folders) {
    await setRaw({ [STORAGE_KEYS.FOLDERS]: folders });
    notifyChange();
  }

  async function getChannels() {
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
            avatarUrl: ch.avatarUrl || ''
          };
        }
      });
      channels = map;
      await setRaw({ [STORAGE_KEYS.CHANNELS]: channels });
    }

    if (!raw[STORAGE_KEYS.INITIALIZED] && (!channels || typeof channels !== 'object')) {
      await init(false);
      raw = await getRaw([STORAGE_KEYS.CHANNELS]);
      channels = raw[STORAGE_KEYS.CHANNELS] || {};
    }
    return (channels && typeof channels === 'object') ? channels : {};
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
          rawChannelsList.push(item);
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

    // 2. Build Canonical Channel Registry (merging duplicates)
    const canonicalList = [];
    const aliasToCanonicalId = {};

    function findCanonical(item) {
      if (!item) return null;
      const idStr = item.id ? String(item.id).trim() : '';
      const hStr = normalizeHandle(item.handle);

      for (const c of canonicalList) {
        const cId = String(c.id).trim();
        const cH = normalizeHandle(c.handle);

        if (idStr && cId && idStr.toLowerCase() === cId.toLowerCase()) return c;
        if (hStr && cH && hStr === cH) return c;
        if (idStr && cH && normalizeHandle(idStr) === cH) return c;
        if (hStr && cId && hStr === normalizeHandle(cId)) return c;
      }
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
          avatarUrl: rawAvatar,
          isSubscribed: Boolean(raw.isSubscribed)
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
          canon.avatarUrl = rawAvatar;
        }
        if (rawName && (!canon.name || canon.name.startsWith('@') || canon.name.startsWith('UC'))) {
          canon.name = rawName;
        }
        if (raw.isSubscribed) {
          canon.isSubscribed = true;
        }
      }

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
        return direct ? direct.id : (ref.id || ref.handle);
      }
      const str = String(ref).trim();
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

        // Ensure canonicalList has this channel
        if (!canonicalList.find(c => c.id.toLowerCase() === canonKey)) {
          canonicalList.push({
            id: canonId,
            handle: canonId.startsWith('@') ? canonId : '',
            name: canonId,
            avatarUrl: ''
          });
        }
      }

      cleanFolders.push({
        id: f.id || `folder_${Date.now()}_${cleanFolders.length}`,
        name: f.name || `Folder ${cleanFolders.length + 1}`,
        icon: f.icon || '📁',
        color: f.color || '#2196f3',
        description: f.description || '',
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

    for (const u of uncategorizedChannels) {
      const uId = resolveToCanonicalId(u.id || u.handle || u);
      if (!uId) continue;

      if (prioritizeCategorized && seenInAnyFolder.has(uId.toLowerCase())) {
        dupUncategorizedRemoved++;
      } else if (!seenInAnyFolder.has(uId.toLowerCase())) {
        if (!cleanUncategorized.some(ex => ex.id.toLowerCase() === uId.toLowerCase())) {
          const chObj = cleanChannelsMap[uId] || { id: uId, name: u.name || uId, handle: u.handle || '', avatarUrl: u.avatarUrl || '' };
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
  async function addChannelToFolder(folderId, channelInfo) {
    const folders = await getFolders();
    const channels = await getChannels();

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
      avatarUrl: channelInfo.avatarUrl || existing?.avatarUrl || ''
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
    const channels = await getChannels();
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

    await setFolders(folders);
    return true;
  }

  /**
   * Synchronously removes a channel from all folders and marks it as unsubscribed.
   * Matches across folder lists by canonical ID, @handle, aliases, and channel registry.
   */
  async function removeChannelFromAllFolders(channelId, channelHandle = '') {
    if (!channelId && !channelHandle) return { success: false, removedCount: 0, affectedFolderIds: [] };

    const folders = await getFolders();
    const channels = await getChannels();

    const normTargetHandle = normalizeHandle(channelHandle || channelId);
    const targetLower = (channelId || '').toLowerCase();
    const handleLower = (channelHandle || '').toLowerCase();

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
    for (const [key, ch] of Object.entries(channels)) {
      if (!ch) continue;
      const kLower = key.toLowerCase();
      const kNorm = normalizeHandle(key);
      const chIdLower = (ch.id || '').toLowerCase();
      const chHandleNorm = normalizeHandle(ch.handle || '');
      const chHandleLower = (ch.handle || '').toLowerCase();

      const isMatch = (
        matchingIds.has(kLower) ||
        (kNorm && matchingIds.has(kNorm)) ||
        (chIdLower && matchingIds.has(chIdLower)) ||
        (chHandleNorm && matchingIds.has(chHandleNorm)) ||
        (chHandleLower && matchingIds.has(chHandleLower))
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
        ch.isSubscribed = false;
      }
    }

    // Direct key check
    if (targetLower && channels[targetLower]) {
      channels[targetLower].isSubscribed = false;
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
  }

  async function toggleChannelInFolder(folderId, channelInfo) {
    const folders = await getFolders();
    const channels = await getChannels();
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
      await removeChannelFromFolder(folderId, chId);
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
    const folders = await getFolders();
    const channels = await getChannels();
    const assignedTokens = new Set();

    folders.forEach(f => {
      if (Array.isArray(f.channels)) {
        f.channels.forEach(chRef => {
          if (!chRef) return;
          const refStr = String(chRef).trim();
          assignedTokens.add(refStr.toLowerCase());
          const nh = normalizeHandle(refStr);
          if (nh) {
            assignedTokens.add(nh);
            assignedTokens.add('@' + nh);
          }

          const chObj = channels[refStr] || Object.values(channels).find(c =>
            (c.id && c.id.toLowerCase() === refStr.toLowerCase()) ||
            (c.handle && normalizeHandle(c.handle) === nh)
          );
          if (chObj) {
            if (chObj.id) assignedTokens.add(chObj.id.toLowerCase());
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
    const channelList = Array.isArray(channels) ? channels : Object.values(channels);

    for (const ch of channelList) {
      if (!ch) continue;
      const idStr = ch.id ? String(ch.id).toLowerCase() : '';
      const handleStr = ch.handle ? normalizeHandle(ch.handle) : '';

      const isAssigned = (idStr && assignedTokens.has(idStr)) ||
                         (handleStr && (assignedTokens.has(handleStr) || assignedTokens.has('@' + handleStr)));

      if (!isAssigned) {
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

      const normH = normalizeHandle(ch.handle || id);
      const existingKey = Object.keys(channels).find(k =>
        k.toLowerCase() === id.toLowerCase() ||
        (channels[k].handle && normalizeHandle(channels[k].handle) === normH)
      );

      const targetKey = existingKey || id;
      if (!existingKey) {
        newCount++;
      }

      channels[targetKey] = {
        id: channels[targetKey]?.id || id,
        name: ch.name || channels[targetKey]?.name || id,
        handle: ch.handle || channels[targetKey]?.handle || '',
        avatarUrl: ch.avatarUrl || channels[targetKey]?.avatarUrl || '',
        isSubscribed: ch.isSubscribed !== undefined ? ch.isSubscribed : (channels[targetKey]?.isSubscribed || false)
      };
    }

    await setRaw({ [STORAGE_KEYS.CHANNELS]: channels });
    notifyChange();
    return { total: Object.keys(channels).length, newCount };
  }

  async function setChannelSubscribed(channelId, isSubscribed = true) {
    const channels = await getChannels();
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
      ch.isSubscribed = isSubscribed;
      await setChannels(channels);
      return true;
    }
    return false;
  }

  async function batchUpdateChannels(updates) {
    const channels = await getChannels();
    for (const u of updates) {
      const id = u.id || u.handle;
      if (!id) continue;
      if (channels[id]) {
        Object.assign(channels[id], u);
      } else {
        channels[id] = u;
      }
    }
    await setChannels(channels);
  }

  // ---------------------------------------------------------------------------
  // Backup Export, Import & Clean Duplicates
  // ---------------------------------------------------------------------------
  async function exportData() {
    const folders = await getFolders();
    const channels = await getChannels();
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
      const existingFolders = await getFolders();
      const existingChannels = await getChannels();

      const mergedFoldersMap = new Map();
      existingFolders.forEach(f => {
        mergedFoldersMap.set(f.id, { ...f, channels: [...(f.channels || [])] });
      });

      incomingFolders.forEach(f => {
        if (mergedFoldersMap.has(f.id)) {
          const ex = mergedFoldersMap.get(f.id);
          ex.channels = [...ex.channels, ...(f.channels || [])];
        } else {
          const matchByName = Array.from(mergedFoldersMap.values()).find(ex =>
            ex.name.trim().toLowerCase() === (f.name || '').trim().toLowerCase()
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
    const settings = Object.assign({}, currentSettings, parsed.settings || {});

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
  }

  // Standalone duplicate cleaner for current storage
  async function cleanDuplicates(singleFolderMode = true) {
    const folders = await getFolders();
    const channels = await getChannels();

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
    addChannelToFolder,
    removeChannelFromFolder,
    removeChannelFromAllFolders,
    toggleChannelInFolder,
    getFoldersByChannel,
    getUncategorizedChannels,
    batchAddChannels,
    setChannelSubscribed,
    batchUpdateChannels,
    deduplicateData,
    cleanDuplicates,
    exportData,
    importData
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = YTFolderStorage;
}
