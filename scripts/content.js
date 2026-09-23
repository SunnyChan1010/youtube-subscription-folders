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
  let cachedSettings = { hideWatched: false, activeFeedFolderId: 'all' };
  let activeFilterFolderId = 'all';
  let feedObserver = null;
  let isApplyingFilter = false;

  // Global floating dropdown element attached to document.body
  let globalFloatingDropdown = null;
  let currentDropdownChannelInfo = null;
  let currentDropdownTriggerBtn = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------
  async function loadData() {
    await YTFolderStorage.init();
    cachedFolders = await YTFolderStorage.getFolders();
    cachedChannels = await YTFolderStorage.getChannels();
    cachedSettings = await YTFolderStorage.getSettings();
    activeFilterFolderId = cachedSettings.activeFeedFolderId || 'all';
  }

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
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // 1. Sidebar Injection
  // ---------------------------------------------------------------------------
  function injectSidebarSection() {
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
  }

  function renderSidebarContent(container) {
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
      <ul class="yt-org-folder-list">
    `;

    cachedFolders.forEach(folder => {
      const channelCount = folder.channels ? folder.channels.length : 0;
      const isFilterActive = (window.location.pathname.startsWith('/feed/subscriptions') && activeFilterFolderId === folder.id);
      const safeDesc = escapeHtml(folder.description || folder.name);
      const safeFolderName = escapeHtml(folder.name);

      html += `
        <li class="yt-org-folder-item" data-folder-id="${folder.id}">
          <div class="yt-org-folder-row ${isFilterActive ? 'yt-org-active' : ''}" title="${safeDesc}">
            <span class="yt-org-folder-icon">${folder.icon || '📁'}</span>
            <span class="yt-org-folder-name">${safeFolderName}</span>
            <span class="yt-org-folder-badge">${channelCount}</span>
            <span class="yt-org-folder-chevron">▶</span>
          </div>
          <ul class="yt-org-channels-sublist" id="yt-org-sublist-${folder.id}">
      `;

      if (folder.channels && folder.channels.length > 0) {
        folder.channels.forEach(chId => {
          const ch = cachedChannels[chId] || { id: chId, name: chId, handle: '', avatarUrl: '' };
          const link = ch.handle ? `/${ch.handle}` : (ch.id ? `/channel/${ch.id}` : '#');
          const defaultAvatar = 'https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png';
          const safeChTitle = escapeHtml(ch.name || ch.handle || '頻道');
          const safeChTooltip = escapeHtml(ch.name || ch.handle || '');
          html += `
            <li>
              <a href="${link}" class="yt-org-channel-item" title="${safeChTooltip}">
                <img class="yt-org-channel-avatar" src="${ch.avatarUrl || defaultAvatar}" data-default-src="${defaultAvatar}" alt="" />
                <span class="yt-org-channel-title">${safeChTitle}</span>
              </a>
            </li>
          `;
        });
      } else {
        html += `
          <li style="padding: 6px 16px 6px 44px; font-size: 12px; opacity: 0.6;">(尚無頻道)</li>
        `;
      }

      html += `
          </ul>
        </li>
      `;
    });

    html += `</ul>`;
    container.innerHTML = html;

    const newFolderBtn = container.querySelector('#yt-org-btn-new-folder');
    if (newFolderBtn) {
      newFolderBtn.onclick = async (e) => {
        e.stopPropagation();
        const name = prompt('請輸入新分組名稱 (例如: 🎮 遊戲實況):');
        if (name && name.trim()) {
          await YTFolderStorage.addFolder({ name: name.trim() });
          showToast(`已建立分組「${name.trim()}」`);
        }
      };
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

      row.onclick = () => {
        if (sublist && chevron) {
          const isExpanded = sublist.classList.toggle('expanded');
          chevron.classList.toggle('expanded', isExpanded);
        }
      };

      row.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeFilterFolderId = folderId;
        YTFolderStorage.updateSettings({ activeFeedFolderId: folderId });
        if (!window.location.pathname.startsWith('/feed/subscriptions')) {
          window.location.href = `/feed/subscriptions`;
        } else {
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
    let chipsHtml = `
      <div class="yt-org-feed-filter-wrapper">
        <div class="yt-org-chips-scroll">
          <button class="yt-org-chip ${activeFilterFolderId === 'all' ? 'active' : ''}" data-folder-id="all">
            <span>全部動態</span>
          </button>
    `;

    cachedFolders.forEach(folder => {
      const count = folder.channels ? folder.channels.length : 0;
      const isActive = activeFilterFolderId === folder.id;
      chipsHtml += `
        <button class="yt-org-chip ${isActive ? 'active' : ''}" data-folder-id="${folder.id}">
          <span>${folder.icon || '📁'}</span>
          <span>${escapeHtml(folder.name)}</span>
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
        </div>
      </div>
    `;

    container.innerHTML = chipsHtml;

    container.querySelectorAll('.yt-org-chip').forEach(btn => {
      btn.onclick = () => {
        activeFilterFolderId = btn.dataset.folderId;
        YTFolderStorage.updateSettings({ activeFeedFolderId: activeFilterFolderId });
        updateFeedFilterChipsUI();
        applyFeedFilters();
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
  }

  function updateFeedFilterChipsUI() {
    const container = document.getElementById('yt-org-feed-filter-container');
    if (!container) return;
    container.querySelectorAll('.yt-org-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.folderId === activeFilterFolderId);
    });
  }

  function setupFeedObserver(gridContainer) {
    if (feedObserver) {
      feedObserver.disconnect();
    }
    const contentsEl = gridContainer.querySelector('#contents') || gridContainer.querySelector('#primary') || gridContainer;
    feedObserver = new MutationObserver(() => {
      applyFeedFilters();
    });
    feedObserver.observe(contentsEl, { childList: true, subtree: true });
  }

  function applyFeedFilters() {
    if (isApplyingFilter) return;
    isApplyingFilter = true;

    requestAnimationFrame(() => {
      try {
        const videoCards = document.querySelectorAll(
          'ytd-browse ytd-rich-item-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer'
        );

        let allowedIds = new Set();
        let allowedHandles = new Set();
        let allowedNames = new Set();

        if (activeFilterFolderId !== 'all') {
          const folder = cachedFolders.find(f => f.id === activeFilterFolderId);
          if (folder && Array.isArray(folder.channels)) {
            folder.channels.forEach(chId => {
              allowedIds.add(chId.toLowerCase());
              const ch = cachedChannels[chId];
              if (ch) {
                if (ch.handle) {
                  allowedHandles.add(ch.handle.toLowerCase().replace('@', ''));
                }
                if (ch.name) {
                  allowedNames.add(ch.name.toLowerCase().trim());
                }
              }
            });
          }
        }

        const hideWatched = Boolean(cachedSettings.hideWatched);
        let visibleCardCount = 0;

        videoCards.forEach(card => {
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

          // 2. Folder Channel Filter Check
          if (activeFilterFolderId === 'all') {
            card.classList.remove('yt-org-hidden');
            if (!card.classList.contains('yt-org-hidden-watched')) {
              visibleCardCount++;
            }
            return;
          }

          const channelLinks = card.querySelectorAll(
            'a[href*="/@"], a[href*="/channel/"], ytd-channel-name a, #channel-name a, a#avatar-link'
          );

          let matched = false;
          for (const link of channelLinks) {
            const href = (link.getAttribute('href') || '').toLowerCase();
            const text = (link.textContent || '').toLowerCase().trim();

            const handleMatch = href.match(/\/@([^\/\?]+)/);
            if (handleMatch && allowedHandles.has(handleMatch[1])) {
              matched = true;
              break;
            }

            const idMatch = href.match(/\/channel\/([^\/\?]+)/);
            if (idMatch && allowedIds.has(idMatch[1])) {
              matched = true;
              break;
            }

            if (text && allowedNames.has(text)) {
              matched = true;
              break;
            }
          }

          if (matched) {
            card.classList.remove('yt-org-hidden');
            if (!card.classList.contains('yt-org-hidden-watched')) {
              visibleCardCount++;
            }
          } else {
            card.classList.add('yt-org-hidden');
          }
        });

        // 3. Hide unrelated Shorts shelves when filtering by folder
        const shelfSections = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
        shelfSections.forEach(shelf => {
          if (activeFilterFolderId !== 'all') {
            shelf.classList.add('yt-org-hidden');
          } else {
            shelf.classList.remove('yt-org-hidden');
          }
        });

        // 4. Empty State Display
        handleFeedEmptyState(visibleCardCount);

      } finally {
        isApplyingFilter = false;
      }
    });
  }

  function handleFeedEmptyState(visibleCount) {
    const richGrid = document.querySelector('ytd-browse ytd-rich-grid-renderer, ytd-rich-grid-renderer');
    if (!richGrid) return;

    let emptyEl = document.getElementById('yt-org-feed-empty-state');

    if (activeFilterFolderId !== 'all' && visibleCount === 0) {
      const folder = cachedFolders.find(f => f.id === activeFilterFolderId);
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
      emptyEl.innerHTML = `
        <div>${folder?.icon || '📁'} <strong>「${folder?.name || ''}」</strong> 目前沒有符合條件的最新影片，或已全部觀看。</div>
        <button class="yt-org-empty-reset-btn" id="yt-org-empty-reset-btn">查看全部動態</button>
      `;
      const resetBtn = emptyEl.querySelector('#yt-org-empty-reset-btn');
      if (resetBtn) {
        resetBtn.onclick = () => {
          activeFilterFolderId = 'all';
          YTFolderStorage.updateSettings({ activeFeedFolderId: 'all' });
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
  // 3. Global Floating Dropdown Menu (immune to container overflow: hidden)
  // ---------------------------------------------------------------------------
  function getOrCreateFloatingDropdown() {
    if (globalFloatingDropdown && document.body.contains(globalFloatingDropdown)) {
      return globalFloatingDropdown;
    }
    const menu = document.createElement('div');
    menu.id = 'yt-org-global-floating-dropdown';
    menu.className = 'yt-org-floating-dropdown';
    document.body.appendChild(menu);
    globalFloatingDropdown = menu;

    document.addEventListener('click', (e) => {
      if (currentDropdownTriggerBtn && currentDropdownTriggerBtn.contains(e.target)) {
        return;
      }
      if (!menu.contains(e.target)) {
        menu.classList.remove('show');
      }
    });

    window.addEventListener('scroll', () => {
      if (menu.classList.contains('show')) {
        menu.classList.remove('show');
      }
    }, { passive: true });

    return menu;
  }

  async function openChannelFolderDropdown(btn, channelInfo) {
    const dropdown = getOrCreateFloatingDropdown();
    currentDropdownChannelInfo = channelInfo;
    currentDropdownTriggerBtn = btn;

    const memberFolderIds = await YTFolderStorage.getFoldersByChannel(channelInfo.id, channelInfo.handle);
    const safeChannelDisplayName = escapeHtml(channelInfo.name || channelInfo.handle);

    dropdown.innerHTML = `
      <div class="yt-org-dropdown-header">
        <span>選擇「${safeChannelDisplayName}」的分組</span>
        <span style="font-size: 12px; cursor: pointer; color: #ff0033;" id="yt-org-floating-dropdown-close">關閉 ✕</span>
      </div>
      <div class="yt-org-dropdown-list">
        ${cachedFolders.map(folder => {
          const isChecked = memberFolderIds.includes(folder.id);
          const safeFolderName = escapeHtml(folder.name);
          return `
            <label class="yt-org-dropdown-item">
              <input type="checkbox" class="yt-org-floating-folder-checkbox" data-folder-id="${folder.id}" ${isChecked ? 'checked' : ''} />
              <span>${folder.icon || '📁'}</span>
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

    dropdown.querySelectorAll('.yt-org-floating-folder-checkbox').forEach(chk => {
      chk.onchange = async () => {
        const folderId = chk.dataset.folderId;
        const added = await YTFolderStorage.toggleChannelInFolder(folderId, channelInfo);
        const folder = cachedFolders.find(f => f.id === folderId);
        showToast(added ? `已將頻道加入「${folder?.name}」` : `已自「${folder?.name}」移除頻道`);
        await loadData();
        updateTaggerButtonAppearance(btn, channelInfo);
      };
    });
  }

  function getPageSubscriptionState() {
    const subBtn = document.querySelector(
      'yt-subscribe-button-view-model button, subscribe-button-view-model button, #owner #subscribe-button button, ytd-subscribe-button-renderer button, #subscribe-button button'
    );
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

    const subState = getPageSubscriptionState();
    let memberFolderIds = await YTFolderStorage.getFoldersByChannel(channelInfo.id, channelInfo.handle);

    // If channel is definitely unsubscribed on YouTube, it MUST NOT be in any folder!
    if (subState === 'UNSUBSCRIBED' && memberFolderIds.length > 0) {
      await YTFolderStorage.removeChannelFromAllFolders(channelInfo.id, channelInfo.handle, channelInfo.name);
      await loadData();
      injectSidebarSection();
      memberFolderIds = [];
    }

    const hasFolders = memberFolderIds.length > 0 && subState !== 'UNSUBSCRIBED';
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
  function isVisibleActionElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (el.closest('.skeleton-bg-color, [class*="skeleton"], ytd-watch-flexy[hidden]')) return false;
    return true;
  }

  function checkAndInjectChannelTagger() {
    const pathname = window.location.pathname;
    const isChannelPage = pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/') || pathname.startsWith('/user/');
    const isWatchPage = pathname.startsWith('/watch');

    if (!isChannelPage && !isWatchPage) {
      const existing = document.getElementById('yt-org-channel-tagger-wrapper');
      if (existing) existing.remove();
      return;
    }

    let actionContainer = null;
    let channelInfo = null;

    if (isChannelPage) {
      const candidates = [
        ...document.querySelectorAll('.ytFlexibleActionsViewModelAction'),
        ...document.querySelectorAll('yt-subscribe-button-view-model'),
        ...document.querySelectorAll('subscribe-button-view-model'),
        ...document.querySelectorAll('.page-header-view-model-wiz__page-header-actions'),
        ...document.querySelectorAll('yt-page-header-view-model .page-header-view-model-wiz__page-header-headline-info'),
        ...document.querySelectorAll('ytd-page-header-renderer #buttons'),
        ...document.querySelectorAll('ytd-c4-tabbed-header-renderer #subscribe-button'),
        ...document.querySelectorAll('ytd-subscribe-button-renderer'),
        ...document.querySelectorAll('#subscribe-button')
      ];

      actionContainer = candidates.find(isVisibleActionElement) || candidates[0];
      if (!actionContainer) return;
      channelInfo = extractCurrentChannelInfo();
    } else if (isWatchPage) {
      // Under video player on watch page
      const watchCandidates = [
        ...document.querySelectorAll('ytd-watch-metadata #owner #subscribe-button'),
        ...document.querySelectorAll('#owner #subscribe-button'),
        ...document.querySelectorAll('ytd-video-owner-renderer #subscribe-button'),
        ...document.querySelectorAll('#owner yt-subscribe-button-view-model'),
        ...document.querySelectorAll('#owner subscribe-button-view-model'),
        ...document.querySelectorAll('#owner ytd-subscribe-button-renderer'),
        ...document.querySelectorAll('ytd-watch-metadata #owner'),
        ...document.querySelectorAll('#owner')
      ];

      actionContainer = watchCandidates.find(isVisibleActionElement) || watchCandidates[0];
      if (!actionContainer) return;
      channelInfo = extractWatchPageChannelInfo();
    }

    if (!channelInfo || (!channelInfo.id && !channelInfo.handle)) return;

    const channelKey = channelInfo.id || channelInfo.handle;
    const existing = document.getElementById('yt-org-channel-tagger-wrapper');

    if (existing) {
      const existingRect = existing.getBoundingClientRect();
      const isRenderedAndVisible = existing.dataset.channelKey === channelKey && (existingRect.width > 0 && existingRect.height > 0);
      if (isRenderedAndVisible) {
        // Continuously update button appearance with current live subscription state
        const existingBtn = existing.querySelector('#yt-org-tagger-toggle-btn');
        if (existingBtn) {
          updateTaggerButtonAppearance(existingBtn, channelInfo);
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
    }

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

    return { id: id || handle, name: name || handle, handle, avatarUrl };
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
        }
        const idMatch = href.match(/\/channel\/([^\/\?]+)/);
        if (idMatch) {
          id = idMatch[1];
        }
        name = linkEl.textContent?.trim() || '';
      }
    }

    // 2. Canonical author link in <head>
    if (!id) {
      const headAuthorLink = document.querySelector('link[itemprop="url"][href*="/channel/"], link[rel="canonical"][href*="/channel/"]');
      if (headAuthorLink) {
        const href = headAuthorLink.getAttribute('href') || '';
        const idMatch = href.match(/\/channel\/([^\/\?]+)/);
        if (idMatch) {
          id = idMatch[1];
        }
      }
    }

    // 3. Meta channelId in <head>
    if (!id) {
      const metaId = document.querySelector('meta[itemprop="channelId"]');
      if (metaId && metaId.getAttribute('content')) {
        id = metaId.getAttribute('content');
      }
    }

    // 4. Channel name text
    if (!name) {
      const nameEl = ownerEl?.querySelector('#attributed-channel-name, #channel-name, ytd-channel-name') ||
                     document.querySelector('ytd-watch-metadata #owner #upload-info') ||
                     document.querySelector('link[itemprop="name"]');
      if (nameEl) {
        name = nameEl.getAttribute?.('content') || nameEl.textContent?.trim() || '';
        name = name.replace(/^「|」$/g, '').trim();
      }
    }

    // 5. Avatar image
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
    return { id: id || handle, name: name || handle || id, handle, avatarUrl };
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
          discovered.push({
            id: id || handle,
            name: title || handle,
            handle,
            avatarUrl: img
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

  // Listen for YouTube's native Unsubscribe Confirmation Dialog button click & Menu items
  document.addEventListener('click', async (e) => {
    // 1. Confirm dialog button
    const isDialogConfirm = e.target.closest('#confirm-button, [dialog-confirm]') ||
      (e.target.closest('yt-confirm-dialog-renderer, ytd-confirm-dialog-renderer, tp-yt-paper-dialog, ytd-popup-container') &&
       /取消訂閱|unsubscribe/i.test(e.target.textContent || '') &&
       !/取消$|cancel/i.test(e.target.textContent || ''));

    // 2. Dropdown menu item or button explicitly labeled "取消訂閱"
    const isUnsubMenuItem = e.target.closest('ytd-menu-service-item-renderer, tp-yt-paper-item') &&
      /取消訂閱|unsubscribe/i.test(e.target.textContent || '');

    if (!isDialogConfirm && !isUnsubMenuItem) return;

    let targetChannel = null;

    // Context from recent subscribe button click (within 60 seconds)
    if (lastSubscribeActionContext && (Date.now() - lastSubscribeActionContext.timestamp < 60000)) {
      targetChannel = lastSubscribeActionContext;
    }

    // Parse from dialog text: e.g. 要取消訂閱「頻道名稱」嗎？ or Unsubscribe from ChannelName?
    const dialog = e.target.closest('yt-confirm-dialog-renderer, ytd-confirm-dialog-renderer, tp-yt-paper-dialog, ytd-popup-container');
    const dialogText = dialog?.textContent || '';
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

    // Cross-reference parsedName with cached channels
    if (parsedName && cachedChannels) {
      const matched = Object.values(cachedChannels).find(c =>
        c.name && c.name.trim().toLowerCase() === parsedName.toLowerCase()
      );
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
  async function monitorChannelSubscribeButtonState() {
    const pathname = window.location.pathname;
    const isChannelPage = pathname.startsWith('/@') || pathname.startsWith('/channel/');
    const isWatchPage = pathname.startsWith('/watch');
    if (!isChannelPage && !isWatchPage) return;

    const channelInfo = isChannelPage ? extractCurrentChannelInfo() : extractWatchPageChannelInfo();
    if (!channelInfo || (!channelInfo.id && !channelInfo.handle)) return;

    const subState = getPageSubscriptionState();
    const taggerBtn = document.getElementById('yt-org-tagger-toggle-btn');

    if (subState === 'UNSUBSCRIBED') {
      const memberFolderIds = await YTFolderStorage.getFoldersByChannel(channelInfo.id, channelInfo.handle);
      if (memberFolderIds.length > 0 || (taggerBtn && taggerBtn.classList.contains('has-folders'))) {
        const res = await YTFolderStorage.removeChannelFromAllFolders(channelInfo.id, channelInfo.handle, channelInfo.name);
        await loadData();
        injectSidebarSection();
        if (taggerBtn) {
          taggerBtn.className = 'yt-org-channel-tagger-btn';
          taggerBtn.innerHTML = `<span>📁</span><span>加入分組</span><span style="font-size: 10px; margin-left: 2px;">▼</span>`;
        }
        if (res && res.removedCount > 0) {
          showToast(`已取消訂閱「${channelInfo.name || channelInfo.handle}」，並已同步自 ${res.removedCount} 個分組移除。`);
        }
      }
    } else if (subState === 'SUBSCRIBED') {
      if (taggerBtn) {
        updateTaggerButtonAppearance(taggerBtn, channelInfo);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Master Lifecycle Handler
  // ---------------------------------------------------------------------------
  async function onPageUpdate() {
    if (globalFloatingDropdown && globalFloatingDropdown.classList.contains('show')) {
      globalFloatingDropdown.classList.remove('show');
    }
    await loadData();
    injectSidebarSection();
    checkAndInjectFeedFilter();
    checkAndInjectChannelTagger();
    checkAndInjectChannelsSyncBanner();
    monitorChannelSubscribeButtonState();
  }

  window.addEventListener('yt-navigate-finish', onPageUpdate);
  window.addEventListener('yt-page-data-updated', onPageUpdate);
  window.addEventListener('popstate', onPageUpdate);

  window.addEventListener('yt-folders-storage-updated', async () => {
    await loadData();
    injectSidebarSection();
    if (window.location.pathname.startsWith('/feed/subscriptions')) {
      checkAndInjectFeedFilter();
    }
  });

  // Safe image error handler (replaces inline onerror CSP violation)
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.dataset.defaultSrc) {
      if (e.target.src !== e.target.dataset.defaultSrc) {
        e.target.src = e.target.dataset.defaultSrc;
      }
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'PING') {
      sendResponse({ status: 'PONG', ready: true });
      return false;
    }
    if (msg.action === 'STORAGE_UPDATED') {
      onPageUpdate();
    }
    if (msg.action === 'SET_FILTER_FOLDER') {
      activeFilterFolderId = msg.folderId || 'all';
      updateFeedFilterChipsUI();
      applyFeedFilters();
      sendResponse({ success: true });
      return false;
    }
    if (msg.action === 'GET_YT_CONFIG') {
      let apiKey = '';
      let clientVersion = '';
      let visitorData = '';
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
          break;
        }
      }
      sendResponse({ apiKey, clientVersion, visitorData });
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
          const res = await YTSubscriptionService.executeUnsubscribeDirect(msg.channelId, msg.params);
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
            isLoggedIn: res.isLoggedIn
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
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
    if (!document.getElementById('yt-org-sidebar-section')) {
      injectSidebarSection();
    }
    if (window.location.pathname.startsWith('/feed/subscriptions') && !document.getElementById('yt-org-feed-filter-container')) {
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
