/**
 * YouTube Subscription Folders - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_AVATAR = (typeof YT_DEFAULT_AVATAR !== 'undefined' ? YT_DEFAULT_AVATAR : "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiMyODI4MjgiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjgiIHI9IjMuNiIgZmlsbD0iI2FhYWFhYSIvPjxwYXRoIGQ9Ik0xMiAxMy41Yy0zIDAtNi41IDEuNS02LjUgMy41djEuNWgxM3YtMS41YzAtMi0zLjUtMy41LTYuNS0zLjV6IiBmaWxsPSIjYWFhYWFhIi8+PC9zdmc+");

  // Safe image error fallback (replaces inline onerror CSP violation)
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') {
      if (e.target.src !== DEFAULT_AVATAR) {
        e.target.src = DEFAULT_AVATAR;
      }
    }
  }, true);

  await YTFolderStorage.init();

  const folderListEl = document.getElementById('folder-list');
  const statsTextEl = document.getElementById('stats-text');
  const searchInput = document.getElementById('search-input');
  const chkHideWatched = document.getElementById('chk-hide-watched');
  const chkHideShorts = document.getElementById('chk-hide-shorts');
  const chkOnlyLive = document.getElementById('chk-only-live');
  const btnOpenFeed = document.getElementById('btn-open-feed');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnAddFolder = document.getElementById('btn-add-folder');
  const btnManageAll = document.getElementById('btn-manage-all');

  let allFolders = [];
  let allChannels = {};
  let currentSettings = {};
  let foldersByChannelToken = new Map();
  let searchDebounceTimer = null;

  function normalizePopupHandle(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase().replace(/^@/, '');
  }

  function rebuildPopupFolderIndex() {
    const nextIndex = new Map();
    const channelByToken = new Map();

    if (allChannels && typeof allChannels === 'object') {
      for (const [k, ch] of Object.entries(allChannels)) {
        if (!ch || typeof ch !== 'object') continue;
        if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
          channelByToken.set(String(k).trim().toLowerCase(), ch);
        }
        if (ch.id) {
          const idLower = String(ch.id).trim().toLowerCase();
          if (idLower) channelByToken.set(idLower, ch);
        }
        if (ch.handle) {
          const nh = normalizePopupHandle(ch.handle);
          if (nh) {
            channelByToken.set(nh, ch);
            channelByToken.set('@' + nh, ch);
          }
        }
      }
    }

    const addFolderToken = (token, folder, seenTokens) => {
      if (!token || seenTokens.has(token)) return;
      seenTokens.add(token);
      let bucket = nextIndex.get(token);
      if (!bucket) {
        bucket = [];
        nextIndex.set(token, bucket);
      }
      bucket.push(folder);
    };

    for (const f of allFolders) {
      if (!f || !Array.isArray(f.channels) || f.channels.length === 0) continue;
      const seenTokens = new Set();
      for (const cid of f.channels) {
        if (!cid) continue;
        const cidStr = String(cid).trim();
        if (!cidStr) continue;
        const cidLower = cidStr.toLowerCase();
        const cidNormH = normalizePopupHandle(cidLower);

        addFolderToken(cidLower, f, seenTokens);
        if (cidNormH) {
          addFolderToken(cidNormH, f, seenTokens);
          addFolderToken('@' + cidNormH, f, seenTokens);
        }

        const linkedCh = (Object.prototype.hasOwnProperty.call(allChannels, cidStr) ? allChannels[cidStr] : null) ||
          channelByToken.get(cidLower) ||
          (cidNormH ? channelByToken.get(cidNormH) : null);
        if (linkedCh) {
          if (linkedCh.id) {
            const linkedIdLower = String(linkedCh.id).trim().toLowerCase();
            addFolderToken(linkedIdLower, f, seenTokens);
          }
          if (linkedCh.handle) {
            const linkedNh = normalizePopupHandle(linkedCh.handle);
            if (linkedNh) {
              addFolderToken(linkedNh, f, seenTokens);
              addFolderToken('@' + linkedNh, f, seenTokens);
            }
          }
        }
      }
    }

    foldersByChannelToken = nextIndex;
  }

  function escapeHtml(str) {
    if (typeof YTFolderUtils !== 'undefined' && YTFolderUtils && typeof YTFolderUtils.escapeHtml === 'function') {
      return YTFolderUtils.escapeHtml(str);
    }
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url) {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (!trimmed || trimmed === '#') return '#';
    if (/^\/\//.test(trimmed) || /^(?:javascript|data|vbscript|blob|file):/i.test(trimmed)) {
      return '#';
    }
    if (typeof YTFolderUtils !== 'undefined' && YTFolderUtils && typeof YTFolderUtils.sanitizeUrl === 'function') {
      return YTFolderUtils.sanitizeUrl(trimmed);
    }
    if (trimmed.startsWith('/')) {
      return escapeHtml(trimmed);
    }
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
          return escapeHtml(trimmed);
        }
      } catch (e) {}
    }
    return '#';
  }

  function sanitizeAvatarUrl(url) {
    if (typeof YTFolderStorage !== 'undefined' && YTFolderStorage && typeof YTFolderStorage.sanitizeAvatarUrl === 'function') {
      return YTFolderStorage.sanitizeAvatarUrl(url);
    }
    if (typeof YTFolderUtils !== 'undefined' && YTFolderUtils && typeof YTFolderUtils.sanitizeAvatarUrl === 'function') {
      return YTFolderUtils.sanitizeAvatarUrl(url);
    }
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
        const host = parsed.hostname.toLowerCase();
        const allowedHosts = ['yt3.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com', 'ytimg.com', 'youtube.com', 'gstatic.com'];
        if (allowedHosts.some(h => host === h || host.endsWith('.' + h))) {
          parsed.protocol = 'https:';
          return parsed.toString();
        }
      } catch (e) {}
    }
    return '';
  }

  async function selectFeedFolderInStorage(folderId) {
    const nextFolderId = folderId || 'all';
    const nextSelected = nextFolderId === 'all' ? [] : [nextFolderId];
    const nextMuted = Array.isArray(currentSettings.mutedFeedFolderIds)
      ? currentSettings.mutedFeedFolderIds.filter(id => id !== nextFolderId)
      : [];
    currentSettings.activeFeedFolderId = nextFolderId;
    currentSettings.selectedFeedFolderIds = nextSelected;
    currentSettings.mutedFeedFolderIds = nextMuted;
    await YTFolderStorage.updateSettings({
      activeFeedFolderId: nextFolderId,
      selectedFeedFolderIds: nextSelected,
      mutedFeedFolderIds: nextMuted
    });
  }

  async function refreshData() {
    const data = await YTFolderStorage.getAllData();
    allFolders = Array.isArray(data.folders) ? data.folders : [];
    allChannels = data.channels || {};
    const settings = data.settings || {};
    currentSettings = settings;
    rebuildPopupFolderIndex();

    if (chkHideWatched) chkHideWatched.checked = Boolean(settings.hideWatched);
    if (chkHideShorts) chkHideShorts.checked = !!settings.hideShorts;
    if (chkOnlyLive) chkOnlyLive.checked = !!settings.onlyShowLive || !!settings.onlyLive;

    const totalAssigned = allFolders.reduce((acc, f) => acc + (f.channels?.length || 0), 0);
    statsTextEl.textContent = `${allFolders.length} 個分組 · ${totalAssigned} 頻道歸類`;

    renderList(searchInput.value);
  }

  function renderList(searchQuery = '') {
    const query = searchQuery.trim().toLowerCase();
    folderListEl.innerHTML = '';

    if (!query) {
      allFolders.forEach(folder => {
        const count = folder.channels ? folder.channels.length : 0;
        const card = document.createElement('div');
        card.className = 'folder-card';
        card.innerHTML = `
          <div class="folder-card-main">
            <span class="folder-card-icon">${escapeHtml(folder.icon || '📁')}</span>
            <div class="folder-card-info">
              <div class="folder-card-name">${escapeHtml(folder.name)}</div>
              <div class="folder-card-meta">${count} 個頻道</div>
            </div>
          </div>
          <button class="folder-card-feed-btn" title="在 YouTube 動態牆只看此分組">
            <span>📺 睇動態</span>
          </button>
        `;

        const feedBtn = card.querySelector('.folder-card-feed-btn');
        feedBtn.onclick = async (e) => {
          e.stopPropagation();
          await selectFeedFolderInStorage(folder.id);
          openOrSwitchToFeed(folder.id);
        };

        card.onclick = () => {
          chrome.runtime.openOptionsPage();
        };

        folderListEl.appendChild(card);
      });
      return;
    }

    // Search Mode
    const matchedFolders = allFolders.filter(f =>
      (f.name && f.name.toLowerCase().includes(query)) ||
      (f.icon && f.icon.toLowerCase().includes(query)) ||
      (f.description && f.description.toLowerCase().includes(query))
    );

    const matchedChannels = Object.values(allChannels).filter(ch =>
      (ch.name && ch.name.toLowerCase().includes(query)) ||
      (ch.handle && ch.handle.toLowerCase().includes(query)) ||
      (ch.id && ch.id.toLowerCase().includes(query))
    );

    if (matchedFolders.length === 0 && matchedChannels.length === 0) {
      folderListEl.innerHTML = `
        <div style="text-align: center; padding: 40px 10px; color: var(--text-secondary); font-size: 13px;">
          沒有找到符合「${escapeHtml(query)}」的分組或頻道
        </div>
      `;
      return;
    }

    if (matchedFolders.length > 0) {
      const secTitle = document.createElement('div');
      secTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 4px 0 2px 0;';
      secTitle.textContent = `📁 符合的分組 (${matchedFolders.length})`;
      folderListEl.appendChild(secTitle);

      matchedFolders.forEach(folder => {
        const count = folder.channels ? folder.channels.length : 0;
        const card = document.createElement('div');
        card.className = 'folder-card';
        card.innerHTML = `
          <div class="folder-card-main">
            <span class="folder-card-icon">${escapeHtml(folder.icon || '📁')}</span>
            <div class="folder-card-info">
              <div class="folder-card-name">${escapeHtml(folder.name)}</div>
              <div class="folder-card-meta">${count} 個頻道</div>
            </div>
          </div>
          <button class="folder-card-feed-btn" title="在動態牆只看此分組">
            <span>📺 睇動態</span>
          </button>
        `;
        card.querySelector('.folder-card-feed-btn').onclick = async (e) => {
          e.stopPropagation();
          await selectFeedFolderInStorage(folder.id);
          openOrSwitchToFeed(folder.id);
        };
        card.onclick = () => {
          chrome.runtime.openOptionsPage();
        };
        folderListEl.appendChild(card);
      });
    }

    if (matchedChannels.length > 0) {
      const secTitle = document.createElement('div');
      secTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-secondary); padding: 10px 0 4px 0;';
      secTitle.textContent = `📺 符合的頻道及所屬分組 (${matchedChannels.length})`;
      folderListEl.appendChild(secTitle);

      const defaultAvatar = DEFAULT_AVATAR;
      matchedChannels.slice(0, 25).forEach(ch => {
        const normHandle = normalizePopupHandle(ch.handle);
        const chLower = String(ch.id || '').trim().toLowerCase();
        const byId = chLower ? foldersByChannelToken.get(chLower) : null;
        const byHandle = normHandle
          ? (foldersByChannelToken.get(normHandle) || foldersByChannelToken.get('@' + normHandle))
          : null;

        let inFolders = [];
        if (byId && byHandle && byId !== byHandle) {
          const seenFolders = new Set(byId);
          inFolders = byId.slice();
          for (const f of byHandle) {
            if (!seenFolders.has(f)) {
              seenFolders.add(f);
              inFolders.push(f);
            }
          }
        } else if (byId) {
          inFolders = byId;
        } else if (byHandle) {
          inFolders = byHandle;
        }

        const item = document.createElement('div');
        item.className = 'search-result-item';

        let foldersHtml = '';
        if (inFolders.length > 0) {
          foldersHtml = inFolders.map(f =>
            `<span class="search-folder-tag" data-folder-id="${escapeHtml(f.id)}" title="點擊在動態牆只看此分組">${escapeHtml(f.icon || '📁')} ${escapeHtml(f.name)}</span>`
          ).join('');
        } else {
          foldersHtml = `<span class="search-folder-tag unassigned">尚未加入任何分組</span>`;
        }

        const safeAvatar = sanitizeAvatarUrl(ch.avatarUrl) || defaultAvatar;
        item.innerHTML = `
          <div class="search-result-top">
            <img class="search-result-avatar" src="${escapeHtml(safeAvatar)}" data-default-src="${escapeHtml(defaultAvatar)}" alt="" />
            <div class="search-result-info">
              <div class="search-result-name">${escapeHtml(ch.name || ch.handle)}</div>
              <div class="search-result-handle">${escapeHtml(ch.handle || ch.id)}</div>
            </div>
          </div>
          <div class="search-result-folders-wrap">
            <span style="font-size: 11px; color: var(--text-secondary); margin-right: 2px;">所屬分組:</span>
            ${foldersHtml}
          </div>
          <div class="search-result-actions">
            <button class="btn-search-action btn-go-channel" title="在 YouTube 打開此頻道">
              <span>🔗 前往頻道</span>
            </button>
          </div>
        `;

        item.querySelectorAll('.search-folder-tag[data-folder-id]').forEach(tag => {
          tag.onclick = async (e) => {
            e.stopPropagation();
            const fId = tag.dataset.folderId;
            await selectFeedFolderInStorage(fId);
            openOrSwitchToFeed(fId);
          };
        });

        item.querySelector('.btn-go-channel').onclick = (e) => {
          e.stopPropagation();
          const rawUrl = ch.handle
            ? `https://www.youtube.com/${encodeURIComponent(ch.handle).replace(/^%40/, '@')}`
            : `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`;
          const safeTarget = sanitizeUrl(rawUrl);
          if (safeTarget && safeTarget !== '#') {
            chrome.tabs.create({ url: rawUrl });
          }
        };

        folderListEl.appendChild(item);
      });
    }
  }

  function openOrSwitchToFeed(folderId = null) {
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
      const feedTab = tabs.find(t => t.url && t.url.includes('/feed/subscriptions'));
      if (feedTab) {
        chrome.tabs.update(feedTab.id, { active: true });
        chrome.tabs.sendMessage(feedTab.id, { action: 'SET_FILTER_FOLDER', folderId }).catch(() => {
          chrome.tabs.reload(feedTab.id);
        });
      } else {
        chrome.tabs.create({ url: 'https://www.youtube.com/feed/subscriptions' });
      }
      window.close();
    });
  }

  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (searchInput.value === '') {
      renderList('');
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      renderList(searchInput.value);
    }, 100);
  });

  chkHideWatched.addEventListener('change', async (e) => {
    await YTFolderStorage.updateSettings({ hideWatched: e.target.checked });
  });

  if (chkHideShorts) {
    chkHideShorts.addEventListener('change', async () => {
      await YTFolderStorage.updateSettings({ hideShorts: chkHideShorts.checked });
    });
  }

  if (chkOnlyLive) {
    chkOnlyLive.addEventListener('change', async () => {
      await YTFolderStorage.updateSettings({ onlyShowLive: chkOnlyLive.checked, onlyLive: chkOnlyLive.checked });
    });
  }

  btnOpenFeed.addEventListener('click', () => {
    openOrSwitchToFeed();
  });

  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btnManageAll.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const popupInlineAdd = document.getElementById('popup-inline-add');
  const inputNewFolderName = document.getElementById('input-new-folder-name');
  const btnSubmitNewFolder = document.getElementById('btn-submit-new-folder');
  const btnCancelNewFolder = document.getElementById('btn-cancel-new-folder');

  function showInlineAddFolder() {
    if (!popupInlineAdd) return;
    popupInlineAdd.style.display = 'flex';
    if (inputNewFolderName) {
      inputNewFolderName.value = '';
      inputNewFolderName.focus();
    }
  }

  function hideInlineAddFolder() {
    if (!popupInlineAdd) return;
    popupInlineAdd.style.display = 'none';
    if (inputNewFolderName) {
      inputNewFolderName.value = '';
    }
  }

  async function handleCreateFolder() {
    const name = inputNewFolderName ? inputNewFolderName.value.trim() : '';
    if (!name) return;
    await YTFolderStorage.addFolder({ name });
    hideInlineAddFolder();
    await refreshData();
  }

  btnAddFolder.addEventListener('click', () => {
    if (!popupInlineAdd) return;
    if (popupInlineAdd.style.display === 'none' || !popupInlineAdd.style.display) {
      showInlineAddFolder();
    } else {
      hideInlineAddFolder();
    }
  });

  if (btnSubmitNewFolder) {
    btnSubmitNewFolder.addEventListener('click', handleCreateFolder);
  }

  if (btnCancelNewFolder) {
    btnCancelNewFolder.addEventListener('click', hideInlineAddFolder);
  }

  if (inputNewFolderName) {
    inputNewFolderName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateFolder();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideInlineAddFolder();
      }
    });
  }

  await refreshData();
});
