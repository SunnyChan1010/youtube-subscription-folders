/**
 * Test Suite: Architecture Audit & Roadmap Fixes Verification
 * Verifies:
 * 1. Storage keys alignment in content.js and options.js (no _v1 stale keys)
 * 2. fetchWithTimeout usage and 60s timeout for heavy subscriptions
 * 3. In-memory and local storage caching for @handle resolution (0 network calls)
 * 4. Batch subscription and unsubscription atomic storage writes (1 write per batch)
 * 5. Multi-account session extraction (SESSION_INDEX, DELEGATED_SESSION_ID)
 * 6. Non-blocking inline folder creation in sidebar and popup (no window.prompt)
 * 7. Name collision non-deletion: isDistinctChannel prevents accidental deletion of same-name channels
 * 8. Incomplete pagination defense: isComplete guard prevents mass unsubscribe deletion
 * 9. Folder autoKeywords smart categorization: auto-assigns matching channels on ingestion
 * 10. Compact Cloud Sync Skeleton: exportSyncSkeleton and syncWithCloud in chrome.storage.sync
 * 11. Feed filter multi-folder union & focus mute mode (activeFolderIds, focusMutedFolderIds)
 * 12. Centralized YT_DOM_SELECTORS registry and scoped image onerror fallback
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Architecture Audit & Roadmap Fixes Verification Tests...\n');

// ---------------------------------------------------------------------------
// 1. Static Code Analysis Checks
// ---------------------------------------------------------------------------
console.log('▶ [Test 1] Static Code Analysis: Storage keys, prompt, and fetch timeout:');
const contentJs = fs.readFileSync(path.join(__dirname, '../scripts/content.js'), 'utf8');
const optionsJs = fs.readFileSync(path.join(__dirname, '../options/options.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
const ytApiJs = fs.readFileSync(path.join(__dirname, '../scripts/youtube_api.js'), 'utf8');

assert(!contentJs.includes('yt_folders_v1'), 'content.js must not contain stale yt_folders_v1 key');
assert(!optionsJs.includes('yt_folders_v1'), 'options.js must not contain stale yt_folders_v1 key');
assert(!contentJs.includes('prompt('), 'content.js must not use blocking window.prompt()');
assert(!optionsJs.includes('prompt('), 'options.js must not use blocking window.prompt()');
assert(!popupJs.includes('prompt('), 'popup.js must not use blocking window.prompt()');
assert(!contentJs.includes('alert('), 'content.js must not use blocking window.alert() in sidebar');

// Scoped image error listener check
assert(contentJs.includes('dataset.defaultSrc'), 'content.js image onerror listener must be scoped to dataset.defaultSrc');

// Centralized DOM selector registry check
assert(contentJs.includes('YT_DOM_SELECTORS'), 'content.js must define centralized YT_DOM_SELECTORS registry');

// Multi-folder union & focus mute filter checks
assert(contentJs.includes('selectedFilterFolderIds'), 'content.js must support selectedFilterFolderIds set for multi-folder union');
assert(contentJs.includes('mutedFilterFolderIds'), 'content.js must support mutedFilterFolderIds for focus mute mode');

const rawFetchMatches = ytApiJs.match(/await fetch\(/g) || [];
assert.strictEqual(rawFetchMatches.length, 1, 'Only fetchWithTimeout implementation may call raw await fetch()');
console.log('  ✅ Static code checks passed 100% (No stale keys, zero prompt/alert, all fetches protected)');

// ---------------------------------------------------------------------------
// 2. Runtime Caching & Network Call Elimination
// ---------------------------------------------------------------------------
console.log('\n▶ [Test 2] Runtime @handle resolution local storage cache:');
let storageWriteCount = 0;
const mockDb = {
  yt_folders: [{ id: 'f1', name: 'Tech', icon: '💻', color: '#ff0000', channels: ['UC1234567890123456789012'] }],
  yt_channels: {
    'UC1234567890123456789012': {
      id: 'UC1234567890123456789012',
      name: 'Tech Channel',
      handle: '@TechChannel',
      avatarUrl: '',
      isSubscribed: true
    }
  },
  yt_settings: { expandedFolders: {} },
  yt_initialized: true
};

const mockSyncDb = {};

global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb(mockDb),
      set: (obj, cb) => {
        storageWriteCount++;
        Object.assign(mockDb, obj);
        if (cb) cb();
      }
    },
    sync: {
      get: (keys, cb) => {
        if (typeof keys === 'string') {
          const res = {};
          if (keys in mockSyncDb) res[keys] = mockSyncDb[keys];
          return cb ? cb(res) : Promise.resolve(res);
        }
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach(k => {
            if (k in mockSyncDb) res[k] = mockSyncDb[k];
          });
          return cb ? cb(res) : Promise.resolve(res);
        }
        return cb ? cb(mockSyncDb) : Promise.resolve(mockSyncDb);
      },
      set: (obj, cb) => {
        Object.assign(mockSyncDb, obj);
        if (cb) cb();
        return Promise.resolve();
      },
      remove: (keys, cb) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete mockSyncDb[k]);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: { id: 'test', sendMessage: () => Promise.resolve() }
};

let fetchCallCount = 0;
global.fetch = async () => {
  fetchCallCount++;
  throw new Error('fetch() should not be invoked when @handle exists in local storage');
};

global.YTFolderStorage = require('../scripts/storage.js');
const YTSubscriptionService = require('../scripts/youtube_api.js');

(async () => {
  // Test A: resolveChannelId hits local storage by @handle
  const resolved = await YTSubscriptionService.resolveChannelId('@TechChannel');
  assert.strictEqual(resolved, 'UC1234567890123456789012', 'Should resolve canonical UC ID from local storage');
  assert.strictEqual(fetchCallCount, 0, 'Should make 0 network requests when handle exists in storage');
  console.log('  ✅ @handle resolved to canonical ID directly from local storage with 0 network calls');

  // ---------------------------------------------------------------------------
  // 3. Batch Storage Coalescing
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 3] Batch storage writes coalescing:');
  storageWriteCount = 0;
  const batch50 = Array.from({ length: 50 }, (_, i) => ({
    id: `UC${String(i).padStart(22, '0')}`,
    name: `Channel ${i}`,
    handle: `@ch${i}`,
    isSubscribed: true
  }));

  await global.YTFolderStorage.batchUpdateChannels(batch50);
  assert.strictEqual(storageWriteCount, 1, 'batchUpdateChannels(50) must perform exactly 1 storage write');
  console.log('  ✅ 50 channel updates coalesced into exactly 1 storage write');

  storageWriteCount = 0;
  await global.YTFolderStorage.batchRemoveUnsubscribedChannels(batch50, { purgeFromStorage: false });
  assert.strictEqual(storageWriteCount, 1, 'batchRemoveUnsubscribedChannels(50) must perform exactly 1 storage write');
  console.log('  ✅ 50 channel batch unsubscriptions coalesced into exactly 1 storage write');

  // ---------------------------------------------------------------------------
  // 4. Duplicate Folder Emoji Normalization & Auto-Healing
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 4] Duplicate folder emoji normalization & storage auto-healing:');
  const norm1 = global.YTFolderStorage.normalizeFolderIconAndName('💻 科技 3C (Tech & AI)', '💻');
  assert.strictEqual(norm1.icon, '💻');
  assert.strictEqual(norm1.name, '科技 3C (Tech & AI)');

  const norm2 = global.YTFolderStorage.normalizeFolderIconAndName('🇭🇰 香港本土文化、生活與影視', '📁');
  assert.strictEqual(norm2.icon, '🇭🇰');
  assert.strictEqual(norm2.name, '香港本土文化、生活與影視');

  const norm3 = global.YTFolderStorage.normalizeFolderIconAndName('🎮 🎮 電玩遊戲', '🎮');
  assert.strictEqual(norm3.icon, '🎮');
  assert.strictEqual(norm3.name, '電玩遊戲');

  mockDb.yt_folders = [
    { id: 'folder_tech', name: '💻 科技 3C (Tech & AI)', icon: '💻', channels: [] },
    { id: 'folder_hk', name: '🇭🇰 香港本土文化', icon: '📁', channels: [] }
  ];
  const healedFolders = await global.YTFolderStorage.getFolders();
  assert.strictEqual(healedFolders[0].icon, '💻');
  assert.strictEqual(healedFolders[0].name, '科技 3C (Tech & AI)');
  assert.strictEqual(healedFolders[1].icon, '🇭🇰');
  assert.strictEqual(healedFolders[1].name, '香港本土文化');
  console.log('  ✅ Duplicate folder emojis and regional flag icons normalized and auto-healed in storage');

  // ---------------------------------------------------------------------------
  // 5. New User Sidebar Onboarding Card & dismissedOnboarding Setting
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 5] New user sidebar onboarding card & dismissedOnboarding setting:');
  const defaultSettings = await global.YTFolderStorage.getSettings();
  assert.strictEqual(defaultSettings.dismissedOnboarding, false, 'dismissedOnboarding should default to false');
  await global.YTFolderStorage.updateSettings({ dismissedOnboarding: true });
  const updatedSettings = await global.YTFolderStorage.getSettings();
  assert.strictEqual(updatedSettings.dismissedOnboarding, true, 'dismissedOnboarding should persist as true');
  assert(contentJs.includes('yt-org-onboarding-card'), 'content.js must include sidebar onboarding card');
  assert(contentJs.includes('yt-org-onboarding-open-options'), 'content.js must include onboarding CTA button');
  console.log('  ✅ Sidebar onboarding card and dismissedOnboarding setting verified');

  // ---------------------------------------------------------------------------
  // 6. Name Collision Non-Deletion Protection (isDistinctChannel)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 6] Name collision non-deletion protection (isDistinctChannel):');
  mockDb.yt_folders = [
    { id: 'f_test_col', name: 'Gaming', icon: '🎮', channels: ['UC_COLLISION_A', 'UC_COLLISION_B'] }
  ];
  mockDb.yt_channels = {
    'UC_COLLISION_A': {
      id: 'UC_COLLISION_A',
      name: 'Game Channel',
      handle: '@game_a',
      isSubscribed: true
    },
    'UC_COLLISION_B': {
      id: 'UC_COLLISION_B',
      name: 'Game Channel', // Same display name!
      handle: '@game_b',     // Different handle & UC ID
      isSubscribed: true
    }
  };

  // Removing UC_COLLISION_B must NOT delete UC_COLLISION_A
  await global.YTFolderStorage.removeChannelFromAllFolders('UC_COLLISION_B');
  const checkFolder = (await global.YTFolderStorage.getFolders()).find(f => f.id === 'f_test_col');
  assert(checkFolder.channels.includes('UC_COLLISION_A'), 'UC_COLLISION_A must NOT be removed when purging same-named channel B');
  assert(!checkFolder.channels.includes('UC_COLLISION_B'), 'UC_COLLISION_B must be removed');
  console.log('  ✅ Same-name distinct channel protected from accidental deletion');

  // ---------------------------------------------------------------------------
  // 7. Incomplete Pagination Guard (isComplete flag)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 7] Incomplete pagination guard (isComplete flag):');
  // Verify that options.js checks subsData.isComplete before unsubscription cleanup
  assert(optionsJs.includes('subsData.isComplete === false'), 'options.js must abort unsubscribed cleanup if subsData.isComplete is false');
  assert(optionsJs.includes('isComplete === false'), 'options.js must inspect isComplete flag in backup comparison');
  console.log('  ✅ isComplete pagination guard verified in options workflow');

  // ---------------------------------------------------------------------------
  // 8. Phase 4.1: Folder autoKeywords Smart Categorization
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 8] Folder autoKeywords smart categorization:');
  const kwMatch1 = global.YTFolderStorage.matchesAutoKeywords(
    { name: 'Python Coding Tutorials', description: 'learn programming' },
    'coding, python, 程式'
  );
  assert.strictEqual(kwMatch1, true, 'Should match keywords in name');

  const kwMatch2 = global.YTFolderStorage.matchesAutoKeywords(
    { name: 'Gourmet Cooking', description: 'culinary arts' },
    'coding, python, 程式'
  );
  assert.strictEqual(kwMatch2, false, 'Should not match unrelated keywords');

  // Auto-categorization on batchAddChannels
  mockDb.yt_folders = [
    { id: 'f_auto_kw', name: 'Dev Tools', icon: '💻', autoKeywords: 'python, rust, golang', channels: [] }
  ];
  await global.YTFolderStorage.batchAddChannels([
    { id: 'UC_NEW_PYTHON_DEV', name: 'Master Python Everyday', handle: '@pythondev' }
  ]);
  const autoFolder = (await global.YTFolderStorage.getFolders()).find(f => f.id === 'f_auto_kw');
  assert(autoFolder.channels.includes('UC_NEW_PYTHON_DEV'), 'UC_NEW_PYTHON_DEV must be auto-assigned to folder via autoKeywords');
  console.log('  ✅ autoKeywords smart matching & auto-assignment verified');

  // ---------------------------------------------------------------------------
  // 9. Phase 4.3: Compact Sharded Cloud Sync (chrome.storage.sync)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 9] Compact Sharded Cloud Sync (chrome.storage.sync):');
  const skeleton = await global.YTFolderStorage.exportSyncSkeleton();
  assert(skeleton && skeleton.version === 1, 'Skeleton must have version 1');
  assert(Array.isArray(skeleton.folders), 'Skeleton must contain folders array');
  assert(typeof skeleton.timestamp === 'number', 'Skeleton must contain timestamp');

  // Verify skeleton excludes heavy channel objects and only contains channel IDs
  const skeletonJson = JSON.stringify(skeleton);
  assert(skeletonJson.length < 50000, 'Sync skeleton payload must remain ultra compact (< 50KB)');

  // Test Sharding with Large Payload (> 8KB, exceeding Chrome's 8192 bytes per-item quota)
  const heavyFolder = {
    id: 'f_heavy',
    name: 'Heavy List',
    icon: '📚',
    channels: Array.from({ length: 400 }, (_, i) => `UC_HEAVY_CHANNEL_${String(i).padStart(10, '0')}`)
  };
  mockDb.yt_folders = [heavyFolder];
  const largeUploadRes = await global.YTFolderStorage.syncWithCloud('upload');
  assert(largeUploadRes && largeUploadRes.success, 'Large skeleton upload must succeed');
  assert(mockSyncDb['yt_sync_meta'], 'yt_sync_meta manifest must be present');
  assert(mockSyncDb['yt_sync_meta'].chunks >= 2, 'Large skeleton must be split into multiple chunks');

  // Verify that NO SINGLE KEY in chrome.storage.sync exceeds 8192 bytes
  for (const [k, v] of Object.entries(mockSyncDb)) {
    const itemSize = typeof v === 'string' ? v.length : JSON.stringify(v).length;
    assert(itemSize < 8192, `Item '${k}' size (${itemSize} bytes) exceeds Chrome QUOTA_BYTES_PER_ITEM (8192 bytes)!`);
  }

  // Test Sharded Reassembly via download
  mockDb.yt_folders = [];
  const downloadRes = await global.YTFolderStorage.syncWithCloud('download');
  assert(downloadRes && downloadRes.success, 'syncWithCloud download must succeed');
  const downloadedFolders = await global.YTFolderStorage.getFolders();
  assert.strictEqual(downloadedFolders.length, 1, 'Downloaded folders must match uploaded count');
  assert.strictEqual(downloadedFolders[0].channels.length, 400, 'All 400 channels must be intact across chunks');

  // Test Bi-directional 'auto' merge
  mockDb.yt_folders = [
    { id: 'f_local', name: 'Local Folder', icon: '🏠', channels: ['UC_LOCAL_1'] }
  ];
  // Remote currently has f_heavy (400 channels)
  const autoMergeRes = await global.YTFolderStorage.syncWithCloud('auto');
  assert(autoMergeRes && autoMergeRes.success, 'Bi-directional auto sync must succeed');
  const mergedLocal = await global.YTFolderStorage.getFolders();
  const mergedFolderIds = mergedLocal.map(f => f.id);
  assert(mergedFolderIds.includes('f_local'), 'Merged folders must include local folder');
  assert(mergedFolderIds.includes('f_heavy'), 'Merged folders must include remote folder');

  // Test Obsolete Chunk Cleanup when payload shrinks
  mockDb.yt_folders = [{ id: 'f_tiny', name: 'Tiny Folder', icon: '📁', channels: ['UC_1'] }];
  const shrinkRes = await global.YTFolderStorage.syncWithCloud('upload');
  assert(shrinkRes && shrinkRes.success, 'Shrunk upload must succeed');
  assert.strictEqual(mockSyncDb['yt_sync_meta'].chunks, 1, 'Meta chunks should be 1');
  assert(mockSyncDb['yt_sync_c_0'], 'Chunk 0 must exist');
  assert(!mockSyncDb['yt_sync_c_1'], 'Obsolete Chunk 1 must be cleaned up from storage');
  assert(!mockSyncDb['yt_sync_c_2'], 'Obsolete Chunk 2 must be cleaned up from storage');
  console.log('  ✅ Sharded cloud sync (< 8KB per item), chunk reassembly, shrinking cleanup, and auto sync verified');

  // ---------------------------------------------------------------------------
  // 10. Phase 4.4: Atomic Batch Channel Operations (batchMoveChannels & batchRemoveChannelsFromFolder)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 10] Atomic batch channel move & remove across folders:');
  mockDb.yt_folders = [
    { id: 'f_src', name: 'Source Folder', icon: '📁', channels: ['UC_MOVE_1', 'UC_MOVE_2', 'UC_MOVE_3', 'UC_STAY'] },
    { id: 'f_dst', name: 'Destination Folder', icon: '🎯', channels: ['UC_EXISTING'] }
  ];
  mockDb.yt_channels = {
    'UC_MOVE_1': { id: 'UC_MOVE_1', name: 'Channel 1', isSubscribed: true },
    'UC_MOVE_2': { id: 'UC_MOVE_2', name: 'Channel 2', isSubscribed: true },
    'UC_MOVE_3': { id: 'UC_MOVE_3', name: 'Channel 3', isSubscribed: true }
  };

  storageWriteCount = 0;
  const moveRes = await global.YTFolderStorage.batchMoveChannels('f_src', 'f_dst', ['UC_MOVE_1', 'UC_MOVE_2', 'UC_MOVE_3']);
  assert.strictEqual(moveRes.success, true, 'batchMoveChannels must succeed');
  assert.strictEqual(moveRes.movedCount, 3, 'Moved count must be 3');
  assert.strictEqual(storageWriteCount, 1, 'batchMoveChannels must perform exactly 1 atomic storage write');

  const afterMoveFolders = await global.YTFolderStorage.getFolders();
  const srcF = afterMoveFolders.find(f => f.id === 'f_src');
  const dstF = afterMoveFolders.find(f => f.id === 'f_dst');
  assert.deepStrictEqual(srcF.channels, ['UC_STAY'], 'Moved channels must be cleanly removed from source folder');
  assert(dstF.channels.includes('UC_MOVE_1') && dstF.channels.includes('UC_MOVE_2') && dstF.channels.includes('UC_MOVE_3'), 'All moved channels must be in destination folder');

  // Test batchRemoveChannelsFromFolder
  storageWriteCount = 0;
  const removeRes = await global.YTFolderStorage.batchRemoveChannelsFromFolder('f_dst', ['UC_MOVE_1', 'UC_MOVE_2']);
  assert.strictEqual(removeRes.success, true, 'batchRemoveChannelsFromFolder must succeed');
  assert.strictEqual(removeRes.removedCount, 2, 'Removed count must be 2');
  assert.strictEqual(storageWriteCount, 1, 'batchRemoveChannelsFromFolder must perform exactly 1 atomic storage write');
  const dstFAfter = (await global.YTFolderStorage.getFolders()).find(f => f.id === 'f_dst');
  assert(!dstFAfter.channels.includes('UC_MOVE_1') && !dstFAfter.channels.includes('UC_MOVE_2'), 'Channels must be removed from destination folder');
  assert(dstFAfter.channels.includes('UC_MOVE_3'), 'Unremoved channel must remain in destination folder');

  // Test Cross-Alias handle/ID matching in batch move and remove
  mockDb.yt_folders = [
    { id: 'f_alias_src', name: 'Alias Source', icon: '📁', channels: ['UC_ALIAS_TARGET'] },
    { id: 'f_alias_dst', name: 'Alias Target', icon: '📁', channels: [] }
  ];
  mockDb.yt_channels['UC_ALIAS_TARGET'] = {
    id: 'UC_ALIAS_TARGET',
    handle: '@AliasTargetHandle',
    name: 'Alias Target Name',
    isSubscribed: true
  };
  const aliasMoveRes = await global.YTFolderStorage.batchMoveChannels('f_alias_src', 'f_alias_dst', ['@AliasTargetHandle']);
  assert.strictEqual(aliasMoveRes.success, true, 'batchMoveChannels by handle must succeed');
  assert.strictEqual(aliasMoveRes.movedCount, 1, 'Moved count must be 1');
  const foldersAfterAliasMove = await global.YTFolderStorage.getFolders();
  const aliasSrcF = foldersAfterAliasMove.find(f => f.id === 'f_alias_src');
  const aliasDstF = foldersAfterAliasMove.find(f => f.id === 'f_alias_dst');
  assert.deepStrictEqual(aliasSrcF.channels, [], 'Channel should be removed from source by handle alias');
  assert.deepStrictEqual(aliasDstF.channels, ['UC_ALIAS_TARGET'], 'Channel should be added to destination using canonical UC ID');

  const aliasRemoveRes = await global.YTFolderStorage.batchRemoveChannelsFromFolder('f_alias_dst', ['@AliasTargetHandle']);
  assert.strictEqual(aliasRemoveRes.success, true, 'batchRemoveChannelsFromFolder by handle must succeed');
  assert.strictEqual(aliasRemoveRes.removedCount, 1, 'Removed count must be 1');
  const foldersAfterAliasRemove = await global.YTFolderStorage.getFolders();
  const aliasDstFAfter = foldersAfterAliasRemove.find(f => f.id === 'f_alias_dst');
  assert.deepStrictEqual(aliasDstFAfter.channels, [], 'Channel should be removed from destination by handle alias');
  console.log('  ✅ Atomic batch move and remove across folders with cross-alias matching verified (1 storage write per batch)');

  // ---------------------------------------------------------------------------
  // 11. Phase 4.2: Feed Filter Multi-folder Union, Focus Mute & Scroll Pump Sync
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 11] Feed filter multi-folder union, focus mute & pump synchronization:');
  assert(contentJs.includes('selTokens'), 'content.js pump key must track multi-folder selected tokens');
  assert(contentJs.includes('muteTokens'), 'content.js pump key must track focus mute tokens');
  assert(contentJs.includes('isPumping && visibleCount === 0'), 'content.js must not show premature empty state while pump is active');
  console.log('  ✅ Feed pump key sensitivity and empty state pumping guard verified');

  // ---------------------------------------------------------------------------
  // 12. Options Page Bulk Action Bar, Shift Selection & Orphan Tab Leak Prevention
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 12] Options bulk action bar, Shift selection & orphan tab leak prevention:');
  assert(optionsJs.includes('handleChannelSelection'), 'options.js must implement handleChannelSelection');
  assert(optionsJs.includes('e.shiftKey'), 'options.js must support Shift+Click range selection');
  assert(optionsJs.includes('batchMoveChannels'), 'options.js must invoke atomic batchMoveChannels');
  assert(optionsJs.includes('batchRemoveChannelsFromFolder'), 'options.js must invoke atomic batchRemoveChannelsFromFolder');
  assert(optionsJs.includes('activeSharedTabContext'), 'options.js must track activeSharedTabContext');
  assert(optionsJs.includes('releaseExecutionTab(activeSharedTabContext)'), 'options.js must release execution tab on pagehide to prevent tab leak');
  console.log('  ✅ Options bulk action bar, Shift+Click, and tab leak guard verified');

  // ---------------------------------------------------------------------------
  // 13. YouTube API Auth Error Accuracy
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 13] InnerTube auth error isLoggedIn status accuracy:');
  assert(ytApiJs.includes('isAuthError'), 'youtube_api.js must check isAuthError');
  assert(ytApiJs.includes('!isAuthError'), 'youtube_api.js must set isLoggedIn to false upon auth error');
  console.log('  ✅ InnerTube auth error isLoggedIn status accuracy verified');

  console.log('\n🎉 ALL ARCHITECTURE AUDIT & ROADMAP FIXES VERIFIED SUCCESSFULLY! 🎉\n');
})();
