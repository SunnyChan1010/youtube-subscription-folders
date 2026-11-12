/**
 * YouTube Subscription Folders - Content Script
 * Injected into YouTube to provide:
 * 1. Left Sidebar Folder List with expandable channels
 * 2. Subscriptions Feed Top Filter Chip Bar with "Hide Watched" & Empty State
 * 3. Channel Page & Video Watch Page Quick "Add to Folder" Button
 * 4. Subscriptions List (/feed/channels) One-Click Sync
 */

(() => {
  let cachedFolders = [];
  let cachedChannels = {};
  let cachedChannelByToken = new Map();
  let cachedChannelByName = new Map();
  let cachedFolderIdsByToken = new Map();
  let cachedFolderOrderMap = new Map();
  let cachedSettings = {
    hideWatched: false,
    hideShorts: false,
    onlyLive: false,
    activeFeedFolderId: 'all',
    selectedFeedFolderIds: [],
    mutedFeedFolderIds: [],
    feedDurationFilter: 'all'
  };
  let activeFilterFolderId = 'all';
  let selectedFilterFolderIds = new Set();
  let mutedFilterFolderIds = new Set();
  let feedSearchQuery = '';
  let feedDurationFilter = 'all';
  let feedSearchDebounceTimer = null;
  let feedObserver = null;
  let isApplyingFilter = false;

  // Global floating dropdown element attached to document.body
  let globalFloatingDropdown = null;
  let currentDropdownChannelInfo = null;
  let currentDropdownTriggerBtn = null;

  // Phase 3.1: Centralized DOM Selector Registry with fallback priority chains
  const YT_DOM_SELECTORS = {
    subscribeButtons: [
      'yt-subscribe-button-view-model button',
      'subscribe-button-view-model button',
      '#owner #subscribe-button button',
      'ytd-subscribe-button-renderer button',
      '#subscribe-button button'
    ],
    feedRoot: [
      'ytd-browse[page-subtype="subscriptions"]',
      'ytd-browse:not([hidden])'
    ],
    videoCards: [
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer'
    ],
    shelfSections: [
      'ytd-rich-section-renderer',
      'ytd-reel-shelf-renderer'
    ],
    authorLinks: [
      'ytd-channel-name a',
      '#channel-name a',
      'a#avatar-link',
      '#avatar-container a',
      'yt-content-metadata-view-model a[href*="/@"]',
      'yt-content-metadata-view-model a[href*="/channel/"]',
      'yt-decorated-avatar-view-model a'
    ],
    sidebarGuide: [
      'ytd-guide-renderer #sections',
      '#guide-inner-content #sections',
      'tp-yt-app-drawer #sections',
      '#sections.ytd-guide-renderer'
    ]
  };

  const DEFAULT_AVATAR = (typeof YT_DEFAULT_AVATAR !== 'undefined' ? YT_DEFAULT_AVATAR : "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiMyODI4MjgiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjgiIHI9IjMuNiIgZmlsbD0iI2FhYWFhYSIvPjxwYXRoIGQ9Ik0xMiAxMy41Yy0zIDAtNi41IDEuNS02LjUgMy41djEuNWgxM3YtMS41YzAtMi0zLjUtMy41LTYuNS0zLjV6IiBmaWxsPSIjYWFhYWFhIi8+PC9zdmc+");

  // Only handle image fallback for our extension's elements with data-default-src to avoid hijacking YouTube thumbnails
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.dataset && e.target.dataset.defaultSrc) {
      const defaultSrc = e.target.dataset.defaultSrc;
      if (e.target.src !== defaultSrc) {
        e.target.src = defaultSrc;
      }
    }
  }, true);

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

  function getFolderDisplay(folder) {
    if (!folder) return { icon: '📁', name: '' };
    if (typeof YTFolderStorage !== 'undefined' && typeof YTFolderStorage.normalizeFolderIconAndName === 'function') {
      return YTFolderStorage.normalizeFolderIconAndName(folder.name, folder.icon);
    }
    if (typeof YTFolderUtils !== 'undefined' && typeof YTFolderUtils.normalizeFolderIconAndName === 'function') {
      return YTFolderUtils.normalizeFolderIconAndName(folder.name, folder.icon);
    }
    const icon = folder.icon || '📁';
    let name = String(folder.name || '').trim();
    if (icon && name.startsWith(icon)) {
      const stripped = name.slice(icon.length).trim();
      if (stripped) name = stripped;
    }
    return { icon, name };
  }

  let hasHarvestedSidebarThisSession = false;

  async function harvestSidebarSubscriptions() {
    if (hasHarvestedSidebarThisSession) return;
    const entries = document.querySelectorAll('ytd-guide-section-renderer ytd-guide-entry-renderer');
    if (!entries || entries.length === 0) return;

    const discovered = [];
    entries.forEach(el => {
      const a = el.querySelector('a#endpoint');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/@') && !href.startsWith('/channel/')) return;

      const img = el.querySelector('yt-img-shadow img, img')?.src || '';
      // Only harvest real channel entries that have a YouTube channel avatar (skipping system items like "你的頻道" or "音樂")
      if (!img || (!img.includes('yt3.ggpht.com') && !img.includes('yt3.googleusercontent.com'))) return;

      let id = '';
      let handle = '';
      const hMatch = href.match(/\/@([^\/\?]+)/);
      if (hMatch) handle = `@${hMatch[1]}`;
      const idMatch = href.match(/\/channel\/([^\/\?]+)/);
      if (idMatch) id = idMatch[1];

      const title = el.querySelector('yt-formatted-string.title')?.textContent?.trim() || a.getAttribute('title') || '';
      const finalName = title || handle || id;
      if (!id && !handle) return;
      if (typeof isSystemActionTitle === 'function' && (isSystemActionTitle(finalName) || isSystemActionTitle(handle) || isSystemActionTitle(id))) {
        return;
      }

      discovered.push({
        id: id || handle,
        name: finalName,
        handle,
        avatarUrl: img,
        isSubscribed: true
      });
    });

    if (discovered.length > 0 && typeof YTFolderStorage !== 'undefined' && typeof YTFolderStorage.enrichChannelsMetadata === 'function') {
      hasHarvestedSidebarThisSession = true;
      try {
        const res = await YTFolderStorage.enrichChannelsMetadata(discovered);
        if (res && res.updatedCount > 0) {
          cachedChannels = await YTFolderStorage.getChannels();
          rebuildInMemoryIndices();
        }
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // In-Memory O(1) Reverse Indices & Data Loading
  // ---------------------------------------------------------------------------
  function setChannelIndexToken(map, token, ch) {
    if (!token) return;
    const prev = map.get(token);
    if (!prev) {
      map.set(token, ch);
    } else if (
      !(prev.id && String(prev.id).startsWith('UC')) &&
      ch.id && String(ch.id).startsWith('UC')
    ) {
      map.set(token, ch);
    }
  }

  function rebuildInMemoryIndices() {
    const nextChannelByToken = new Map();
    const nextChannelByName = new Map();
    const nextFolderIdsByToken = new Map();
    const nextFolderOrderMap = new Map();

    for (const [k, ch] of Object.entries(cachedChannels || {})) {
      if (!ch || typeof ch !== 'object') continue;
      const kLower = String(k).toLowerCase().trim();
      if (kLower) {
        setChannelIndexToken(nextChannelByToken, kLower, ch);
        if (kLower.startsWith('@')) {
          setChannelIndexToken(nextChannelByToken, kLower.slice(1), ch);
        }
      }
      if (ch.id) {
        const idLower = String(ch.id).toLowerCase().trim();
        if (idLower) {
          setChannelIndexToken(nextChannelByToken, idLower, ch);
          if (idLower.startsWith('@')) {
            setChannelIndexToken(nextChannelByToken, idLower.slice(1), ch);
          }
        }
      }
      if (ch.handle) {
        const hLower = String(ch.handle).toLowerCase().trim();
        const hBare = hLower.replace(/^@/, '');
        if (hLower) setChannelIndexToken(nextChannelByToken, hLower, ch);
        if (hBare) {
          setChannelIndexToken(nextChannelByToken, hBare, ch);
          setChannelIndexToken(nextChannelByToken, '@' + hBare, ch);
        }
      }
      if (ch.name) {
        const nameLower = String(ch.name).trim().toLowerCase();
        if (nameLower && !nextChannelByName.has(nameLower)) {
          nextChannelByName.set(nameLower, ch);
        }
      }
    }

    if (Array.isArray(cachedFolders)) {
      cachedFolders.forEach((folder, folderIdx) => {
        if (!folder || !folder.id) return;
        nextFolderOrderMap.set(folder.id, folderIdx);
        if (!Array.isArray(folder.channels)) return;

        const folderTokens = new Set();
        for (const rawId of folder.channels) {
          if (rawId === null || rawId === undefined) continue;
          const rawLower = String(rawId).toLowerCase().trim();
          if (!rawLower) continue;
          const rawBare = rawLower.replace(/^@/, '');
          folderTokens.add(rawLower);
          if (rawBare) {
            folderTokens.add(rawBare);
          }

          const ch = (cachedChannels && cachedChannels[rawId]) ||
                     nextChannelByToken.get(rawLower) ||
                     (rawBare ? nextChannelByToken.get(rawBare) : null);
          if (ch) {
            if (ch.id) {
              const chIdLower = String(ch.id).toLowerCase().trim();
              const chIdBare = chIdLower.replace(/^@/, '');
              if (chIdLower) folderTokens.add(chIdLower);
              if (chIdBare) folderTokens.add(chIdBare);
            }
            if (ch.handle) {
              const chHLower = String(ch.handle).toLowerCase().trim();
              const chHBare = chHLower.replace(/^@/, '');
              if (chHLower) folderTokens.add(chHLower);
              if (chHBare) {
                folderTokens.add(chHBare);
                folderTokens.add('@' + chHBare);
              }
            }
          }
        }

        for (const token of folderTokens) {
          let list = nextFolderIdsByToken.get(token);
          if (!list) {
            list = [];
            nextFolderIdsByToken.set(token, list);
          }
          if (list[list.length - 1] !== folder.id && !list.includes(folder.id)) {
            list.push(folder.id);
          }
        }
      });
    }

    cachedChannelByToken = nextChannelByToken;
    cachedChannelByName = nextChannelByName;
    cachedFolderIdsByToken = nextFolderIdsByToken;
    cachedFolderOrderMap = nextFolderOrderMap;
  }

  async function loadData() {
    if (typeof YTFolderStorage.getAllData === 'function') {
      const allData = await YTFolderStorage.getAllData();
      cachedFolders = Array.isArray(allData.folders) ? allData.folders : [];
      cachedChannels = allData.channels || {};
      cachedSettings = allData.settings || {};
    } else {
      await YTFolderStorage.init();
      cachedFolders = await YTFolderStorage.getFolders();
      cachedChannels = await YTFolderStorage.getChannels();
      cachedSettings = await YTFolderStorage.getSettings();
    }
    rebuildInMemoryIndices();
    activeFilterFolderId = cachedSettings.activeFeedFolderId || 'all';
    selectedFilterFolderIds = new Set(
      Array.isArray(cachedSettings.selectedFeedFolderIds)
        ? cachedSettings.selectedFeedFolderIds.filter(id => id === 'uncategorized' || cachedFolderOrderMap.has(id))
        : []
    );
    mutedFilterFolderIds = new Set(
      Array.isArray(cachedSettings.mutedFeedFolderIds)
        ? cachedSettings.mutedFeedFolderIds.filter(id => cachedFolderOrderMap.has(id))
        : []
    );
    feedDurationFilter = ['all', 'short', 'medium', 'long'].includes(cachedSettings.feedDurationFilter)
      ? cachedSettings.feedDurationFilter
      : 'all';
    if (activeFilterFolderId === 'multi' && selectedFilterFolderIds.size === 0) {
      activeFilterFolderId = 'all';
    }
  }

  function persistFeedFilterFolderState() {
    cachedSettings.selectedFeedFolderIds = Array.from(selectedFilterFolderIds);
    cachedSettings.mutedFeedFolderIds = Array.from(mutedFilterFolderIds);
    cachedSettings.activeFeedFolderId = activeFilterFolderId;
    YTFolderStorage.updateSettings({
      activeFeedFolderId: activeFilterFolderId,
      selectedFeedFolderIds: cachedSettings.selectedFeedFolderIds,
      mutedFeedFolderIds: cachedSettings.mutedFeedFolderIds
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    let toast = document.getElementById('yt-org-global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yt-org-global-toast';
      toast.className = 'yt-org-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // 1. Sidebar Injection
  // ---------------------------------------------------------------------------
  function injectSidebarSection() {
    if (cachedSettings && cachedSettings.showInSidebar === false) {
      const existing = document.getElementById('yt-org-sidebar-section');
      if (existing) existing.remove();
      return;
    }

    const guideSections = document.querySelector('#guide-inner-content #sections') ||
                          document.querySelector('ytd-guide-renderer #sections');
    if (!guideSections) return;

    let existingSection = document.getElementById('yt-org-sidebar-section');
    if (!existingSection) {
      existingSection = document.createElement('div');
      existingSection.id = 'yt-org-sidebar-section';

      const allSections = guideSections.querySelectorAll('ytd-guide-section-renderer');
      if (allSections.length > 1) {
        guideSections.insertBefore(existingSection, allSections[1]);
      } else {
        guideSections.appendChild(existingSection);
      }
    }

    renderSidebarContent(existingSection);
    harvestSidebarSubscriptions();
  }

  let suppressNextStorageSidebarRebuild = false;

  function renderSidebarContent(container) {
    const existingSearchInput = container.querySelector('#yt-org-sidebar-search-input');
    const prevSearchQuery = existingSearchInput ? existingSearchInput.value : '';
    const existingList = container.querySelector('.yt-org-folder-list');
    const prevListScrollTop = existingList ? existingList.scrollTop : 0;
    const prevContainerScrollTop = container.scrollTop || 0;

    let html = `
      <div class="yt-org-sidebar-header" title="點擊展開/收合分組">
        <div class="yt-org-header-title">
          <span>📁 分組訂閱</span>
          <span class="yt-org-folder-badge">${cachedFolders.length} 組</span>
        </div>
        <div class="yt-org-header-actions">
          <button class="yt-org-btn-icon" id="yt-org-btn-new-folder" title="新增分組">➕</button>
          <button class="yt-org-btn-icon" id="yt-org-btn-open-options" title="開啟管理設定">⚙️</button>
        </div>
      </div>
      <div class="yt-org-sidebar-new-folder-box" id="yt-org-sidebar-new-folder-box" style="display: none; padding: 6px 12px; gap: 6px; align-items: center;">
        <input type="text" class="yt-org-sidebar-search-input" id="yt-org-sidebar-new-folder-input" placeholder="新分組名稱 (例如: 🎮 遊戲)..." maxlength="50" style="flex: 1;" />
        <button class="yt-org-btn-icon" id="yt-org-sidebar-new-folder-submit" title="建立">✔️</button>
      </div>
      <div class="yt-org-sidebar-search-container">
        <input type="text" class="yt-org-sidebar-search-input" id="yt-org-sidebar-search-input" placeholder="🔍 搜尋分組或頻道..." value="${escapeHtml(prevSearchQuery)}" />
      </div>
    `;

    const totalCategorizedChannels = cachedFolders.reduce((sum, f) => sum + (f.channels ? f.channels.length : 0), 0);
    const showOnboardingCard = totalCategorizedChannels === 0 && (!cachedSettings || !cachedSettings.dismissedOnboarding);
    if (showOnboardingCard) {
      html += `
        <div class="yt-org-onboarding-card" id="yt-org-onboarding-card">
          <div class="yt-org-onboarding-header">
            <span>🚀 新手快速開始</span>
            <button class="yt-org-onboarding-dismiss" id="yt-org-onboarding-dismiss" title="關閉提示">✕</button>
          </div>
          <div class="yt-org-onboarding-desc">
            目前分組尚無頻道。可前往管理後台一鍵同步訂閱或匯入備份，或在頻道／影片頁點擊「➕ 分類」。
          </div>
          <button class="yt-org-onboarding-cta" id="yt-org-onboarding-open-options">🔄 同步並整理訂閱頻道</button>
        </div>
      `;
    }

    html += `
      <ul class="yt-org-folder-list">
    `;

    cachedFolders.forEach(folder => {
      const channelCount = folder.channels ? folder.channels.length : 0;
      const isFilterActive = window.location.pathname.startsWith('/feed/subscriptions') && (
        selectedFilterFolderIds.has(folder.id) ||
        (selectedFilterFolderIds.size === 0 && activeFilterFolderId === folder.id)
      );
      const isExpanded = Boolean(cachedSettings.expandedFolders && cachedSettings.expandedFolders[folder.id]);
      const display = getFolderDisplay(folder);
      const safeDesc = escapeHtml(folder.description || display.name);
      const safeFolderName = escapeHtml(display.name);

      html += `
        <li class="yt-org-folder-item" data-folder-id="${escapeHtml(folder.id)}">
          <div class="yt-org-folder-row ${isFilterActive ? 'yt-org-active' : ''}" title="${safeDesc}（雙擊開啟訂閱內容並過濾此分組）">
            <span class="yt-org-folder-icon">${escapeHtml(display.icon)}</span>
            <span class="yt-org-folder-name">${safeFolderName}</span>
            <span class="yt-org-folder-badge">${channelCount}</span>
            <span class="yt-org-folder-chevron ${isExpanded ? 'expanded' : ''}">▶</span>
          </div>
          <ul class="yt-org-channels-sublist ${isExpanded ? 'expanded' : ''}" id="yt-org-sublist-${escapeHtml(folder.id)}">
      `;

      if (folder.channels && folder.channels.length > 0) {
        folder.channels.forEach(chId => {
          const ch = cachedChannels[chId] ||
                     cachedChannelByToken.get(String(chId).toLowerCase()) ||
                     { id: chId, name: chId, handle: '', avatarUrl: '' };
          const link = ch.handle ? `/${ch.handle}` : (ch.id ? `/channel/${ch.id}` : '#');
          const defaultAvatar = DEFAULT_AVATAR;
          const safeAvatar = sanitizeAvatarUrl(ch.avatarUrl) || defaultAvatar;
          const safeChTitle = escapeHtml(ch.name || ch.handle || '頻道');
          const safeChTooltip = escapeHtml(ch.name || ch.handle || '');
          html += `
            <li>
              <a href="${sanitizeUrl(link)}" class="yt-org-channel-item" title="${safeChTooltip}">
                <img class="yt-org-channel-avatar" src="${escapeHtml(safeAvatar)}" data-default-src="${escapeHtml(defaultAvatar)}" alt="" />
                <span class="yt-org-channel-title">${safeChTitle}</span>
              </a>
            </li>
          `;
        });
      } else {
        html += `
          <li class="yt-org-empty-folder-hint" title="點擊開啟管理後台指派頻道或匯入備份" style="padding: 6px 12px 6px 36px; font-size: 12px; opacity: 0.65; cursor: pointer;">(尚無頻道 · 點此管理)</li>
        `;
      }

      html += `
          </ul>
        </li>
      `;
    });

    html += `</ul>`;
    container.innerHTML = html;

    const newList = container.querySelector('.yt-org-folder-list');
    if (newList && prevListScrollTop > 0) {
      newList.scrollTop = prevListScrollTop;
    }
    if (prevContainerScrollTop > 0) {
      container.scrollTop = prevContainerScrollTop;
    }

    container.querySelectorAll('.yt-org-empty-folder-hint').forEach(hintEl => {
      hintEl.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      };
    });

    const onboardingOpenBtn = container.querySelector('#yt-org-onboarding-open-options');
    if (onboardingOpenBtn) {
      onboardingOpenBtn.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      };
    }

    const onboardingDismissBtn = container.querySelector('#yt-org-onboarding-dismiss');
    if (onboardingDismissBtn) {
      onboardingDismissBtn.onclick = async (e) => {
        e.stopPropagation();
        const card = container.querySelector('#yt-org-onboarding-card');
        if (card) card.style.display = 'none';
        cachedSettings.dismissedOnboarding = true;
        await YTFolderStorage.updateSettings({ dismissedOnboarding: true });
      };
    }

    const searchInput = container.querySelector('#yt-org-sidebar-search-input');
    if (searchInput) {
      searchInput.onkeydown = (e) => e.stopPropagation();
      searchInput.oninput = (e) => {
        const query = (e.target.value || '').trim().toLowerCase();
        const folderItems = container.querySelectorAll('.yt-org-folder-item');
        folderItems.forEach(item => {
          const folderId = item.dataset.folderId;
          const folder = cachedFolders.find(f => f.id === folderId);
          if (!folder) return;

          const folderNameMatch = (folder.name || '').toLowerCase().includes(query) ||
                                  (folder.icon || '').toLowerCase().includes(query) ||
                                  (folder.description || '').toLowerCase().includes(query);

          const sublist = item.querySelector('.yt-org-channels-sublist');
          const chevron = item.querySelector('.yt-org-folder-chevron');
          const channelLis = sublist ? sublist.querySelectorAll('li') : [];
          let hasMatchingChannel = false;

          channelLis.forEach(li => {
            const chTitle = li.querySelector('.yt-org-channel-title')?.textContent?.toLowerCase() || '';
            const isMatch = chTitle.includes(query);
            if (isMatch) {
              hasMatchingChannel = true;
              li.style.display = '';
            } else {
              li.style.display = query ? 'none' : '';
            }
          });

          if (!query) {
            item.style.display = '';
            channelLis.forEach(li => li.style.display = '');
            const wasExpanded = Boolean(cachedSettings.expandedFolders && cachedSettings.expandedFolders[folder.id]);
            if (sublist && !sublist.classList.contains('user-expanded') && !wasExpanded) {
              sublist.classList.remove('expanded');
              chevron?.classList.remove('expanded');
            }
          } else if (folderNameMatch || hasMatchingChannel) {
            item.style.display = '';
            if (hasMatchingChannel && sublist) {
              sublist.classList.add('expanded');
              chevron?.classList.add('expanded');
            }
          } else {
            item.style.display = 'none';
          }
        });
      };

      if (prevSearchQuery) {
        searchInput.dispatchEvent(new Event('input'));
      }
    }

    const newFolderBtn = container.querySelector('#yt-org-btn-new-folder');
    const newFolderBox = container.querySelector('#yt-org-sidebar-new-folder-box');
    const newFolderInput = container.querySelector('#yt-org-sidebar-new-folder-input');
    const newFolderSubmit = container.querySelector('#yt-org-sidebar-new-folder-submit');

    async function submitInlineNewFolder() {
      const name = (newFolderInput?.value || '').trim();
      if (!name) return;
      try {
        await YTFolderStorage.addFolder({ name });
        if (newFolderInput) newFolderInput.value = '';
        if (newFolderBox) newFolderBox.style.display = 'none';
        showToast(`已建立分組「${name}」`);
      } catch (err) {
        showToast(err.message || '建立分組失敗');
      }
    }

    if (newFolderBtn && newFolderBox && newFolderInput) {
      newFolderBtn.onclick = (e) => {
        e.stopPropagation();
        const isHidden = newFolderBox.style.display === 'none';
        newFolderBox.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
          newFolderInput.focus();
        }
      };
      newFolderInput.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          submitInlineNewFolder();
        } else if (e.key === 'Escape') {
          newFolderBox.style.display = 'none';
        }
      };
      if (newFolderSubmit) {
        newFolderSubmit.onclick = (e) => {
          e.stopPropagation();
          submitInlineNewFolder();
        };
      }
    }

    const optionsBtn = container.querySelector('#yt-org-btn-open-options');
    if (optionsBtn) {
      optionsBtn.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      };
    }

    container.querySelectorAll('.yt-org-folder-row').forEach(row => {
      const folderItem = row.closest('.yt-org-folder-item');
      const folderId = folderItem?.dataset.folderId;
      const sublist = folderItem?.querySelector('.yt-org-channels-sublist');
      const chevron = row.querySelector('.yt-org-folder-chevron');
      let singleClickTimer = null;

      async function toggleExpandState() {
        if (sublist && chevron) {
          const isExp = sublist.classList.toggle('expanded');
          chevron.classList.toggle('expanded', isExp);
          sublist.classList.toggle('user-expanded', isExp);
          if (!cachedSettings.expandedFolders) cachedSettings.expandedFolders = {};
          cachedSettings.expandedFolders[folderId] = isExp;
          suppressNextStorageSidebarRebuild = true;
          await YTFolderStorage.updateSettings({ expandedFolders: cachedSettings.expandedFolders });
        }
      }

      row.onclick = (e) => {
        if (e.target.closest('.yt-org-folder-chevron')) {
          e.stopPropagation();
          if (singleClickTimer) {
            clearTimeout(singleClickTimer);
            singleClickTimer = null;
          }
          toggleExpandState();
          return;
        }
        if (singleClickTimer) clearTimeout(singleClickTimer);
        singleClickTimer = setTimeout(() => {
          singleClickTimer = null;
          toggleExpandState();
        }, 180);
      };

      row.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (singleClickTimer) {
          clearTimeout(singleClickTimer);
          singleClickTimer = null;
        }
        selectedFilterFolderIds.clear();
        selectedFilterFolderIds.add(folderId);
        mutedFilterFolderIds.delete(folderId);
        activeFilterFolderId = folderId;
        suppressNextStorageSidebarRebuild = true;
        persistFeedFilterFolderState();
        if (!window.location.pathname.startsWith('/feed/subscriptions')) {
          window.location.href = `/feed/subscriptions`;
        } else {
          container.querySelectorAll('.yt-org-folder-row').forEach(r => r.classList.remove('yt-org-active'));
          row.classList.add('yt-org-active');
          updateFeedFilterChipsUI();
          applyFeedFilters();
        }
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Subscriptions Feed Filtering (/feed/subscriptions)
  // ---------------------------------------------------------------------------
  function checkAndInjectFeedFilter() {
    if (cachedSettings && cachedSettings.showFeedFilter === false) {
      const existingBar = document.getElementById('yt-org-feed-filter-bar');
      if (existingBar) existingBar.remove();
      const existingContainer = document.getElementById('yt-org-feed-filter-container');
      if (existingContainer) existingContainer.remove();
      const emptyState = document.getElementById('yt-org-feed-empty-state');
      if (emptyState) emptyState.remove();
      return;
    }

    const isFeedPage = window.location.pathname.startsWith('/feed/subscriptions');
    if (!isFeedPage) {
      const existing = document.getElementById('yt-org-feed-filter-container');
      if (existing) existing.remove();
      const emptyState = document.getElementById('yt-org-feed-empty-state');
      if (emptyState) emptyState.remove();
      if (feedObserver) {
        feedObserver.disconnect();
        feedObserver = null;
      }
      return;
    }

    const feedGrid = document.querySelector('ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer') ||
                     document.querySelector('ytd-browse ytd-rich-grid-renderer') ||
                     document.querySelector('ytd-browse[page-subtype="subscriptions"] ytd-two-column-browse-results-renderer #primary') ||
                     document.querySelector('ytd-browse[page-subtype="subscriptions"] ytd-section-list-renderer') ||
                     document.querySelector('ytd-browse[page-subtype="subscriptions"]') ||
                     document.querySelector('ytd-rich-grid-renderer');
    if (!feedGrid) return;

    let filterContainer = document.getElementById('yt-org-feed-filter-container');
    if (!filterContainer) {
      filterContainer = document.createElement('div');
      filterContainer.id = 'yt-org-feed-filter-container';

      const contents = feedGrid.querySelector('#contents') || feedGrid.querySelector('#primary') || feedGrid.firstElementChild;
      if (contents) {
        contents.parentNode.insertBefore(filterContainer, contents);
      } else {
        feedGrid.prepend(filterContainer);
      }
    }

    renderFeedFilterBar(filterContainer);
    setupFeedObserver(feedGrid);
    applyFeedFilters();
  }

  function renderFeedFilterBar(container) {
    const prevSearchEl = document.getElementById('yt-org-feed-search-input');
    const wasSearchFocused = Boolean(prevSearchEl && document.activeElement === prevSearchEl);
    const prevSelectionStart = wasSearchFocused ? prevSearchEl.selectionStart : null;
    const prevSelectionEnd = wasSearchFocused ? prevSearchEl.selectionEnd : null;

    const isAllActive = selectedFilterFolderIds.size === 0 && activeFilterFolderId === 'all';
    let chipsHtml = `
      <div class="yt-org-feed-filter-wrapper" id="yt-org-feed-filter-bar">
        <div class="yt-org-chips-scroll">
          <button class="yt-org-chip ${isAllActive ? 'active' : ''}" data-folder-id="all" title="點擊檢視全部動態">
            <span>全部動態</span>
          </button>
    `;

    cachedFolders.forEach(folder => {
      const count = folder.channels ? folder.channels.length : 0;
      const isActive = selectedFilterFolderIds.has(folder.id) || (selectedFilterFolderIds.size === 0 && activeFilterFolderId === folder.id);
      const isMuted = mutedFilterFolderIds.has(folder.id);
      const display = getFolderDisplay(folder);
      chipsHtml += `
        <button class="yt-org-chip ${isActive ? 'active' : ''} ${isMuted ? 'muted' : ''}" data-folder-id="${escapeHtml(folder.id)}" title="點擊過濾；Shift/Ctrl+點擊多選聯集；Alt/右鍵點擊切換屏蔽模式">
          <span>${escapeHtml(display.icon)}</span>
          <span>${escapeHtml(display.name)}</span>
          <span class="yt-org-chip-badge">(${count})</span>
        </button>
      `;
    });

    chipsHtml += `
        </div>
        <div class="yt-org-filter-actions">
          <button class="yt-org-toggle-watched-btn ${cachedSettings.hideWatched ? 'active' : ''}" id="yt-org-btn-hide-watched" title="在動態牆隱藏已看過的影片">
            <span>${cachedSettings.hideWatched ? '👁️‍🗨️ 已隱藏已看' : '👁️ 隱藏已看'}</span>
          </button>
          <button class="yt-org-toggle-watched-btn ${cachedSettings.hideShorts ? 'active' : ''}" id="yt-org-btn-hide-shorts" title="在動態牆隱藏 Shorts 短片">
            <span>${cachedSettings.hideShorts ? '🚫 已隱藏 Shorts' : '🚫 隱藏 Shorts'}</span>
          </button>
          <button class="yt-org-toggle-watched-btn ${cachedSettings.onlyLive ? 'active' : ''}" id="yt-org-btn-only-live" title="在動態牆僅顯示直播中的頻道與節目">
            <span>${cachedSettings.onlyLive ? '🔴 僅顯示直播' : '📡 僅看直播'}</span>
          </button>
        </div>
      </div>
    `;

    container.innerHTML = chipsHtml;

    // [F1] Construct in-feed search input & video duration filter via safe DOM APIs
    const filterActionsEl = container.querySelector('.yt-org-filter-actions');
    if (filterActionsEl) {
      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.id = 'yt-org-feed-search-input';
      searchInput.className = 'yt-org-feed-search-input';
      searchInput.placeholder = '🔍 篩選動態標題/頻道...';
      searchInput.setAttribute('aria-label', '篩選動態標題或頻道');
      searchInput.value = feedSearchQuery;

      const stopKeyPropagation = (e) => {
        e.stopPropagation();
      };
      searchInput.addEventListener('keydown', stopKeyPropagation);
      searchInput.addEventListener('keyup', stopKeyPropagation);
      searchInput.addEventListener('keypress', stopKeyPropagation);

      searchInput.addEventListener('input', () => {
        if (feedSearchDebounceTimer) clearTimeout(feedSearchDebounceTimer);
        feedSearchDebounceTimer = setTimeout(() => {
          feedSearchDebounceTimer = null;
          feedSearchQuery = searchInput.value.trim().toLowerCase();
          applyFeedFilters();
          pumpAttempts = 0;
          lastPumpedFolderId = null;
          pumpFeedIfNeeded();
        }, 120);
      });

      const durationSelect = document.createElement('select');
      durationSelect.id = 'yt-org-feed-duration-select';
      durationSelect.className = 'yt-org-feed-duration-select';
      durationSelect.setAttribute('aria-label', '依影片長度篩選');

      const durationOptions = [
        { value: 'all', label: '⏱️ 全部片長' },
        { value: 'short', label: '⚡ < 5 分鐘' },
        { value: 'medium', label: '🎬 5-20 分鐘' },
        { value: 'long', label: '🍿 > 20 分鐘' }
      ];
      durationOptions.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.value;
        opt.textContent = optData.label;
        durationSelect.appendChild(opt);
      });
      durationSelect.value = feedDurationFilter;
      durationSelect.addEventListener('change', () => {
        feedDurationFilter = durationSelect.value;
        cachedSettings.feedDurationFilter = feedDurationFilter;
        YTFolderStorage.updateSettings({ feedDurationFilter });
        applyFeedFilters();
        pumpAttempts = 0;
        lastPumpedFolderId = null;
        pumpFeedIfNeeded();
      });

      filterActionsEl.insertBefore(durationSelect, filterActionsEl.firstChild);
      filterActionsEl.insertBefore(searchInput, durationSelect);

      if (wasSearchFocused) {
        searchInput.focus();
        try {
          if (typeof prevSelectionStart === 'number' && typeof prevSelectionEnd === 'number') {
            searchInput.setSelectionRange(prevSelectionStart, prevSelectionEnd);
          }
        } catch (e) {}
      }
    }

    function toggleFolderMute(folderId) {
      if (!folderId || folderId === 'all') return;
      const display = getFolderDisplay(cachedFolders.find(f => f.id === folderId));
      const folderName = display ? display.name : folderId;
      if (mutedFilterFolderIds.has(folderId)) {
        mutedFilterFolderIds.delete(folderId);
        showToast(`已取消屏蔽「${folderName}」分組`);
      } else {
        mutedFilterFolderIds.add(folderId);
        selectedFilterFolderIds.delete(folderId);
        if (activeFilterFolderId === folderId) {
          activeFilterFolderId = selectedFilterFolderIds.size > 0
            ? (selectedFilterFolderIds.size === 1 ? Array.from(selectedFilterFolderIds)[0] : 'multi')
            : 'all';
        }
        showToast(`🚫 已屏蔽「${folderName}」分組的影片`);
      }
      persistFeedFilterFolderState();
      updateFeedFilterChipsUI();
      applyFeedFilters();
    }

    container.querySelectorAll('.yt-org-chip').forEach(btn => {
      btn.onclick = (e) => {
        const folderId = btn.dataset.folderId;
        if (e.altKey && folderId !== 'all') {
          e.preventDefault();
          toggleFolderMute(folderId);
          return;
        }
        if (folderId === 'all') {
          selectedFilterFolderIds.clear();
          activeFilterFolderId = 'all';
        } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Phase 4.2 Multi-folder union toggle
          if (selectedFilterFolderIds.size === 0 && activeFilterFolderId !== 'all' && activeFilterFolderId !== 'multi') {
            selectedFilterFolderIds.add(activeFilterFolderId);
          }
          if (selectedFilterFolderIds.has(folderId)) {
            selectedFilterFolderIds.delete(folderId);
          } else {
            selectedFilterFolderIds.add(folderId);
            mutedFilterFolderIds.delete(folderId);
          }
          if (selectedFilterFolderIds.size === 0) {
            activeFilterFolderId = 'all';
          } else if (selectedFilterFolderIds.size === 1) {
            activeFilterFolderId = Array.from(selectedFilterFolderIds)[0];
          } else {
            activeFilterFolderId = 'multi';
          }
        } else {
          // Single select
          selectedFilterFolderIds.clear();
          selectedFilterFolderIds.add(folderId);
          activeFilterFolderId = folderId;
          mutedFilterFolderIds.delete(folderId);
        }
        persistFeedFilterFolderState();
        updateFeedFilterChipsUI();
        applyFeedFilters();
      };

      // Phase 4.2 Focus Mute Mode (Right-click contextmenu)
      btn.oncontextmenu = (e) => {
        const folderId = btn.dataset.folderId;
        if (folderId === 'all') return;
        e.preventDefault();
        toggleFolderMute(folderId);
      };
    });

    const hideWatchedBtn = container.querySelector('#yt-org-btn-hide-watched');
    if (hideWatchedBtn) {
      hideWatchedBtn.onclick = async () => {
        const newVal = !cachedSettings.hideWatched;
        cachedSettings.hideWatched = newVal;
        await YTFolderStorage.updateSettings({ hideWatched: newVal });
        hideWatchedBtn.classList.toggle('active', newVal);
        hideWatchedBtn.innerHTML = `<span>${newVal ? '👁️‍🗨️ 已隱藏已看' : '👁️ 隱藏已看'}</span>`;
        applyFeedFilters();
        showToast(newVal ? '已開啟：自動隱藏已觀看影片' : '已關閉：顯示所有影片');
      };
    }

    const hideShortsBtn = container.querySelector('#yt-org-btn-hide-shorts');
    if (hideShortsBtn) {
      hideShortsBtn.onclick = async () => {
        const newVal = !cachedSettings.hideShorts;
        cachedSettings.hideShorts = newVal;
        await YTFolderStorage.updateSettings({ hideShorts: newVal });
        hideShortsBtn.classList.toggle('active', newVal);
        hideShortsBtn.innerHTML = `<span>${newVal ? '🚫 已隱藏 Shorts' : '🚫 隱藏 Shorts'}</span>`;
        applyFeedFilters();
        showToast(newVal ? '已開啟：自動隱藏 Shorts 短片' : '已關閉：顯示 Shorts 短片');
      };
    }

    const onlyLiveBtn = container.querySelector('#yt-org-btn-only-live');
    if (onlyLiveBtn) {
      onlyLiveBtn.onclick = async () => {
        const newVal = !cachedSettings.onlyLive;
        cachedSettings.onlyLive = newVal;
        await YTFolderStorage.updateSettings({ onlyLive: newVal });
        onlyLiveBtn.classList.toggle('active', newVal);
        onlyLiveBtn.innerHTML = `<span>${newVal ? '🔴 僅顯示直播' : '📡 僅看直播'}</span>`;
        applyFeedFilters();
        showToast(newVal ? '已開啟：僅顯示直播中節目' : '已關閉：顯示所有影片');
      };
    }
  }

  function updateFeedFilterChipsUI() {
    const container = document.getElementById('yt-org-feed-filter-container');
    if (!container) return;
    const isAllActive = selectedFilterFolderIds.size === 0 && activeFilterFolderId === 'all';
    container.querySelectorAll('.yt-org-chip').forEach(btn => {
      const fid = btn.dataset.folderId;
      if (fid === 'all') {
        btn.classList.toggle('active', isAllActive);
      } else {
        const isAct = selectedFilterFolderIds.has(fid) || (selectedFilterFolderIds.size === 0 && activeFilterFolderId === fid);
        const isMut = mutedFilterFolderIds.has(fid);
        btn.classList.toggle('active', isAct && !isMut);
        btn.classList.toggle('muted', isMut);
      }
    });
  }

  let feedMutationDebounceTimer = null;
  function setupFeedObserver(gridContainer) {
    if (feedObserver) {
      feedObserver.disconnect();
    }
    const contentsEl = gridContainer.querySelector('#contents') || gridContainer.querySelector('#primary') || gridContainer;
    feedObserver = new MutationObserver(() => {
      if (feedMutationDebounceTimer) return;
      feedMutationDebounceTimer = setTimeout(() => {
        feedMutationDebounceTimer = null;
        applyFeedFilters();
      }, 50);
    });
    feedObserver.observe(contentsEl, { childList: true, subtree: true });
  }

  function getCardVideoHref(card) {
    if (!card || typeof card.querySelector !== 'function') return '';
    const linkEl = card.querySelector('a#thumbnail[href], a#video-title-link[href], a#video-title[href], a[href*="/watch?v="], a[href*="/shorts/"]');
    return linkEl ? (linkEl.getAttribute('href') || '') : '';
  }

  function parseVideoDurationSeconds(card, currentHref) {
    if (!card || typeof card.querySelectorAll !== 'function') return -1;
    const href = currentHref !== undefined ? currentHref : getCardVideoHref(card);
    if (card.dataset && href && card.dataset.ytOrgHref === href && card.dataset.ytOrgDurationSec !== undefined) {
      const cachedSec = parseInt(card.dataset.ytOrgDurationSec, 10);
      if (!Number.isNaN(cachedSec) && cachedSec >= 0) {
        return cachedSec;
      }
    }

    const badges = card.querySelectorAll(
      'ytd-thumbnail-overlay-time-status-renderer #text, badge-shape .yt-badge-shape__text, .ytd-thumbnail-overlay-time-status-renderer, yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text'
    );
    for (const badge of badges) {
      const raw = (badge.textContent || '').trim();
      if (/^\s*(\d+:)?\d{1,2}:\d{2}\s*$/.test(raw)) {
        const parts = raw.split(':').map(p => parseInt(p.trim(), 10));
        if (parts.some(Number.isNaN)) continue;
        const sec = parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + parts[1];
        if (card.dataset && href) {
          card.dataset.ytOrgHref = href;
          card.dataset.ytOrgDurationSec = String(sec);
        }
        return sec;
      }
    }
    return -1;
  }

  const DATASET_UNIT_SEP = '\u001f';

  function getCardAuthorMetadata(card, currentHref, authorSelector) {
    if (
      card &&
      card.dataset &&
      currentHref &&
      card.dataset.ytOrgHref === currentHref &&
      card.dataset.ytOrgAuthorsCached === '1'
    ) {
      return {
        handles: card.dataset.ytOrgAuthorHandles ? card.dataset.ytOrgAuthorHandles.split(DATASET_UNIT_SEP) : [],
        ids: card.dataset.ytOrgAuthorIds ? card.dataset.ytOrgAuthorIds.split(DATASET_UNIT_SEP) : [],
        names: card.dataset.ytOrgAuthorNames ? card.dataset.ytOrgAuthorNames.split(DATASET_UNIT_SEP) : [],
        rawParts: card.dataset.ytOrgAuthorRaw ? card.dataset.ytOrgAuthorRaw.split(DATASET_UNIT_SEP) : []
      };
    }

    const handles = [];
    const ids = [];
    const names = [];
    const rawParts = [];
    const channelLinks = (card && typeof card.querySelectorAll === 'function')
      ? card.querySelectorAll(authorSelector)
      : [];

    for (const link of channelLinks) {
      const rawHref = (link.getAttribute('href') || '').replace(/\u001f/g, '');
      const rawText = (link.textContent || '').replace(/\u001f/g, ' ').trim();
      if (rawText) rawParts.push(rawText);
      if (rawHref) rawParts.push(rawHref);

      const href = rawHref.toLowerCase();
      const text = rawText.toLowerCase();

      const handleMatch = href.match(/\/@([^\/\?]+)/);
      if (handleMatch && handleMatch[1]) {
        handles.push(handleMatch[1]);
      }

      const idMatch = href.match(/\/channel\/([^\/\?]+)/);
      if (idMatch && idMatch[1]) {
        ids.push(idMatch[1]);
      }

      if (text) {
        names.push(text);
      }
    }

    if (card && card.dataset && currentHref && (handles.length > 0 || ids.length > 0 || names.length > 0)) {
      card.dataset.ytOrgHref = currentHref;
      card.dataset.ytOrgAuthorsCached = '1';
      card.dataset.ytOrgAuthorHandles = handles.join(DATASET_UNIT_SEP);
      card.dataset.ytOrgAuthorIds = ids.join(DATASET_UNIT_SEP);
      card.dataset.ytOrgAuthorNames = names.join(DATASET_UNIT_SEP);
      card.dataset.ytOrgAuthorRaw = rawParts.join(DATASET_UNIT_SEP);
    }

    return { handles, ids, names, rawParts };
  }

  function applyFeedFilters() {
    if (isApplyingFilter) return;
    isApplyingFilter = true;

    requestAnimationFrame(() => {
      try {
        const feedRoot = document.querySelector(YT_DOM_SELECTORS.feedRoot.join(', ')) ||
                         document;
        const videoCards = feedRoot.querySelectorAll(
          YT_DOM_SELECTORS.videoCards.join(', ')
        );

        let allowedIds = new Set();
        let allowedHandles = new Set();
        let allowedNames = new Set();

        const activeFolders = [];
        if (selectedFilterFolderIds.size > 0) {
          cachedFolders.forEach(f => {
            if (selectedFilterFolderIds.has(f.id)) activeFolders.push(f);
          });
        } else if (activeFilterFolderId !== 'all' && activeFilterFolderId !== 'multi') {
          const folder = cachedFolders.find(f => f.id === activeFilterFolderId);
          if (folder) activeFolders.push(folder);
        }

        const isFiltering = activeFolders.length > 0;
        if (isFiltering) {
          activeFolders.forEach(folder => {
            if (Array.isArray(folder.channels)) {
              folder.channels.forEach(chId => {
                const rawLower = String(chId).toLowerCase();
                allowedIds.add(rawLower);
                if (rawLower.startsWith('@')) {
                  allowedHandles.add(rawLower.slice(1));
                }
                const ch = cachedChannels[chId] || cachedChannelByToken.get(rawLower);
                if (ch) {
                  if (ch.id) {
                    allowedIds.add(String(ch.id).toLowerCase());
                  }
                  if (ch.handle) {
                    allowedHandles.add(ch.handle.toLowerCase().replace(/^@/, ''));
                  }
                  if (ch.name) {
                    allowedNames.add(ch.name.toLowerCase().trim());
                  }
                }
              });
            }
          });
        }

        // Gather Focus Mute sets
        let mutedIds = new Set();
        let mutedHandles = new Set();
        let mutedNames = new Set();
        if (mutedFilterFolderIds.size > 0) {
          cachedFolders.forEach(f => {
            if (mutedFilterFolderIds.has(f.id) && Array.isArray(f.channels)) {
              f.channels.forEach(chId => {
                const rawLower = String(chId).toLowerCase();
                mutedIds.add(rawLower);
                if (rawLower.startsWith('@')) {
                  mutedHandles.add(rawLower.slice(1));
                }
                const ch = cachedChannels[chId] || cachedChannelByToken.get(rawLower);
                if (ch) {
                  if (ch.id) mutedIds.add(String(ch.id).toLowerCase());
                  if (ch.handle) mutedHandles.add(ch.handle.toLowerCase().replace(/^@/, ''));
                  if (ch.name) mutedNames.add(ch.name.toLowerCase().trim());
                }
              });
            }
          });
        }

        const hideWatched = Boolean(cachedSettings.hideWatched);
        const hideShorts = Boolean(cachedSettings.hideShorts);
        const onlyLive = Boolean(cachedSettings.onlyLive);

        // Pre-hide unrelated Shorts shelves BEFORE video cards evaluation
        const shelfSections = feedRoot.querySelectorAll(YT_DOM_SELECTORS.shelfSections.join(', '));
        shelfSections.forEach(shelf => {
          if (isFiltering || hideShorts) {
            shelf.classList.add('yt-org-hidden');
          } else {
            shelf.classList.remove('yt-org-hidden');
          }
        });

        // Fast-path when all filters are inactive
        if (activeFilterFolderId === 'all' && selectedFilterFolderIds.size === 0 && mutedFilterFolderIds.size === 0 &&
            !hideWatched && !hideShorts && !onlyLive && feedDurationFilter === 'all' && !feedSearchQuery) {
          videoCards.forEach(card => {
            card.classList.remove(
              'yt-org-hidden',
              'yt-org-hidden-card',
              'yt-org-hidden-watched',
              'yt-org-hidden-shorts',
              'yt-org-hidden-nonlive',
              'yt-org-hidden-live',
              'yt-org-hidden-duration',
              'yt-org-hidden-search'
            );
          });
          handleFeedEmptyState(videoCards.length, false);
          pumpAttempts = 0;
          return;
        }

        let visibleCardsCount = 0;
        const authorSelector = YT_DOM_SELECTORS.authorLinks.join(', ');

        videoCards.forEach(card => {
          // If parent shelf is hidden, card is also hidden
          if (card.closest('.yt-org-hidden')) {
            return;
          }

          // Memoize card metadata on card.dataset keyed by video link href
          const currentHref = getCardVideoHref(card);
          if (card.dataset && currentHref && card.dataset.ytOrgHref !== currentHref) {
            card.dataset.ytOrgHref = currentHref;
            delete card.dataset.ytOrgDurationSec;
            delete card.dataset.ytOrgSearchText;
            delete card.dataset.ytOrgAuthorsCached;
            delete card.dataset.ytOrgAuthorHandles;
            delete card.dataset.ytOrgAuthorIds;
            delete card.dataset.ytOrgAuthorNames;
            delete card.dataset.ytOrgAuthorRaw;
            delete card.dataset.ytOrgIsShort;
          }

          // 1. Hide Watched Check
          if (hideWatched) {
            const hasProgress = card.querySelector(
              'ytd-thumbnail-overlay-resume-playback-renderer, #progress, [class*="resume-playback"], yt-thumbnail-overlay-progress-bar-view-model'
            );
            if (hasProgress) {
              card.classList.add('yt-org-hidden-watched');
            } else {
              card.classList.remove('yt-org-hidden-watched');
            }
          } else {
            card.classList.remove('yt-org-hidden-watched');
          }

          // 2. Hide Shorts Check
          if (hideShorts) {
            let isShortsCard = false;
            if (card.dataset && currentHref && card.dataset.ytOrgHref === currentHref && card.dataset.ytOrgIsShort !== undefined) {
              isShortsCard = card.dataset.ytOrgIsShort === '1';
            } else {
              isShortsCard = Boolean(
                card.querySelector('a[href*="/shorts/"], yt-thumbnail-overlay-badge-view-model [aria-label*="Shorts"], yt-icon[type="shorts"]') ||
                card.closest('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer')
              );
              if (card.dataset && currentHref) {
                card.dataset.ytOrgHref = currentHref;
                card.dataset.ytOrgIsShort = isShortsCard ? '1' : '0';
              }
            }
            if (isShortsCard) {
              card.classList.add('yt-org-hidden-shorts');
            } else {
              card.classList.remove('yt-org-hidden-shorts');
            }
          } else {
            card.classList.remove('yt-org-hidden-shorts');
          }

          // 3. Only Live Check
          if (onlyLive) {
            const isLiveCard = Boolean(
              card.querySelector(
                '.badge-style-type-live-now, [badge-style="BADGE_STYLE_TYPE_LIVE_NOW"], [aria-label*="LIVE"], [aria-label*="直播"]'
              ) ||
              Array.from(card.querySelectorAll('.badge, ytd-badge-supported-renderer, .yt-badge, yt-thumbnail-badge-view-model')).some(b => {
                const t = (b.textContent || '').trim().toUpperCase();
                return t.includes('LIVE') || t.includes('直播');
              })
            );
            if (!isLiveCard) {
              card.classList.add('yt-org-hidden-nonlive');
            } else {
              card.classList.remove('yt-org-hidden-nonlive');
            }
          } else {
            card.classList.remove('yt-org-hidden-nonlive');
          }

          // 4. Folder Channel Filter & Focus Mute Check
          // Only inspect author links, preventing video title @mention penetrations
          let authorMeta = null;
          let matchedMute = false;
          let matchedAllowed = false;

          if (mutedFilterFolderIds.size > 0 || isFiltering) {
            authorMeta = getCardAuthorMetadata(card, currentHref, authorSelector);
            if (mutedFilterFolderIds.size > 0) {
              matchedMute =
                authorMeta.handles.some(h => mutedHandles.has(h)) ||
                authorMeta.ids.some(cid => mutedIds.has(cid)) ||
                authorMeta.names.some(text => mutedNames.has(text));
            }
            if (!matchedMute && isFiltering) {
              matchedAllowed =
                authorMeta.handles.some(h => allowedHandles.has(h)) ||
                authorMeta.ids.some(cid => allowedIds.has(cid)) ||
                authorMeta.names.some(text => allowedNames.has(text));
            }
          }

          if (matchedMute) {
            card.classList.add('yt-org-hidden');
          } else if (isFiltering) {
            if (matchedAllowed) {
              card.classList.remove('yt-org-hidden');
            } else {
              card.classList.add('yt-org-hidden');
            }
          } else {
            card.classList.remove('yt-org-hidden');
          }

          // 5a. Duration Filter Check
          let isHiddenDuration = false;
          if (feedDurationFilter !== 'all') {
            const durationSec = parseVideoDurationSeconds(card, currentHref);
            let isDurationMatch = false;
            if (feedDurationFilter === 'short') {
              isDurationMatch = durationSec >= 0 && durationSec < 300;
            } else if (feedDurationFilter === 'medium') {
              isDurationMatch = durationSec >= 300 && durationSec <= 1200;
            } else if (feedDurationFilter === 'long') {
              isDurationMatch = durationSec > 1200;
            }
            card.classList.toggle('yt-org-hidden-duration', !isDurationMatch);
            isHiddenDuration = !isDurationMatch;
          } else {
            card.classList.remove('yt-org-hidden-duration');
          }

          // 5b. In-Feed Search Filter Check
          let isHiddenSearch = false;
          if (feedSearchQuery.length > 0) {
            let searchText = (card.dataset && currentHref && card.dataset.ytOrgHref === currentHref && card.dataset.ytOrgSearchText) || '';
            if (!searchText) {
              const titleEl = card.querySelector('#video-title, #video-title-link, h3 a, .yt-lockup-metadata-view-model__title');
              const titleText = (titleEl?.textContent || titleEl?.getAttribute?.('title') || '').trim();
              if (!authorMeta) {
                authorMeta = getCardAuthorMetadata(card, currentHref, authorSelector);
              }
              searchText = `${titleText} ${authorMeta.rawParts.join(' ')}`.toLowerCase();
              if (card.dataset && currentHref && searchText.trim()) {
                card.dataset.ytOrgHref = currentHref;
                card.dataset.ytOrgSearchText = searchText;
              }
            }
            const isSearchMatch = searchText.includes(feedSearchQuery);
            card.classList.toggle('yt-org-hidden-search', !isSearchMatch);
            isHiddenSearch = !isSearchMatch;
          } else {
            card.classList.remove('yt-org-hidden-search');
          }

          // Count visible cards
          const isHidden = card.classList.contains('yt-org-hidden') ||
                           card.classList.contains('yt-org-hidden-card') ||
                           card.classList.contains('yt-org-hidden-watched') ||
                           card.classList.contains('yt-org-hidden-shorts') ||
                           card.classList.contains('yt-org-hidden-nonlive') ||
                           card.classList.contains('yt-org-hidden-live');
          if (!isHidden && !isHiddenDuration && !isHiddenSearch && !card.closest('.yt-org-hidden')) {
            visibleCardsCount++;
          }
        });

        // 6. Empty State Display
        handleFeedEmptyState(visibleCardsCount, isFiltering || mutedFilterFolderIds.size > 0);

        // 7. Prevent Feed Starvation / Broken Infinite Scroll (Scroll Pump)
        if ((isFiltering || mutedFilterFolderIds.size > 0 || hideShorts || hideWatched || onlyLive || feedDurationFilter !== 'all' || Boolean(feedSearchQuery)) && visibleCardsCount < 6) {
          pumpFeedIfNeeded(visibleCardsCount);
        } else if (visibleCardsCount >= 6) {
          pumpAttempts = 0;
        }

      } finally {
        isApplyingFilter = false;
      }
    });
  }

  function handleFeedEmptyState(visibleCount, hasFolderOrMuteFilter) {
    const richGrid = document.querySelector('ytd-browse ytd-rich-grid-renderer, ytd-rich-grid-renderer');
    if (!richGrid) return;

    let emptyEl = document.getElementById('yt-org-feed-empty-state');
    const isFiltered = hasFolderOrMuteFilter || cachedSettings.hideWatched || cachedSettings.hideShorts || cachedSettings.onlyLive || feedDurationFilter !== 'all' || Boolean(feedSearchQuery);

    if (isPumping && visibleCount === 0) {
      if (emptyEl) emptyEl.style.display = 'none';
      return;
    }

    if (isFiltered && visibleCount === 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.id = 'yt-org-feed-empty-state';
        const contents = richGrid.querySelector('#contents');
        if (contents) {
          contents.parentNode.insertBefore(emptyEl, contents.nextSibling);
        } else {
          richGrid.appendChild(emptyEl);
        }
      }

      let emptyMsg = '目前沒有符合條件的最新影片，或已全部觀看。';
      if (selectedFilterFolderIds.size === 1) {
        const folder = cachedFolders.find(f => selectedFilterFolderIds.has(f.id));
        const display = getFolderDisplay(folder);
        emptyMsg = `${escapeHtml(display.icon)} <strong>「${escapeHtml(display.name)}」</strong> 目前沒有符合條件的最新影片，或已全部觀看。`;
      } else if (selectedFilterFolderIds.size > 1) {
        emptyMsg = `📁 目前所選的 <strong>${selectedFilterFolderIds.size} 個分組</strong> 中沒有符合條件的最新影片。`;
      } else if (activeFilterFolderId !== 'all' && activeFilterFolderId !== 'multi') {
        const folder = cachedFolders.find(f => f.id === activeFilterFolderId);
        const display = getFolderDisplay(folder);
        emptyMsg = `${escapeHtml(display.icon)} <strong>「${escapeHtml(display.name)}」</strong> 目前沒有符合條件的最新影片，或已全部觀看。`;
      } else if (cachedSettings.onlyLive) {
        emptyMsg = `🔴 目前訂閱頻道中尚無正在進行的直播節目。`;
      }

      emptyEl.innerHTML = `
        <div>${emptyMsg}</div>
        <button class="yt-org-empty-reset-btn" id="yt-org-empty-reset-btn">重設條件並檢視全部動態</button>
      `;
      const resetBtn = emptyEl.querySelector('#yt-org-empty-reset-btn');
      if (resetBtn) {
        resetBtn.onclick = () => {
          selectedFilterFolderIds.clear();
          mutedFilterFolderIds.clear();
          activeFilterFolderId = 'all';
          feedSearchQuery = '';
          feedDurationFilter = 'all';
          cachedSettings.activeFeedFolderId = 'all';
          cachedSettings.selectedFeedFolderIds = [];
          cachedSettings.mutedFeedFolderIds = [];
          cachedSettings.feedDurationFilter = 'all';
          YTFolderStorage.updateSettings({
            activeFeedFolderId: 'all',
            selectedFeedFolderIds: [],
            mutedFeedFolderIds: [],
            feedDurationFilter: 'all'
          });
          const searchInputEl = document.getElementById('yt-org-feed-search-input');
          if (searchInputEl) searchInputEl.value = '';
          const durationSelectEl = document.getElementById('yt-org-feed-duration-select');
          if (durationSelectEl) durationSelectEl.value = 'all';
          updateFeedFilterChipsUI();
          applyFeedFilters();
        };
      }
      emptyEl.style.display = 'flex';
    } else {
      if (emptyEl) {
        emptyEl.style.display = 'none';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Feed Starvation Prevention (Scroll Pump)
  // ---------------------------------------------------------------------------
  let isPumping = false;
  let pumpAttempts = 0;
  let lastPumpKey = '';
  let lastPumpedFolderId = null;

  function pumpFeedIfNeeded(visibleCount) {
    if (isPumping) return;
    if (!window.location.pathname.startsWith('/feed/subscriptions')) return;
    if (typeof visibleCount === 'number' && visibleCount >= 6) return;

    const selTokens = Array.from(selectedFilterFolderIds).sort().join(',');
    const muteTokens = Array.from(mutedFilterFolderIds).sort().join(',');
    const currentKey = `${activeFilterFolderId}_${selTokens}_${muteTokens}_${cachedSettings.hideShorts}_${cachedSettings.hideWatched}_${cachedSettings.onlyLive}_${feedDurationFilter}_${feedSearchQuery}`;
    if (lastPumpKey !== currentKey) {
      lastPumpKey = currentKey;
      lastPumpedFolderId = activeFilterFolderId;
      pumpAttempts = 0;
    }

    if (pumpAttempts >= 5) return;

    const continuation = document.querySelector('ytd-continuation-item-renderer');
    if (!continuation) return;

    isPumping = true;
    pumpAttempts++;

    try {
      continuation.scrollIntoView({ behavior: 'auto', block: 'end' });
      window.scrollBy(0, 100);
    } catch (e) {}

    setTimeout(() => {
      isPumping = false;
      applyFeedFilters();
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (Alt + 0~9)
  // ---------------------------------------------------------------------------
  let shortcutsInitialized = false;
  function setupKeyboardShortcuts() {
    if (shortcutsInitialized) return;
    shortcutsInitialized = true;

    document.addEventListener('keydown', (e) => {
      if (!window.location.pathname.startsWith('/feed/subscriptions')) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (e.key === '0') {
          e.preventDefault();
          selectedFilterFolderIds.clear();
          activeFilterFolderId = 'all';
          persistFeedFilterFolderState();
          updateFeedFilterChipsUI();
          applyFeedFilters();
          showToast('快捷鍵 Alt+0：切換至【全部動態】');
          return;
        }

        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          const folderIdx = num - 1;
          if (cachedFolders && cachedFolders[folderIdx]) {
            const folder = cachedFolders[folderIdx];
            const display = getFolderDisplay(folder);
            selectedFilterFolderIds.clear();
            selectedFilterFolderIds.add(folder.id);
            mutedFilterFolderIds.delete(folder.id);
            activeFilterFolderId = folder.id;
            persistFeedFilterFolderState();
            updateFeedFilterChipsUI();
            applyFeedFilters();
            showToast(`快捷鍵 Alt+${num}：切換至【${display.name}】`);
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Global Floating Dropdown Menu (immune to container overflow: hidden)
  // ---------------------------------------------------------------------------
  let floatingDropdownListenersBound = false;
  function getOrCreateFloatingDropdown() {
    if (globalFloatingDropdown && document.body.contains(globalFloatingDropdown)) {
      return globalFloatingDropdown;
    }
    const menu = document.createElement('div');
    menu.id = 'yt-org-global-floating-dropdown';
    menu.className = 'yt-org-floating-dropdown';
    document.body.appendChild(menu);
    globalFloatingDropdown = menu;

    if (!floatingDropdownListenersBound) {
      floatingDropdownListenersBound = true;
      document.addEventListener('click', (e) => {
        if (currentDropdownTriggerBtn && currentDropdownTriggerBtn.contains(e.target)) {
          return;
        }
        if (globalFloatingDropdown && !globalFloatingDropdown.contains(e.target)) {
          globalFloatingDropdown.classList.remove('show');
        }
      });

      window.addEventListener('scroll', () => {
        if (globalFloatingDropdown && globalFloatingDropdown.classList.contains('show')) {
          globalFloatingDropdown.classList.remove('show');
        }
      }, { passive: true });
    }

    return menu;
  }

  async function openChannelFolderDropdown(btn, channelInfo) {
    const dropdown = getOrCreateFloatingDropdown();
    currentDropdownChannelInfo = channelInfo;
    currentDropdownTriggerBtn = btn;

    const memberFolderIds = getCachedFolderIdsByChannel(channelInfo.id, channelInfo.handle);
    const safeChannelDisplayName = escapeHtml(channelInfo.name || channelInfo.handle);

    dropdown.innerHTML = `
      <div class="yt-org-dropdown-header">
        <span>選擇「${safeChannelDisplayName}」的分組</span>
        <span style="font-size: 12px; cursor: pointer; color: #ff0033;" id="yt-org-floating-dropdown-close">關閉 ✕</span>
      </div>
      <div class="yt-org-dropdown-quick-add">
        <input type="text" class="yt-org-dropdown-quick-input" id="yt-org-dropdown-quick-input" placeholder="➕ 快速建立新分組..." />
        <button class="yt-org-dropdown-quick-btn" id="yt-org-dropdown-quick-btn">建立</button>
      </div>
      <div class="yt-org-dropdown-list">
        ${cachedFolders.length === 0 ? `
          <div style="padding: 12px; text-align: center; font-size: 12px; opacity: 0.7;">尚未建立分組，請在上方輸入名稱新增！</div>
        ` : cachedFolders.map(folder => {
          const isChecked = memberFolderIds.includes(folder.id);
          const display = getFolderDisplay(folder);
          const safeFolderName = escapeHtml(display.name);
          return `
            <label class="yt-org-dropdown-item">
              <input type="checkbox" class="yt-org-floating-folder-checkbox" data-folder-id="${escapeHtml(folder.id)}" ${isChecked ? 'checked' : ''} />
              <span>${escapeHtml(display.icon)}</span>
              <span class="yt-org-dropdown-item-name">${safeFolderName}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;

    // Position dropdown directly under button
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 6}px`;
    dropdown.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - 310))}px`;
    dropdown.classList.add('show');

    dropdown.querySelector('#yt-org-floating-dropdown-close').onclick = () => {
      dropdown.classList.remove('show');
    };

    const quickInput = dropdown.querySelector('#yt-org-dropdown-quick-input');
    const quickBtn = dropdown.querySelector('#yt-org-dropdown-quick-btn');
    const handleQuickAddFolder = async () => {
      const name = (quickInput?.value || '').trim();
      if (!name) return;
      try {
        const newFolder = await YTFolderStorage.addFolder({ name });
        if (newFolder && newFolder.id) {
          await YTFolderStorage.addChannelToFolder(newFolder.id, channelInfo);
          showToast(`已建立新分組「${name}」並已將此頻道加入！`);
          await loadData();
          injectSidebarSection();
          updateTaggerButtonAppearance(btn, channelInfo);
          openChannelFolderDropdown(btn, channelInfo);
        }
      } catch (err) {
        showToast('建立分組失敗，請重試');
      }
    };

    if (quickBtn) quickBtn.onclick = handleQuickAddFolder;
    if (quickInput) {
      quickInput.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') handleQuickAddFolder();
      };
    }

    dropdown.querySelectorAll('.yt-org-floating-folder-checkbox').forEach(chk => {
      chk.onchange = async () => {
        const folderId = chk.dataset.folderId;
        const added = await YTFolderStorage.toggleChannelInFolder(folderId, channelInfo);
        const folder = cachedFolders.find(f => f.id === folderId);
        showToast(added ? `已將頻道加入「${folder?.name}」` : `已自「${folder?.name}」移除頻道`);
        await loadData();
        injectSidebarSection();
        updateTaggerButtonAppearance(btn, channelInfo);
      };
    });
  }

  function getCachedFolderIdsByChannel(chId, chHandle) {
    const targetId = (chId || '').toLowerCase().trim();
    const targetHandle = (chHandle || '').toLowerCase().trim().replace(/^@/, '');
    if (!targetId && !targetHandle) return [];

    const byId = targetId ? cachedFolderIdsByToken.get(targetId) : undefined;
    const byHandle = targetHandle
      ? (cachedFolderIdsByToken.get(targetHandle) || cachedFolderIdsByToken.get('@' + targetHandle))
      : undefined;

    if (!byId && !byHandle) return [];
    if (byId && !byHandle) return byId.slice();
    if (!byId && byHandle) return byHandle.slice();
    if (byId === byHandle) return byId.slice();

    const merged = new Set(byId);
    for (const fid of byHandle) {
      merged.add(fid);
    }
    if (merged.size === byId.length) return byId.slice();
    return Array.from(merged).sort(
      (a, b) => (cachedFolderOrderMap.get(a) ?? 0) - (cachedFolderOrderMap.get(b) ?? 0)
    );
  }

  function getPageSubscriptionState() {
    const candidates = document.querySelectorAll(
      YT_DOM_SELECTORS.subscribeButtons.join(', ')
    );
    let subBtn = null;
    for (const btn of candidates) {
      // Isolate hidden DOM containers from SPA cache
      if (btn.closest('[hidden], ytd-browse[hidden], ytd-watch-flexy[hidden]')) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        subBtn = btn;
        break;
      }
    }
    if (!subBtn && candidates.length > 0) {
      for (const btn of candidates) {
        if (!btn.closest('[hidden], ytd-browse[hidden], ytd-watch-flexy[hidden]')) {
          subBtn = btn;
          break;
        }
      }
    }
    if (!subBtn) return 'UNKNOWN';

    const text = (subBtn.textContent || '').trim();
    const aria = (subBtn.getAttribute('aria-label') || '').trim();
    const combined = `${text} ${aria}`.toLowerCase();

    // Check for subscribed
    if (combined.includes('已訂閱') || combined.includes('subscribed') || subBtn.closest('[subscribed]') !== null) {
      return 'SUBSCRIBED';
    }

    // Check for definitely unsubscribed ("訂閱" or "subscribe", but not "已訂閱")
    if (combined.includes('訂閱') || combined.includes('subscribe')) {
      return 'UNSUBSCRIBED';
    }

    return 'UNKNOWN';
  }

  async function updateTaggerButtonAppearance(btn, channelInfo) {
    if (!btn || !channelInfo) return;

    const memberFolderIds = getCachedFolderIdsByChannel(channelInfo.id, channelInfo.handle);
    const hasFolders = memberFolderIds.length > 0;
    btn.className = `yt-org-channel-tagger-btn ${hasFolders ? 'has-folders' : ''}`;
    btn.innerHTML = `
      <span>📁</span>
      <span>${hasFolders ? `已分組 (${memberFolderIds.length})` : '加入分組'}</span>
      <span style="font-size: 10px; margin-left: 2px;">▼</span>
    `;
  }

  // ---------------------------------------------------------------------------
  // 4. Channel Page & Video Watch Page Quick Tagger Button
  // ---------------------------------------------------------------------------
  const CHANNEL_TAGGER_SELECTORS = [
    '.ytFlexibleActionsViewModelAction',
    'yt-subscribe-button-view-model',
    'subscribe-button-view-model',
    '.page-header-view-model-wiz__page-header-actions',
    'yt-page-header-view-model .page-header-view-model-wiz__page-header-headline-info',
    'ytd-page-header-renderer #buttons',
    'ytd-c4-tabbed-header-renderer #subscribe-button',
    'ytd-subscribe-button-renderer',
    '#subscribe-button'
  ];

  const WATCH_TAGGER_SELECTORS = [
    'ytd-watch-metadata #owner #subscribe-button',
    '#owner #subscribe-button',
    'ytd-video-owner-renderer #subscribe-button',
    '#owner yt-subscribe-button-view-model',
    '#owner subscribe-button-view-model',
    '#owner ytd-subscribe-button-renderer',
    'ytd-watch-metadata #owner',
    '#owner'
  ];

  function isVisibleActionElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (el.closest('.skeleton-bg-color, [class*="skeleton"], ytd-watch-flexy[hidden]')) return false;
    return true;
  }

  function findFirstActionElement(selectors) {
    let firstFallback = null;
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (!firstFallback) {
          firstFallback = node;
        }
        if (isVisibleActionElement(node)) {
          return node;
        }
      }
    }
    return firstFallback;
  }

  function checkAndInjectChannelTagger() {
    const pathname = window.location.pathname;
    const isChannelPage = pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/') || pathname.startsWith('/user/');
    const isWatchPage = pathname.startsWith('/watch');

    const existing = document.getElementById('yt-org-channel-tagger-wrapper');
    if (!isChannelPage && !isWatchPage) {
      if (existing) existing.remove();
      return;
    }

    // Fast-path: If tagger already exists and is visible for the current URL, avoid full DOM scans
    const currentUrlKey = `${pathname}${window.location.search}`;
    if (existing && existing.dataset.urlKey === currentUrlKey) {
      const existingRect = existing.getBoundingClientRect();
      if (existingRect.width > 0 && existingRect.height > 0) {
        const currentSubState = getPageSubscriptionState();
        if (existing.dataset.lastSubState !== currentSubState) {
          existing.dataset.lastSubState = currentSubState;
          const existingBtn = existing.querySelector('#yt-org-tagger-toggle-btn');
          const channelInfo = isChannelPage ? extractCurrentChannelInfo() : extractWatchPageChannelInfo();
          if (existingBtn && channelInfo) {
            updateTaggerButtonAppearance(existingBtn, channelInfo);
          }
        }
        return;
      }
    }

    let actionContainer = null;
    let channelInfo = null;

    if (isChannelPage) {
      actionContainer = findFirstActionElement(CHANNEL_TAGGER_SELECTORS);
      if (!actionContainer) return;
      channelInfo = extractCurrentChannelInfo();
    } else if (isWatchPage) {
      // Under video player on watch page
      actionContainer = findFirstActionElement(WATCH_TAGGER_SELECTORS);
      if (!actionContainer) return;
      channelInfo = extractWatchPageChannelInfo();
    }

    if (!channelInfo || (!channelInfo.id && !channelInfo.handle)) return;

    const channelKey = channelInfo.id || channelInfo.handle;

    if (existing) {
      const existingRect = existing.getBoundingClientRect();
      const isRenderedAndVisible = existing.dataset.channelKey === channelKey && (existingRect.width > 0 && existingRect.height > 0);
      if (isRenderedAndVisible) {
        existing.dataset.urlKey = currentUrlKey;
        const currentSubState = getPageSubscriptionState();
        if (existing.dataset.lastSubState !== currentSubState) {
          existing.dataset.lastSubState = currentSubState;
          const existingBtn = existing.querySelector('#yt-org-tagger-toggle-btn');
          if (existingBtn) {
            updateTaggerButtonAppearance(existingBtn, channelInfo);
          }
        }
        return;
      }
      // Stale or stuck in hidden skeleton -> remove and recreate cleanly
      if (globalFloatingDropdown && globalFloatingDropdown.classList.contains('show')) {
        globalFloatingDropdown.classList.remove('show');
      }
      existing.remove();
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'yt-org-channel-tagger-wrapper';
    wrapper.className = 'yt-org-channel-tagger-container';
    wrapper.dataset.channelKey = channelKey;
    wrapper.dataset.urlKey = currentUrlKey;
    wrapper.dataset.lastSubState = getPageSubscriptionState();

    const btn = document.createElement('button');
    btn.id = 'yt-org-tagger-toggle-btn';
    updateTaggerButtonAppearance(btn, channelInfo);

    btn.onclick = (e) => {
      e.stopPropagation();
      openChannelFolderDropdown(btn, channelInfo);
    };

    wrapper.appendChild(btn);

    if (actionContainer.insertAdjacentElement) {
      actionContainer.insertAdjacentElement('afterend', wrapper);
    } else {
      actionContainer.parentNode.appendChild(wrapper);
    }
  }

  function extractCurrentChannelInfo() {
    let id = '';
    let handle = '';
    let name = '';
    let avatarUrl = '';

    const handleMatch = window.location.pathname.match(/^\/(@[^\/\?]+)/);
    if (handleMatch) {
      handle = handleMatch[1];
      // Resolve canonical ID from O(1) in-memory reverse index if known, avoiding stale <head> meta tag from previous SPA page
      if (cachedChannels) {
        const normH = handle.toLowerCase();
        const existing = cachedChannelByToken.get(normH) || cachedChannelByToken.get(normH.replace(/^@/, ''));
        if (existing && existing.id && existing.id.startsWith('UC')) {
          id = existing.id;
        }
      }
    }

    // Only query <head> meta tags if not already identifiable by @handle
    if (!handle) {
      const channelMeta = document.querySelector('meta[itemprop="channelId"]') ||
                          document.querySelector('meta[name="channelId"]');
      if (channelMeta) {
        id = channelMeta.getAttribute('content');
      }

      if (!id) {
        const canonicalLink = document.querySelector('link[rel="canonical"]');
        const m = canonicalLink?.getAttribute('href')?.match(/channel\/(UC[a-zA-Z0-9_-]{22})/);
        if (m) id = m[1];
      }
    }

    if (!id) {
      const idMatch = window.location.pathname.match(/^\/channel\/([^\/\?]+)/);
      if (idMatch) id = idMatch[1];
    }

    const titleEl = document.querySelector('yt-page-header-view-model .page-header-view-model-wiz__page-header-title, yt-page-header-view-model h1, ytd-page-header-renderer h1, ytd-c4-tabbed-header-renderer #channel-name #text');
    if (titleEl) {
      name = titleEl.textContent?.trim() || '';
    } else {
      name = document.title.replace(' - YouTube', '').trim();
    }

    const avatarEl = document.querySelector('yt-page-header-view-model img, ytd-c4-tabbed-header-renderer #avatar img, yt-page-header-renderer img');
    if (avatarEl) {
      avatarUrl = avatarEl.src || '';
    }

    if (!id && !handle) return null;
    const finalName = name || handle || id;
    if (typeof isSystemActionTitle === 'function' && (isSystemActionTitle(finalName) || isSystemActionTitle(handle) || isSystemActionTitle(id))) {
      return null;
    }
    return { id: id || handle, name: finalName, handle, avatarUrl };
  }

  function extractWatchPageChannelInfo() {
    const ownerEl = document.querySelector('#owner, ytd-video-owner-renderer');

    let id = '';
    let handle = '';
    let name = '';
    let avatarUrl = '';

    // 1. Direct anchor inside owner
    if (ownerEl) {
      const linkEl = ownerEl.querySelector('a[href*="/@"], a[href*="/channel/"], #channel-name a');
      if (linkEl) {
        const href = linkEl.getAttribute('href') || '';
        const handleMatch = href.match(/\/@([^\/\?]+)/);
        if (handleMatch) {
          handle = `@${handleMatch[1]}`;
          if (cachedChannels) {
            const normH = handle.toLowerCase();
            const existing = cachedChannelByToken.get(normH) || cachedChannelByToken.get(normH.replace(/^@/, ''));
            if (existing && existing.id && existing.id.startsWith('UC')) {
              id = existing.id;
            }
          }
        }
        const idMatch = href.match(/\/channel\/([^\/\?]+)/);
        if (idMatch) {
          id = idMatch[1];
        }
        name = linkEl.textContent?.trim() || '';
      }
    }

    // 2. Only inspect <head> if neither id nor handle was discovered in owner DOM
    if (!id && !handle) {
      const headAuthorLink = document.querySelector('link[itemprop="url"][href*="/channel/"], link[rel="canonical"][href*="/channel/"]');
      if (headAuthorLink) {
        const href = headAuthorLink.getAttribute('href') || '';
        const idMatch = href.match(/\/channel\/([^\/\?]+)/);
        if (idMatch) {
          id = idMatch[1];
        }
      }

      if (!id) {
        const metaId = document.querySelector('meta[itemprop="channelId"]');
        if (metaId && metaId.getAttribute('content')) {
          id = metaId.getAttribute('content');
        }
      }
    }

    // 3. Channel name text
    if (!name) {
      const nameEl = ownerEl?.querySelector('#attributed-channel-name, #channel-name, ytd-channel-name') ||
                     document.querySelector('ytd-watch-metadata #owner #upload-info') ||
                     document.querySelector('link[itemprop="name"]');
      if (nameEl) {
        name = nameEl.getAttribute?.('content') || nameEl.textContent?.trim() || '';
        name = name.replace(/^「|」$/g, '').trim();
      }
    }

    // 4. Avatar image
    if (ownerEl) {
      const imgEl = ownerEl.querySelector('#avatar img, img');
      if (imgEl && imgEl.src) {
        avatarUrl = imgEl.src;
      }
    }
    if (!avatarUrl) {
      const headAvatar = document.querySelector('#owner img, ytd-video-owner-renderer img');
      if (headAvatar && headAvatar.src) {
        avatarUrl = headAvatar.src;
      }
    }

    if (!id && !handle) return null;
    const finalWatchName = name || handle || id;
    if (typeof isSystemActionTitle === 'function' && (isSystemActionTitle(finalWatchName) || isSystemActionTitle(handle) || isSystemActionTitle(id))) {
      return null;
    }
    return { id: id || handle, name: finalWatchName, handle, avatarUrl };
  }

  // ---------------------------------------------------------------------------
  // 5. Channels Sync Banner on /feed/channels
  // ---------------------------------------------------------------------------
  function checkAndInjectChannelsSyncBanner() {
    if (!window.location.pathname.startsWith('/feed/channels')) {
      const existing = document.getElementById('yt-org-sync-banner');
      if (existing) existing.remove();
      return;
    }

    if (document.getElementById('yt-org-sync-banner')) return;

    const browse = document.querySelector('ytd-browse[page-subtype="channels"]') || document.querySelector('ytd-browse');
    if (!browse) return;

    const banner = document.createElement('div');
    banner.id = 'yt-org-sync-banner';
    banner.innerHTML = `
      <div>📁 <strong>YouTube 訂閱分組管理</strong>：在此頁面可一鍵掃描你的所有 YouTube 訂閱頻道並更新至擴充。</div>
      <button class="yt-org-sync-btn" id="yt-org-btn-sync-action">
        <span>📥 一鍵同步所有已訂閱頻道</span>
      </button>
    `;

    browse.prepend(banner);

    banner.querySelector('#yt-org-btn-sync-action').onclick = async () => {
      const channelNodes = document.querySelectorAll('ytd-channel-renderer');
      if (channelNodes.length === 0) {
        showToast('頁面上尚未加載頻道，請向下滾動後再試！');
        return;
      }

      const discovered = [];
      channelNodes.forEach(node => {
        const link = node.querySelector('a#main-link, a[href*="/@"], a[href*="/channel/"]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        let id = '';
        let handle = '';
        const hMatch = href.match(/\/@([^\/\?]+)/);
        if (hMatch) handle = `@${hMatch[1]}`;
        const idMatch = href.match(/\/channel\/([^\/\?]+)/);
        if (idMatch) id = idMatch[1];

        const title = node.querySelector('#channel-title #text, #channel-title')?.textContent?.trim() || '';
        const img = node.querySelector('#avatar img, img')?.src || '';

        if (id || handle) {
          const finalNodeName = title || handle || id;
          if (typeof isSystemActionTitle === 'function' && (isSystemActionTitle(finalNodeName) || isSystemActionTitle(handle) || isSystemActionTitle(id))) {
            return;
          }
          discovered.push({
            id: id || handle,
            name: finalNodeName,
            handle,
            avatarUrl: img,
            isSubscribed: true
          });
        }
      });

      if (discovered.length > 0) {
        const res = await YTFolderStorage.batchAddChannels(discovered);
        showToast(`已成功同步 ${discovered.length} 個頻道！(新發現: ${res.newCount} 個)`);
        await loadData();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Automatic Unsubscribe Synchronization
  // When a user unsubscribes anywhere on YouTube (Channel page, Watch page,
  // /feed/channels, or native confirm dialog), synchronously remove the channel
  // from all folders, update the tagger button, and refresh sidebar/filters.
  // ---------------------------------------------------------------------------
  let lastSubscribeActionContext = null;
  let currentWatchedChannelState = { key: '', wasSubscribed: false };

  // Track clicks on subscribe/unsubscribe action buttons and popup menus
  document.addEventListener('click', (e) => {
    const subTarget = e.target.closest(
      'yt-subscribe-button-view-model, subscribe-button-view-model, #subscribe-button, ytd-subscribe-button-renderer, ytd-menu-service-item-renderer, tp-yt-paper-item, button[aria-label*="訂閱"], button[aria-label*="subscribe" i]'
    );
    if (!subTarget) return;

    // Check if clicked inside a channel list item (/feed/channels or search)
    const channelRow = e.target.closest('ytd-channel-renderer, ytd-grid-channel-renderer');
    if (channelRow) {
      const link = channelRow.querySelector('a#main-link, a[href*="/@"], a[href*="/channel/"]');
      const href = link?.getAttribute('href') || '';
      let id = '';
      let handle = '';
      const hm = href.match(/\/@([^\/\?]+)/);
      if (hm) handle = `@${hm[1]}`;
      const im = href.match(/\/channel\/([^\/\?]+)/);
      if (im) id = im[1];
      const name = channelRow.querySelector('#channel-title, #title')?.textContent?.trim() || handle || id;
      if (id || handle) {
        lastSubscribeActionContext = { id: id || handle, handle, name, timestamp: Date.now() };
        return;
      }
    }

    if (window.location.pathname.startsWith('/@') || window.location.pathname.startsWith('/channel/')) {
      lastSubscribeActionContext = { ...extractCurrentChannelInfo(), timestamp: Date.now() };
    } else if (window.location.pathname.startsWith('/watch')) {
      lastSubscribeActionContext = { ...extractWatchPageChannelInfo(), timestamp: Date.now() };
    }
  }, true);

  // Listen for YouTube's native Unsubscribe Confirmation Dialog button click
  document.addEventListener('click', async (e) => {
    // Only trigger when user confirms unsubscription in YouTube's confirmation dialog
    const dialog = e.target.closest('yt-confirm-dialog-renderer, ytd-confirm-dialog-renderer, tp-yt-paper-dialog');
    if (!dialog) return;

    const confirmBtn = e.target.closest('#confirm-button, [dialog-confirm], button');
    if (!confirmBtn) return;

    const btnText = (confirmBtn.textContent || confirmBtn.getAttribute('aria-label') || '').trim();
    if (!/取消訂閱|unsubscribe/i.test(btnText) || /^取消$|^cancel$/i.test(btnText)) return;

    let targetChannel = null;

    // Context from recent subscribe button click (within 60 seconds)
    if (lastSubscribeActionContext && (Date.now() - lastSubscribeActionContext.timestamp < 60000)) {
      targetChannel = lastSubscribeActionContext;
    }

    // Parse from dialog text: e.g. 要取消訂閱「頻道名稱」嗎？ or Unsubscribe from ChannelName?
    const dialogText = dialog.textContent || '';
    let parsedName = '';
    const zhMatch = dialogText.match(/要取消訂閱「([^」]+)」/);
    if (zhMatch) parsedName = zhMatch[1].trim();
    if (!parsedName) {
      const enMatch = dialogText.match(/Unsubscribe from ([^\?]+)\?/i);
      if (enMatch) parsedName = enMatch[1].trim();
    }

    if (!targetChannel) {
      if (window.location.pathname.startsWith('/@') || window.location.pathname.startsWith('/channel/')) {
        targetChannel = extractCurrentChannelInfo();
      } else if (window.location.pathname.startsWith('/watch')) {
        targetChannel = extractWatchPageChannelInfo();
      }
    }

    // Enrich targetChannel and cross-reference parsedName via O(1) in-memory indices
    if (targetChannel && cachedChannels) {
      const tokenKey = String(targetChannel.id || targetChannel.handle || '').toLowerCase().trim();
      const byToken = tokenKey
        ? (cachedChannelByToken.get(tokenKey) || cachedChannelByToken.get(tokenKey.replace(/^@/, '')))
        : null;
      if (byToken) {
        targetChannel = {
          id: byToken.id || targetChannel.id || byToken.handle,
          handle: byToken.handle || targetChannel.handle,
          name: byToken.name || targetChannel.name
        };
      }
    }
    if (parsedName && cachedChannels) {
      const normParsed = parsedName.toLowerCase();
      const matched = cachedChannelByName.get(normParsed) ||
        cachedChannelByToken.get(normParsed) ||
        cachedChannelByToken.get(normParsed.replace(/^@/, ''));
      if (matched) {
        targetChannel = {
          id: matched.id || matched.handle,
          handle: matched.handle,
          name: matched.name
        };
      } else if (targetChannel && !targetChannel.name) {
        targetChannel.name = parsedName;
      }
    }

    if (!targetChannel || (!targetChannel.id && !targetChannel.handle)) return;

    const chId = targetChannel.id || targetChannel.handle;
    const chHandle = targetChannel.handle || '';
    const chName = targetChannel.name || chHandle || chId;

    const removeRes = await YTFolderStorage.removeChannelFromAllFolders(chId, chHandle, chName);
    await loadData();
    injectSidebarSection();

    const taggerBtn = document.getElementById('yt-org-tagger-toggle-btn');
    if (taggerBtn) {
      taggerBtn.className = 'yt-org-channel-tagger-btn';
      taggerBtn.innerHTML = `<span>📁</span><span>加入分組</span><span style="font-size: 10px; margin-left: 2px;">▼</span>`;
    }

    if (removeRes && removeRes.removedCount > 0) {
      showToast(`已取消訂閱「${chName}」，並已同步自 ${removeRes.removedCount} 個分組移除。`);
    } else {
      showToast(`已取消訂閱「${chName}」，已同步確認自所有分組移除。`);
    }
  }, true);

  // Monitor subscribe button state transitions on channel / watch pages
  let lastMonitoredSubState = null;
  let lastMonitoredChannelKey = null;

  async function monitorChannelSubscribeButtonState() {
    const pathname = window.location.pathname;
    const isChannelPage = pathname.startsWith('/@') || pathname.startsWith('/channel/');
    const isWatchPage = pathname.startsWith('/watch');
    if (!isChannelPage && !isWatchPage) return;

    const channelInfo = isChannelPage ? extractCurrentChannelInfo() : extractWatchPageChannelInfo();
    if (!channelInfo || (!channelInfo.id && !channelInfo.handle)) return;

    const subState = getPageSubscriptionState();
    const channelKey = (channelInfo.id || channelInfo.handle).toLowerCase();

    // Performance guard: Skip repeated redundant processing if channel and subscription state haven't changed
    if (lastMonitoredSubState === subState && lastMonitoredChannelKey === channelKey) {
      return;
    }
    lastMonitoredSubState = subState;
    lastMonitoredChannelKey = channelKey;

    const taggerBtn = document.getElementById('yt-org-tagger-toggle-btn');
    if (taggerBtn) {
      updateTaggerButtonAppearance(taggerBtn, channelInfo);
    }
  }

  // ---------------------------------------------------------------------------
  // Master Lifecycle Handler
  // ---------------------------------------------------------------------------
  async function onPageUpdate() {
    lastMonitoredSubState = null;
    lastMonitoredChannelKey = null;
    if (globalFloatingDropdown && globalFloatingDropdown.classList.contains('show')) {
      globalFloatingDropdown.classList.remove('show');
    }
    await loadData();
    injectSidebarSection();
    checkAndInjectFeedFilter();
    checkAndInjectChannelTagger();
    checkAndInjectChannelsSyncBanner();
    monitorChannelSubscribeButtonState();
    setupKeyboardShortcuts();
  }

  window.addEventListener('yt-navigate-finish', onPageUpdate);
  window.addEventListener('yt-page-data-updated', onPageUpdate);
  window.addEventListener('popstate', onPageUpdate);

  let storageReloadDebounceTimer = null;
  let pendingGranularSettingsSync = false;

  function isNewFolderInputFocusedOrVisible() {
    const newFolderInput = document.getElementById('yt-org-sidebar-new-folder-input');
    if (!newFolderInput) return false;
    if (document.activeElement === newFolderInput) return true;
    const newFolderBox = document.getElementById('yt-org-sidebar-new-folder-box');
    if (newFolderBox) {
      return newFolderBox.style.display !== 'none' && !newFolderBox.hidden &&
             newFolderInput.style.display !== 'none' && !newFolderInput.hidden;
    }
    return newFolderInput.style.display !== 'none' && !newFolderInput.hidden;
  }

  function updateSidebarActiveClassesInPlace() {
    const isSubFeed = window.location.pathname.startsWith('/feed/subscriptions');
    document.querySelectorAll('.yt-org-folder-row').forEach(row => {
      const folderItem = row.closest('.yt-org-folder-item');
      const fid = folderItem ? folderItem.dataset.folderId : row.dataset.folderId;
      const isAct = Boolean(
        isSubFeed && fid && (
          selectedFilterFolderIds.has(fid) ||
          (selectedFilterFolderIds.size === 0 && activeFilterFolderId === fid)
        )
      );
      row.classList.toggle('yt-org-active', isAct);
    });
  }

  async function syncFromStorageChange() {
    if (suppressNextStorageSidebarRebuild) {
      suppressNextStorageSidebarRebuild = false;
      return;
    }
    if (pendingGranularSettingsSync && isNewFolderInputFocusedOrVisible()) {
      return;
    }
    if (storageReloadDebounceTimer) clearTimeout(storageReloadDebounceTimer);
    storageReloadDebounceTimer = setTimeout(async () => {
      storageReloadDebounceTimer = null;
      await loadData();
      injectSidebarSection();
      if (window.location.pathname.startsWith('/feed/subscriptions')) {
        checkAndInjectFeedFilter();
      }
      const existingBtn = document.getElementById('yt-org-tagger-toggle-btn');
      if (existingBtn) {
        const isChannelPage = window.location.pathname.startsWith('/@') || window.location.pathname.startsWith('/channel/');
        const channelInfo = isChannelPage ? extractCurrentChannelInfo() : extractWatchPageChannelInfo();
        if (channelInfo) updateTaggerButtonAppearance(existingBtn, channelInfo);
      }
    }, 120);
  }

  window.addEventListener('yt-folders-storage-updated', syncFromStorageChange);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && (changes.yt_folders || changes.yt_channels || changes.yt_settings)) {
        const onlySettingsChanged = Boolean(changes.yt_settings && !changes.yt_folders && !changes.yt_channels);
        const sameShowInSidebar = changes.yt_settings?.newValue?.showInSidebar === changes.yt_settings?.oldValue?.showInSidebar;
        if (onlySettingsChanged && sameShowInSidebar && isNewFolderInputFocusedOrVisible()) {
          if (suppressNextStorageSidebarRebuild) {
            suppressNextStorageSidebarRebuild = false;
            return;
          }
          pendingGranularSettingsSync = true;
          if (storageReloadDebounceTimer) clearTimeout(storageReloadDebounceTimer);
          storageReloadDebounceTimer = setTimeout(async () => {
            storageReloadDebounceTimer = null;
            pendingGranularSettingsSync = false;
            await loadData();
            updateSidebarActiveClassesInPlace();
            if (window.location.pathname.startsWith('/feed/subscriptions')) {
              checkAndInjectFeedFilter();
            }
          }, 120);
          return;
        }
        pendingGranularSettingsSync = false;
        syncFromStorageChange();
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if (!sender || sender.id !== chrome.runtime.id) return false;

    if (msg.action === 'PING') {
      sendResponse({ status: 'PONG', ready: true });
      return false;
    }
    if (msg.action === 'STORAGE_UPDATED') {
      syncFromStorageChange();
      return false;
    }
    if (msg.action === 'SET_FILTER_FOLDER') {
      const nextFolderId = msg.folderId || 'all';
      selectedFilterFolderIds.clear();
      if (nextFolderId !== 'all') {
        selectedFilterFolderIds.add(nextFolderId);
        mutedFilterFolderIds.delete(nextFolderId);
      }
      activeFilterFolderId = nextFolderId;
      persistFeedFilterFolderState();
      updateSidebarActiveClassesInPlace();
      updateFeedFilterChipsUI();
      applyFeedFilters();
      sendResponse({ success: true });
      return false;
    }
    if (msg.action === 'GET_YT_CONFIG') {
      let apiKey = '';
      let clientVersion = '';
      let visitorData = '';
      let sessionIndex = '0';
      let delegatedSessionId = '';
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.includes('INNERTUBE_API_KEY')) {
          const kMatch = txt.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
          if (kMatch) apiKey = kMatch[1];
          const vMatch = txt.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || txt.match(/"clientVersion":"([^"]+)"/);
          if (vMatch) clientVersion = vMatch[1];
          const visMatch = txt.match(/"VISITOR_DATA":"([^"]+)"/);
          if (visMatch) visitorData = visMatch[1];
          const idxMatch = txt.match(/"SESSION_INDEX":"(\d+)"/);
          if (idxMatch) sessionIndex = idxMatch[1];
          const pageIdMatch = txt.match(/"DELEGATED_SESSION_ID":"([^"]+)"/);
          if (pageIdMatch) delegatedSessionId = pageIdMatch[1];
          break;
        }
      }
      sendResponse({ apiKey, clientVersion, visitorData, sessionIndex, delegatedSessionId });
      return false;
    }
    if (msg.action === 'EXEC_SUBSCRIBE') {
      (async () => {
        try {
          const res = await YTSubscriptionService.executeSubscribeDirect(msg.channelId, msg.params);
          sendResponse(res);
        } catch (err) {
          sendResponse({ success: false, error: err.message, channelId: msg.channelId });
        }
      })();
      return true;
    }
    if (msg.action === 'EXEC_UNSUBSCRIBE') {
      (async () => {
        try {
          const res = await YTSubscriptionService.executeUnsubscribeDirect(msg.channelId, msg.params, {
            skipStorageSync: Boolean(msg.skipStorageSync)
          });
          sendResponse(res);
        } catch (err) {
          sendResponse({ success: false, error: err.message, channelId: msg.channelId });
        }
      })();
      return true;
    }
    if (msg.action === 'EXEC_FETCH_SUBSCRIBED_CHANNELS') {
      (async () => {
        try {
          const res = await YTSubscriptionService.executeFetchSubscribedChannelsDirect(msg.forceRefresh);
          sendResponse({
            success: true,
            channelIds: Array.from(res.channelIds || []),
            handles: Array.from(res.handles || []),
            channelsList: res.channelsList || [],
            channels: res.channels || [],
            totalExpected: res.totalExpected || 0,
            isLoggedIn: res.isLoggedIn,
            isComplete: res.isComplete !== false,
            fetchError: res.fetchError || null
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message, isComplete: false, fetchError: err.message });
        }
      })();
      return true;
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageUpdate);
  } else {
    onPageUpdate();
  }

  // Active Polling Fallback (every 800ms)
  setInterval(() => {
    if (cachedSettings?.showInSidebar !== false && !document.getElementById('yt-org-sidebar-section')) {
      injectSidebarSection();
    }
    if (cachedSettings?.showFeedFilter !== false && window.location.pathname.startsWith('/feed/subscriptions') && !document.getElementById('yt-org-feed-filter-container')) {
      checkAndInjectFeedFilter();
    }
    const pathname = window.location.pathname;
    const isChannelOrWatch = pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/watch');
    if (isChannelOrWatch) {
      checkAndInjectChannelTagger();
      monitorChannelSubscribeButtonState();
    }
    if (pathname.startsWith('/feed/channels') && !document.getElementById('yt-org-sync-banner')) {
      checkAndInjectChannelsSyncBanner();
    }
  }, 800);

})();
