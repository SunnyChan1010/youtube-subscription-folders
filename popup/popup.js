/**
 * YouTube Subscription Folders - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  await YTFolderStorage.init();

  const folderListEl = document.getElementById('folder-list');
  const statsTextEl = document.getElementById('stats-text');
  const searchInput = document.getElementById('search-input');
  const chkHideWatched = document.getElementById('chk-hide-watched');
  const btnOpenFeed = document.getElementById('btn-open-feed');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnAddFolder = document.getElementById('btn-add-folder');
  const btnManageAll = document.getElementById('btn-manage-all');

  let allFolders = [];
  let allChannels = {};
  let currentSettings = {};

  async function refreshData() {
    allFolders = await YTFolderStorage.getFolders();
    allChannels = await YTFolderStorage.getChannels();
    currentSettings = await YTFolderStorage.getSettings();

    chkHideWatched.checked = Boolean(currentSettings.hideWatched);

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
            <span class="folder-card-icon">${folder.icon || '📁'}</span>
            <div class="folder-card-info">
              <div class="folder-card-name">${folder.name}</div>
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
          await YTFolderStorage.updateSettings({ activeFeedFolderId: folder.id });
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
          沒有找到符合「${query}」的分組或頻道
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
            <span class="folder-card-icon">${folder.icon || '📁'}</span>
            <div class="folder-card-info">
              <div class="folder-card-name">${folder.name}</div>
              <div class="folder-card-meta">${count} 個頻道</div>
            </div>
          </div>
          <button class="folder-card-feed-btn" title="在動態牆只看此分組">
            <span>📺 睇動態</span>
          </button>
        `;
        card.querySelector('.folder-card-feed-btn').onclick = async (e) => {
          e.stopPropagation();
          await YTFolderStorage.updateSettings({ activeFeedFolderId: folder.id });
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

      matchedChannels.slice(0, 25).forEach(ch => {
        const inFolders = allFolders.filter(f =>
          f.channels && (f.channels.includes(ch.id) || (ch.handle && f.channels.includes(ch.handle)))
        );

        const item = document.createElement('div');
        item.className = 'search-result-item';

        let foldersHtml = '';
        if (inFolders.length > 0) {
          foldersHtml = inFolders.map(f =>
            `<span class="search-folder-tag" data-folder-id="${f.id}" title="點擊在動態牆只看此分組">${f.icon || '📁'} ${f.name}</span>`
          ).join('');
        } else {
          foldersHtml = `<span class="search-folder-tag unassigned">尚未加入任何分組</span>`;
        }

        const defaultAvatar = 'https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png';
        item.innerHTML = `
          <div class="search-result-top">
            <img class="search-result-avatar" src="${ch.avatarUrl || defaultAvatar}" onerror="this.src='${defaultAvatar}'" />
            <div class="search-result-info">
              <div class="search-result-name">${ch.name || ch.handle}</div>
              <div class="search-result-handle">${ch.handle || ch.id}</div>
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
            await YTFolderStorage.updateSettings({ activeFeedFolderId: fId });
            openOrSwitchToFeed(fId);
          };
        });

        item.querySelector('.btn-go-channel').onclick = (e) => {
          e.stopPropagation();
          const url = ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`;
          chrome.tabs.create({ url });
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

  searchInput.addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  chkHideWatched.addEventListener('change', async (e) => {
    await YTFolderStorage.updateSettings({ hideWatched: e.target.checked });
  });

  btnOpenFeed.addEventListener('click', () => {
    openOrSwitchToFeed();
  });

  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btnManageAll.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btnAddFolder.addEventListener('click', async () => {
    const name = prompt('請輸入新分組名稱 (例如: ☕ 每日晨間新聞):');
    if (name && name.trim()) {
      await YTFolderStorage.addFolder({ name: name.trim() });
      await refreshData();
    }
  });

  await refreshData();
});
