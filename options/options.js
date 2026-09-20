/**
 * YouTube Subscription Folders - Options Page Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
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
            <div class="folder-item-name">${folder.name}</div>
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

        const folderOptions = allFolders.map(f => `<option value="${f.id}">${f.icon || '📁'} ${f.name}</option>`).join('');

        card.innerHTML = `
          <img class="channel-card-avatar" src="${ch.avatarUrl || defaultAvatar}" onerror="this.src='${defaultAvatar}'" />
          <div class="channel-card-info">
            <a class="channel-card-title" href="${chUrl}" target="_blank" title="在 YouTube 開啟此頻道">${ch.name || ch.handle || ch.id}</a>
            <div class="channel-card-handle">${ch.handle || ch.id}</div>
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
        <img class="channel-card-avatar" src="${ch.avatarUrl || defaultAvatar}" onerror="this.src='${defaultAvatar}'" />
        <div class="channel-card-info">
          <a class="channel-card-title" href="${chUrl}" target="_blank" title="在 YouTube 開啟此頻道">${ch.name || ch.handle || ch.id}</a>
          <div class="channel-card-handle">${ch.handle || ch.id}</div>
        </div>
        <div class="channel-card-actions">
          <button class="btn-icon-sm btn-remove-channel" title="自此分組移除">✕</button>
        </div>
      `;

      card.querySelector('.btn-remove-channel').onclick = async () => {
        await YTFolderStorage.removeChannelFromFolder(folder.id, ch.id);
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

    let handle = inputVal;
    let id = inputVal;

    if (inputVal.startsWith('@')) {
      handle = inputVal;
      const existingCh = Object.values(allChannels).find(c => c.handle && c.handle.toLowerCase() === inputVal.toLowerCase());
      if (existingCh) {
        id = existingCh.id;
      }
    }

    await YTFolderStorage.addChannelToFolder(activeFolderId, {
      id,
      handle: handle.startsWith('@') ? handle : `@${handle}`,
      name: handle
    });

    inputAddChannelHandle.value = '';
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

  importBtnConfirm.onclick = async () => {
    const content = importTextarea.value.trim();
    if (!content) {
      alert('請選擇檔案或貼上 JSON 內容');
      return;
    }

    try {
      const res = await YTFolderStorage.importData(content);
      alert(`備份匯入成功！共載入 ${res.folderCount} 個分組及 ${res.channelCount} 個頻道資料。`);
      importModal.classList.remove('show');
      await loadData();
    } catch (err) {
      alert('匯入失敗，請確認 JSON 格式是否正確: ' + err.message);
    }
  };

  // Initial Load
  await loadData();
});
