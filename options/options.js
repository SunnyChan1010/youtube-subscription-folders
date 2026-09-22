/**
 * YouTube Subscription Folders - Options Page Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Safe image error fallback (replaces inline onerror CSP violation)
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.dataset.defaultSrc) {
      if (e.target.src !== e.target.dataset.defaultSrc) {
        e.target.src = e.target.dataset.defaultSrc;
      }
    }
  }, true);

  await YTFolderStorage.init();

  let allFolders = [];
  let allChannels = {};
  let activeFolderId = null;
  let editingFolderId = null;
  let uncategorizedChannels = [];

  // DOM Elements
  const foldersListEl = document.getElementById('folders-list-el');
  const folderCountBadge = document.getElementById('folder-count-badge');
  const channelsGridEl = document.getElementById('channels-grid-el');
  const headerFolderIcon = document.getElementById('header-folder-icon');
  const headerFolderName = document.getElementById('header-folder-name');
  const headerFolderDesc = document.getElementById('header-folder-desc');
  const inputSearchChannels = document.getElementById('input-search-channels');
  const inputAddChannelHandle = document.getElementById('input-add-channel-handle');
  const btnAddChannelSubmit = document.getElementById('btn-add-channel-submit');
  const btnCreateFolder = document.getElementById('btn-create-folder');
  const btnEditActiveFolder = document.getElementById('btn-edit-active-folder');
  const btnDeleteActiveFolder = document.getElementById('btn-delete-active-folder');
  const btnExportBackup = document.getElementById('btn-export-backup');
  const btnImportBackup = document.getElementById('btn-import-backup');
  const btnCleanDuplicates = document.getElementById('btn-clean-duplicates');

  // Modals
  const folderModal = document.getElementById('folder-modal');
  const modalFolderTitle = document.getElementById('modal-folder-title');
  const modalInputName = document.getElementById('modal-input-name');
  const modalInputIcon = document.getElementById('modal-input-icon');
  const modalInputDesc = document.getElementById('modal-input-desc');
  const modalBtnCancel = document.getElementById('modal-btn-cancel');
  const modalBtnSave = document.getElementById('modal-btn-save');

  const importModal = document.getElementById('import-modal');
  const importFileInput = document.getElementById('import-file-input');
  const importTextarea = document.getElementById('import-textarea');
  const importBtnCancel = document.getElementById('import-btn-cancel');
  const importBtnConfirm = document.getElementById('import-btn-confirm');

  // Subscribe Progress Modal
  const subscribeProgressModal = document.getElementById('subscribe-progress-modal');
  const progressModalTitle = document.getElementById('progress-modal-title');
  const progressModalChannelName = document.getElementById('progress-modal-channel-name');
  const progressModalCounter = document.getElementById('progress-modal-counter');
  const progressModalBar = document.getElementById('progress-modal-bar');
  const progressModalBtnCancel = document.getElementById('progress-modal-btn-cancel');
  let isSubscribeAborted = false;

  // Unsubscribe Confirmation Modal
  const unsubscribeConfirmModal = document.getElementById('unsubscribe-confirm-modal');
  const unsubBtnSelectAll = document.getElementById('unsub-btn-select-all');
  const unsubBtnDeselectAll = document.getElementById('unsub-btn-deselect-all');
  const unsubSelectedCounter = document.getElementById('unsub-selected-counter');
  const unsubChannelsListEl = document.getElementById('unsub-channels-list');
  const unsubModalBtnSkip = document.getElementById('unsub-modal-btn-skip');
  const unsubModalBtnConfirm = document.getElementById('unsub-modal-btn-confirm');

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg) {
    let toast = document.getElementById('opt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'opt-toast';
      toast.className = 'yt-org-toast';
      toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #222; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 13px; z-index: 10000; box-shadow: 0 4px 16px rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.3s; pointer-events: none; border-left: 4px solid #2196f3;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  }

  function parseYouTubeChannelInput(input) {
    if (!input) return null;
    const trimmed = String(input).trim();

    // Support full YouTube URLs
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('youtube.com/')) {
        const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        const path = urlObj.pathname;

        const handleMatch = path.match(/^\/(@[^\/\?]+)/);
        if (handleMatch) {
          return { id: handleMatch[1], handle: handleMatch[1] };
        }

        const channelMatch = path.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})/);
        if (channelMatch) {
          return { id: channelMatch[1], handle: '' };
        }

        const customMatch = path.match(/^\/(?:c|user)\/([^\/\?]+)/);
        if (customMatch) {
          return { id: `@${customMatch[1]}`, handle: `@${customMatch[1]}` };
        }
      }
    } catch (e) {}

    if (trimmed.startsWith('@')) {
      return { id: trimmed, handle: trimmed };
    }
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) {
      return { id: trimmed, handle: '' };
    }

    const cleanHandle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    return { id: cleanHandle, handle: cleanHandle };
  }

  async function loadData() {
    allFolders = await YTFolderStorage.getFolders();
    allChannels = await YTFolderStorage.getChannels();
    uncategorizedChannels = await YTFolderStorage.getUncategorizedChannels();

    if (!activeFolderId && allFolders.length > 0) {
      activeFolderId = allFolders[0].id;
    } else if (activeFolderId && activeFolderId !== '__uncategorized__' && !allFolders.find(f => f.id === activeFolderId)) {
      activeFolderId = allFolders.length > 0 ? allFolders[0].id : null;
    }

    renderFolders();
    renderActiveFolderChannels();
  }

  function renderFolders() {
    folderCountBadge.textContent = `${allFolders.length} 個分組`;
    foldersListEl.innerHTML = '';

    // 1. Normal Folders
    allFolders.forEach((folder, idx) => {
      const count = folder.channels ? folder.channels.length : 0;
      const isActive = folder.id === activeFolderId;

      const item = document.createElement('div');
      item.className = `folder-item ${isActive ? 'active' : ''}`;
      item.innerHTML = `
        <div class="folder-item-left">
          <span class="folder-item-icon">${folder.icon || '📁'}</span>
          <div class="folder-item-details">
            <div class="folder-item-name">${escapeHtml(folder.name)}</div>
            <div class="folder-item-meta">${count} 個頻道</div>
          </div>
        </div>
        <div class="folder-item-actions">
          <button class="btn-icon-sm btn-move-up" title="上移分組順序" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
          <button class="btn-icon-sm btn-move-down" title="下移分組順序" ${idx === allFolders.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
          <button class="btn-icon-sm btn-edit" title="編輯分組">✏️</button>
          <button class="btn-icon-sm btn-delete" title="刪除分組">🗑️</button>
        </div>
      `;

      item.onclick = () => {
        activeFolderId = folder.id;
        renderFolders();
        renderActiveFolderChannels();
      };

      item.querySelector('.btn-move-up').onclick = async (e) => {
        e.stopPropagation();
        if (idx > 0) {
          const temp = allFolders[idx];
          allFolders[idx] = allFolders[idx - 1];
          allFolders[idx - 1] = temp;
          await YTFolderStorage.setFolders(allFolders);
          renderFolders();
        }
      };

      item.querySelector('.btn-move-down').onclick = async (e) => {
        e.stopPropagation();
        if (idx < allFolders.length - 1) {
          const temp = allFolders[idx];
          allFolders[idx] = allFolders[idx + 1];
          allFolders[idx + 1] = temp;
          await YTFolderStorage.setFolders(allFolders);
          renderFolders();
        }
      };

      item.querySelector('.btn-edit').onclick = (e) => {
        e.stopPropagation();
        openEditFolderModal(folder);
      };

      item.querySelector('.btn-delete').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteFolder(folder);
      };

      foldersListEl.appendChild(item);
    });

    // 2. Smart "未分類頻道" Item
    const uncatItem = document.createElement('div');
    const isUncatActive = activeFolderId === '__uncategorized__';
    uncatItem.className = `folder-item ${isUncatActive ? 'active' : ''}`;
    uncatItem.style.borderTop = '1px dashed var(--border)';
    uncatItem.style.marginTop = '8px';
    uncatItem.innerHTML = `
      <div class="folder-item-left">
        <span class="folder-item-icon">📂</span>
        <div class="folder-item-details">
          <div class="folder-item-name">未分類頻道</div>
          <div class="folder-item-meta">${uncategorizedChannels.length} 個尚未分類</div>
        </div>
      </div>
    `;
    uncatItem.onclick = () => {
      activeFolderId = '__uncategorized__';
      renderFolders();
      renderActiveFolderChannels();
    };
    foldersListEl.appendChild(uncatItem);
  }

  function renderActiveFolderChannels(searchQuery = '') {
    // Handling Smart "Uncategorized" Folder
    if (activeFolderId === '__uncategorized__') {
      headerFolderIcon.textContent = '📂';
      headerFolderName.textContent = '未分類頻道';
      headerFolderDesc.textContent = `共 ${uncategorizedChannels.length} 個尚未指派分組的頻道，可在下方快速指派分組！`;
      btnEditActiveFolder.style.display = 'none';
      btnDeleteActiveFolder.style.display = 'none';
      inputAddChannelHandle.style.display = 'none';
      btnAddChannelSubmit.style.display = 'none';

      let displayed = uncategorizedChannels;
      const query = searchQuery.trim().toLowerCase();
      if (query) {
        displayed = displayed.filter(ch =>
          (ch.name && ch.name.toLowerCase().includes(query)) ||
          (ch.handle && ch.handle.toLowerCase().includes(query))
        );
      }

      channelsGridEl.innerHTML = '';
      if (displayed.length === 0) {
        channelsGridEl.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: #4caf50; font-size: 15px;">
            🎉 太棒了！所有頻道都已經被妥善分組，沒有未分類頻道。
          </div>
        `;
        return;
      }

      displayed.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        const defaultAvatar = 'https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png';
        const chUrl = ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`;

        const folderOptions = allFolders.map(f => `<option value="${f.id}">${f.icon || '📁'} ${escapeHtml(f.name)}</option>`).join('');

        card.innerHTML = `
          <img class="channel-card-avatar" src="${ch.avatarUrl || defaultAvatar}" data-default-src="${defaultAvatar}" alt="" />
          <div class="channel-card-info">
            <a class="channel-card-title" href="${chUrl}" target="_blank" title="在 YouTube 開啟此頻道">${escapeHtml(ch.name || ch.handle || ch.id)}</a>
            <div class="channel-card-handle">${escapeHtml(ch.handle || ch.id)}</div>
          </div>
          <div class="channel-card-actions">
            <select class="select-folder-assign input-text" style="padding: 4px 8px; font-size: 12px; width: 140px;">
              <option value="">＋指派分組...</option>
              ${folderOptions}
            </select>
          </div>
        `;

        card.querySelector('.select-folder-assign').onchange = async (e) => {
          const targetFolderId = e.target.value;
          if (targetFolderId) {
            await YTFolderStorage.addChannelToFolder(targetFolderId, ch);
            const targetFolder = allFolders.find(f => f.id === targetFolderId);
            showToast(`已將「${ch.name || ch.handle || ch.id}」指派至「${targetFolder?.name || '分組'}」`);
            await loadData();
          }
        };

        channelsGridEl.appendChild(card);
      });
      return;
    }

    // Normal Folder View
    btnEditActiveFolder.style.display = 'inline-flex';
    btnDeleteActiveFolder.style.display = 'inline-flex';
    inputAddChannelHandle.style.display = 'block';
    btnAddChannelSubmit.style.display = 'inline-flex';

    const folder = allFolders.find(f => f.id === activeFolderId);
    if (!folder) {
      headerFolderIcon.textContent = '📁';
      headerFolderName.textContent = '未選擇分組';
      headerFolderDesc.textContent = '請從左側點選一個分組進行管理';
      channelsGridEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-secondary);">
          請在左側點選或建立一個分組
        </div>
      `;
      return;
    }

    headerFolderIcon.textContent = folder.icon || '📁';
    headerFolderName.textContent = folder.name;
    headerFolderDesc.textContent = folder.description || `包含 ${folder.channels ? folder.channels.length : 0} 個頻道`;

    const channelIds = folder.channels || [];
    let displayedChannels = channelIds.map(id => allChannels[id] || { id, name: id, handle: '', avatarUrl: '' });

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      displayedChannels = displayedChannels.filter(ch =>
        (ch.name && ch.name.toLowerCase().includes(query)) ||
        (ch.handle && ch.handle.toLowerCase().includes(query)) ||
        (ch.id && ch.id.toLowerCase().includes(query))
      );
    }

    channelsGridEl.innerHTML = '';

    if (displayedChannels.length === 0) {
      channelsGridEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-secondary);">
          ${query ? `找不到符合「${query}」的頻道` : '此分組目前尚無頻道，可在上方輸入 handle (@handle) 或 ID 加入！'}
        </div>
      `;
      return;
    }

    displayedChannels.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'channel-card';
      const defaultAvatar = 'https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png';
      const chUrl = ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`;

      card.innerHTML = `
        <img class="channel-card-avatar" src="${ch.avatarUrl || defaultAvatar}" data-default-src="${defaultAvatar}" alt="" />
        <div class="channel-card-info">
          <a class="channel-card-title" href="${chUrl}" target="_blank" title="在 YouTube 開啟此頻道">${escapeHtml(ch.name || ch.handle || ch.id)}</a>
          <div class="channel-card-handle">${escapeHtml(ch.handle || ch.id)}</div>
        </div>
        <div class="channel-card-actions">
          <button class="btn-icon-sm btn-remove-channel" title="自此分組移除">✕</button>
        </div>
      `;

      card.querySelector('.btn-remove-channel').onclick = async () => {
        await YTFolderStorage.removeChannelFromFolder(folder.id, ch.id);
        showToast(`已自「${folder.name}」移除「${ch.name || ch.handle || ch.id}」`);
        await loadData();
      };

      channelsGridEl.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Folder Creation & Editing Modal
  // ---------------------------------------------------------------------------
  function openCreateFolderModal() {
    editingFolderId = null;
    modalFolderTitle.textContent = '建立新分組';
    modalInputName.value = '';
    modalInputIcon.value = '📁';
    modalInputDesc.value = '';
    folderModal.classList.add('show');
    modalInputName.focus();
  }

  function openEditFolderModal(folder) {
    editingFolderId = folder.id;
    modalFolderTitle.textContent = '編輯分組';
    modalInputName.value = folder.name || '';
    modalInputIcon.value = folder.icon || '📁';
    modalInputDesc.value = folder.description || '';
    folderModal.classList.add('show');
    modalInputName.focus();
  }

  modalBtnCancel.onclick = () => {
    folderModal.classList.remove('show');
  };

  modalBtnSave.onclick = async () => {
    const name = modalInputName.value.trim();
    const icon = modalInputIcon.value.trim() || '📁';
    const description = modalInputDesc.value.trim();

    if (!name) {
      alert('請輸入分組名稱');
      return;
    }

    if (editingFolderId) {
      await YTFolderStorage.updateFolder(editingFolderId, { name, icon, description });
    } else {
      const newFolder = await YTFolderStorage.addFolder({ name, icon, description });
      activeFolderId = newFolder.id;
    }

    folderModal.classList.remove('show');
    await loadData();
  };

  async function confirmDeleteFolder(folder) {
    if (confirm(`確定要刪除分組「${folder.name}」嗎？\n此動作不會取消訂閱頻道，僅移除此分組標籤。`)) {
      await YTFolderStorage.deleteFolder(folder.id);
      await loadData();
    }
  }

  // ---------------------------------------------------------------------------
  // Add Channel to Active Folder
  // ---------------------------------------------------------------------------
  async function handleAddChannel() {
    if (!activeFolderId || activeFolderId === '__uncategorized__') {
      alert('請先選擇一個自訂分組');
      return;
    }

    const inputVal = inputAddChannelHandle.value.trim();
    if (!inputVal) return;

    const parsed = parseYouTubeChannelInput(inputVal);
    if (!parsed) return;

    let { id, handle } = parsed;

    // Cross-reference with existing channels dictionary
    const normH = handle ? handle.replace(/^@/, '').toLowerCase() : '';
    const normId = id ? id.toLowerCase() : '';

    const existingCh = Object.values(allChannels).find(c =>
      (normId && c.id && c.id.toLowerCase() === normId) ||
      (normH && c.handle && c.handle.replace(/^@/, '').toLowerCase() === normH)
    );

    let channelName = existingCh?.name || handle || id;
    let avatarUrl = existingCh?.avatarUrl || '';

    // If channel is not yet in our dictionary, resolve canonical metadata
    if (!existingCh) {
      inputAddChannelHandle.disabled = true;
      btnAddChannelSubmit.disabled = true;
      btnAddChannelSubmit.textContent = '解析中...';
      try {
        if (typeof YTSubscriptionService !== 'undefined' && YTSubscriptionService.resolveChannelDetails) {
          const details = await YTSubscriptionService.resolveChannelDetails(inputVal);
          if (details) {
            if (details.id) id = details.id;
            if (details.name) channelName = details.name;
            if (details.handle) handle = details.handle;
            if (details.avatarUrl) avatarUrl = details.avatarUrl;
          }
        }
      } catch (err) {
        console.warn('[Options] Error resolving channel details:', err);
      } finally {
        inputAddChannelHandle.disabled = false;
        btnAddChannelSubmit.disabled = false;
        btnAddChannelSubmit.textContent = '加入頻道';
      }
    } else {
      id = existingCh.id || id;
      handle = existingCh.handle || handle;
    }

    const folder = allFolders.find(f => f.id === activeFolderId);
    await YTFolderStorage.addChannelToFolder(activeFolderId, {
      id,
      handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '',
      name: channelName,
      avatarUrl
    });

    inputAddChannelHandle.value = '';
    showToast(`已將「${channelName}」加入「${folder?.name || '分組'}」！`);
    await loadData();
  }

  btnAddChannelSubmit.onclick = handleAddChannel;
  inputAddChannelHandle.onkeydown = (e) => {
    if (e.key === 'Enter') handleAddChannel();
  };

  inputSearchChannels.oninput = (e) => {
    renderActiveFolderChannels(e.target.value);
  };

  btnCreateFolder.onclick = openCreateFolderModal;
  btnEditActiveFolder.onclick = () => {
    const folder = allFolders.find(f => f.id === activeFolderId);
    if (folder) openEditFolderModal(folder);
  };
  btnDeleteActiveFolder.onclick = () => {
    const folder = allFolders.find(f => f.id === activeFolderId);
    if (folder) confirmDeleteFolder(folder);
  };

  // ---------------------------------------------------------------------------
  // Backup Export & Import
  // ---------------------------------------------------------------------------
  btnExportBackup.onclick = async () => {
    const jsonStr = await YTFolderStorage.exportData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube_subscription_folders_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  btnImportBackup.onclick = () => {
    importFileInput.value = '';
    importTextarea.value = '';
    importModal.classList.add('show');
  };

  importBtnCancel.onclick = () => {
    importModal.classList.remove('show');
  };

  importFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        importTextarea.value = event.target.result;
      };
      reader.readAsText(file);
    }
  };

  // Drag-and-drop support for JSON backup files
  ['dragenter', 'dragover'].forEach(eventName => {
    importTextarea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      importTextarea.style.borderColor = '#2196f3';
      importTextarea.style.background = 'rgba(33, 150, 243, 0.08)';
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    importTextarea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      importTextarea.style.borderColor = '';
      importTextarea.style.background = '';
    });
  });

  importTextarea.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        importTextarea.value = event.target.result;
      };
      reader.readAsText(file);
    }
  });

  /**
   * Prompts user with a modal to select which redundant channels to unsubscribe from
   */
  function promptUnsubscribeSelection(redundantChannels) {
    return new Promise((resolve) => {
      if (!unsubscribeConfirmModal || !unsubChannelsListEl) {
        resolve([]);
        return;
      }

      unsubChannelsListEl.innerHTML = '';
      const defaultAvatar = 'https://www.gstatic.com/youtube/img/creator/avatar/default_avatar_72.png';

      // Default: select all
      const selectedMap = new Map();
      redundantChannels.forEach((ch, idx) => {
        const key = ch.id || ch.handle || `ch_${idx}`;
        selectedMap.set(key, true);
      });

      function updateUI() {
        let count = 0;
        for (const val of selectedMap.values()) {
          if (val) count++;
        }
        if (unsubSelectedCounter) {
          unsubSelectedCounter.textContent = `已選擇 ${count} / ${redundantChannels.length} 個頻道`;
        }
        if (unsubModalBtnConfirm) {
          unsubModalBtnConfirm.textContent = `確認取消所選訂閱 (${count})`;
          unsubModalBtnConfirm.disabled = count === 0;
          unsubModalBtnConfirm.style.opacity = count === 0 ? '0.5' : '1';
        }
      }

      redundantChannels.forEach((ch, idx) => {
        const row = document.createElement('div');
        row.className = 'unsub-channel-item';
        const chKey = ch.id || ch.handle || `ch_${idx}`;
        const chUrl = ch.handle ? `https://www.youtube.com/${ch.handle}` : (ch.id ? `https://www.youtube.com/channel/${ch.id}` : '#');

        row.innerHTML = `
          <input type="checkbox" class="unsub-channel-checkbox" id="unsub-chk-${idx}" checked />
          <img class="unsub-channel-avatar" src="${ch.avatarUrl || defaultAvatar}" data-default-src="${defaultAvatar}" alt="" />
          <div class="unsub-channel-info">
            <a class="unsub-channel-name" href="${chUrl}" target="_blank" title="在 YouTube 開啟此頻道">${escapeHtml(ch.name || ch.handle || ch.id)}</a>
            <div class="unsub-channel-handle">${escapeHtml(ch.handle ? ch.handle : (ch.id || ''))}</div>
          </div>
        `;

        const checkbox = row.querySelector('.unsub-channel-checkbox');
        checkbox.onchange = () => {
          selectedMap.set(chKey, checkbox.checked);
          updateUI();
        };

        unsubChannelsListEl.appendChild(row);
      });

      if (unsubBtnSelectAll) {
        unsubBtnSelectAll.onclick = () => {
          redundantChannels.forEach((ch, idx) => {
            selectedMap.set(ch.id || ch.handle || `ch_${idx}`, true);
            const el = document.getElementById(`unsub-chk-${idx}`);
            if (el) el.checked = true;
          });
          updateUI();
        };
      }

      if (unsubBtnDeselectAll) {
        unsubBtnDeselectAll.onclick = () => {
          redundantChannels.forEach((ch, idx) => {
            selectedMap.set(ch.id || ch.handle || `ch_${idx}`, false);
            const el = document.getElementById(`unsub-chk-${idx}`);
            if (el) el.checked = false;
          });
          updateUI();
        };
      }

      function cleanupAndClose(result) {
        unsubscribeConfirmModal.classList.remove('show');
        if (unsubModalBtnConfirm) unsubModalBtnConfirm.onclick = null;
        if (unsubModalBtnSkip) unsubModalBtnSkip.onclick = null;
        window.removeEventListener('keydown', onKeyDown);
        resolve(result);
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          cleanupAndClose([]);
        }
      }
      window.addEventListener('keydown', onKeyDown);

      if (unsubModalBtnConfirm) {
        unsubModalBtnConfirm.onclick = () => {
          const selected = redundantChannels.filter((ch, idx) => selectedMap.get(ch.id || ch.handle || `ch_${idx}`));
          cleanupAndClose(selected);
        };
      }

      if (unsubModalBtnSkip) {
        unsubModalBtnSkip.onclick = () => {
          cleanupAndClose([]);
        };
      }

      updateUI();
      unsubscribeConfirmModal.classList.add('show');
    });
  }

  importBtnConfirm.onclick = async () => {
    const content = importTextarea.value.trim();
    if (!content) {
      alert('請選擇檔案或貼上 JSON 內容');
      return;
    }

    const modeEl = document.querySelector('input[name="import-mode"]:checked');
    const importMode = modeEl ? modeEl.value : 'overwrite';
    const optDedupCategorized = document.getElementById('import-opt-dedup-categorized')?.checked !== false;
    const optSingleFolder = document.getElementById('import-opt-single-folder')?.checked !== false;
    const optAutoSubscribe = document.getElementById('import-opt-auto-subscribe')?.checked !== false;
    const optCheckUnsubscribed = document.getElementById('import-opt-check-unsubscribed')?.checked !== false;

    try {
      // 1. First import and deduplicate data into storage (automatically adding them to folders)
      const res = await YTFolderStorage.importData(content, {
        mergeWithExisting: importMode === 'merge',
        prioritizeCategorized: optDedupCategorized,
        singleFolderMode: optSingleFolder
      });

      importModal.classList.remove('show');

      let autoSubSummary = '';
      let unsubSummary = '';

      // 2. If Auto-Subscribe or Check-Unsubscribed is enabled, compare with YouTube subscriptions
      const shouldCheckSubs = (optAutoSubscribe || optCheckUnsubscribed);
      if (shouldCheckSubs) {
        if (subscribeProgressModal) {
          isSubscribeAborted = false;
          progressModalTitle.textContent = '🔔 正在比對 YouTube 訂閱狀態';
          progressModalChannelName.textContent = '連線 YouTube 查詢現有訂閱清單...';
          progressModalCounter.textContent = '分析中，請稍候...';
          progressModalBar.style.width = '15%';
          subscribeProgressModal.classList.add('show');

          progressModalBtnCancel.onclick = () => {
            isSubscribeAborted = true;
            progressModalChannelName.textContent = '正在取消/中斷處理...';
          };
        }

        try {
          // Compare against live YouTube subscriptions
          const cmp = await YTSubscriptionService.compareSubscriptions(res.channelsList || []);

          if (!cmp.isLoggedIn) {
            autoSubSummary = `\n• YouTube 訂閱同步：未檢測到登入狀態，頻道已全部成功加入分組，但未能自動於 YouTube 同步訂閱（登入後可使用「一鍵同步」）。`;
          } else {
            // --- Part A: Auto-subscribe to missing channels in backup ---
            if (optAutoSubscribe) {
              if (cmp.unsubscribed.length === 0) {
                autoSubSummary = `\n• YouTube 訂閱同步：備份內所有頻道 (${cmp.subscribed.length} 個) 均已在 YouTube 訂閱中。`;
              } else {
                progressModalTitle.textContent = `🔔 正在自動加入 YouTube 訂閱 (${cmp.unsubscribed.length} 個未訂閱頻道)`;
                progressModalBar.style.width = '0%';

                const batchResult = await YTSubscriptionService.batchSubscribeWithProgress(cmp.unsubscribed, {
                  delayMs: 500,
                  shouldAbort: () => isSubscribeAborted,
                  onProgress: ({ index, total, displayName, status }) => {
                    const pct = Math.round((index / total) * 100);
                    progressModalBar.style.width = `${pct}%`;
                    progressModalCounter.textContent = `${index} / ${total} (${pct}%)`;
                    if (status === 'subscribing') {
                      progressModalChannelName.textContent = `正在訂閱：${displayName}`;
                    } else if (status === 'success') {
                      progressModalChannelName.textContent = `✅ 已成功訂閱：${displayName}`;
                    } else {
                      progressModalChannelName.textContent = `⚠️ 略過/處理中：${displayName}`;
                    }
                  }
                });

                // Mark newly subscribed channels in local storage
                for (const r of batchResult.results) {
                  if (r.result && r.result.success && r.channel?.id) {
                    await YTFolderStorage.setChannelSubscribed(r.channel.id, true);
                  }
                }

                autoSubSummary = `\n• YouTube 訂閱同步：\n  - 原已訂閱：${cmp.subscribed.length} 個\n  - 本次自動新增訂閱：${batchResult.succeeded} 個`;
                if (batchResult.failed > 0) {
                  autoSubSummary += `\n  - 略過或未完成：${batchResult.failed} 個`;
                  const hasAuthError = batchResult.results.some(r => r.result && (r.result.error === 'SESSION_EXPIRED' || r.result.error === 'NOT_LOGGED_IN'));
                  if (hasAuthError) {
                    autoSubSummary += ` (原因：YouTube 登入階段已過期或未登入，請先於 YouTube 登入帳號)`;
                  }
                }
                if (isSubscribeAborted) {
                  autoSubSummary += ` (用戶已中斷剩餘訂閱)`;
                }
              }
            }

            // --- Part B: Check redundant subscriptions (absent from backup, still subscribed on YouTube) ---
            if (optCheckUnsubscribed && !isSubscribeAborted) {
              if (cmp.redundantSubscribed.length === 0) {
                unsubSummary = `\n• YouTube 訂閱清理：已訂閱頻道全部與備份一致，無已刪除之多餘訂閱。`;
              } else {
                // Temporarily hide progress modal to let user choose channels to unsubscribe
                if (subscribeProgressModal) {
                  subscribeProgressModal.classList.remove('show');
                }

                // Show confirmation modal and await user decision
                const channelsToUnsubscribe = await promptUnsubscribeSelection(cmp.redundantSubscribed);

                if (channelsToUnsubscribe && channelsToUnsubscribe.length > 0) {
                  // User chose to unsubscribe from selected channels
                  if (subscribeProgressModal) {
                    isSubscribeAborted = false;
                    progressModalTitle.textContent = `⚠️ 正在取消 YouTube 訂閱 (${channelsToUnsubscribe.length} 個頻道)`;
                    progressModalBar.style.width = '0%';
                    progressModalCounter.textContent = `0 / ${channelsToUnsubscribe.length}`;
                    progressModalChannelName.textContent = '準備執行取消訂閱...';
                    subscribeProgressModal.classList.add('show');
                  }

                  const unsubBatchResult = await YTSubscriptionService.batchUnsubscribeWithProgress(channelsToUnsubscribe, {
                    delayMs: 500,
                    shouldAbort: () => isSubscribeAborted,
                    onProgress: ({ index, total, displayName, status }) => {
                      const pct = Math.round((index / total) * 100);
                      progressModalBar.style.width = `${pct}%`;
                      progressModalCounter.textContent = `${index} / ${total} (${pct}%)`;
                      if (status === 'unsubscribing') {
                        progressModalChannelName.textContent = `正在取消訂閱：${displayName}`;
                      } else if (status === 'success') {
                        progressModalChannelName.textContent = `✅ 已成功取消訂閱：${displayName}`;
                      } else {
                        progressModalChannelName.textContent = `⚠️ 略過/處理中：${displayName}`;
                      }
                    }
                  });

                  for (const r of unsubBatchResult.results) {
                    if (r.result && r.result.success && r.channel?.id) {
                      await YTFolderStorage.setChannelSubscribed(r.channel.id, false);
                    }
                  }

                  unsubSummary = `\n• YouTube 訂閱清理（取消訂閱）：\n  - 備份已刪除之訂閱頻道：${cmp.redundantSubscribed.length} 個\n  - 本次成功取消訂閱：${unsubBatchResult.succeeded} 個`;
                  if (unsubBatchResult.failed > 0) {
                    unsubSummary += `\n  - 略過或未完成：${unsubBatchResult.failed} 個`;
                    const hasUnsubAuthError = unsubBatchResult.results.some(r => r.result && (r.result.error === 'SESSION_EXPIRED' || r.result.error === 'NOT_LOGGED_IN'));
                    if (hasUnsubAuthError) {
                      unsubSummary += ` (原因：YouTube 登入階段已過期或未登入，請先於 YouTube 登入帳號)`;
                    }
                  }
                  if (isSubscribeAborted) {
                    unsubSummary += ` (用戶已中斷剩餘處理)`;
                  }
                } else {
                  unsubSummary = `\n• YouTube 訂閱清理：已保留現有 ${cmp.redundantSubscribed.length} 個未在備份中的訂閱頻道。`;
                }
              }
            }
          }
        } catch (subErr) {
          console.error('[Options] Subscription sync error:', subErr);
          autoSubSummary = `\n• YouTube 訂閱同步：比對時發生問題 (${subErr.message})，頻道已成功匯入分組。`;
        } finally {
          if (subscribeProgressModal) {
            subscribeProgressModal.classList.remove('show');
          }
        }
      }

      let msg = `🎉 備份匯入成功！\n`;
      msg += `• 模式：${importMode === 'merge' ? '與現有分組合併' : '覆蓋現有分組'}\n`;
      msg += `• 分組總數：${res.folderCount} 組\n`;
      msg += `• 頻道總數：${res.channelCount} 個\n`;

      if (res.removedDuplicates > 0) {
        msg += `• 自動清理重複：${res.removedDuplicates} 個（已分類頻道優先保留）\n`;
        if (res.stats) {
          if (res.stats.dupUncategorizedRemoved > 0) {
            msg += `  - 清理已分類之未分類重複：${res.stats.dupUncategorizedRemoved} 個\n`;
          }
          if (res.stats.dupAcrossFolders > 0) {
            msg += `  - 清理跨分組重複：${res.stats.dupAcrossFolders} 個\n`;
          }
          if (res.stats.dupInSameFolder > 0) {
            msg += `  - 清理同分組內重複：${res.stats.dupInSameFolder} 個\n`;
          }
        }
      } else {
        msg += `• 重複檢查：無多餘重複頻道。\n`;
      }

      if (autoSubSummary) {
        msg += autoSubSummary + '\n';
      }
      if (unsubSummary) {
        msg += unsubSummary + '\n';
      }

      alert(msg);
      await loadData();
    } catch (err) {
      alert('匯入失敗，請確認 JSON 格式是否正確: ' + err.message);
    }
  };

  if (btnCleanDuplicates) {
    btnCleanDuplicates.onclick = async () => {
      if (confirm('確定要檢查並清理目前儲存庫中的重複頻道嗎？\n\n清理規則：\n1. 優先保留已加入分組（已分類）的頻道\n2. 自動清除同分組與跨分組的重複頻道項目\n3. 自動清除未分類頻道中已被歸類的重複項')) {
        try {
          const res = await YTFolderStorage.cleanDuplicates(true);
          let msg = `🧹 清理完成！\n• 目前分組數：${res.folderCount} 組\n• 頻道總數：${res.channelCount} 個\n`;
          if (res.removedCount > 0) {
            msg += `• 共清理了 ${res.removedCount} 個重複項目：\n`;
            if (res.stats.dupUncategorizedRemoved > 0) msg += `  - 刪除已分類之未分類重複：${res.stats.dupUncategorizedRemoved} 個\n`;
            if (res.stats.dupAcrossFolders > 0) msg += `  - 刪除跨分組重複：${res.stats.dupAcrossFolders} 個\n`;
            if (res.stats.dupInSameFolder > 0) msg += `  - 刪除同分組內重複：${res.stats.dupInSameFolder} 個\n`;
          } else {
            msg += `• 檢查完畢：未發現任何重複頻道。`;
          }
          alert(msg);
          await loadData();
        } catch (err) {
          alert('清理過程中發生錯誤: ' + err.message);
        }
      }
    };
  }

  // Initial Load
  await loadData();
});
