/**
 * Unit & Integration Tests for v1.4.0 Features & Fixes:
 * - Test 1: YTFolderStorage.updateSettings / sanitizeSettings for selectedFeedFolderIds,
 *           mutedFeedFolderIds, feedDurationFilter, invalid value rejection, and __proto__ guard.
 * - Test 2: YTFolderStorage.runAutoCategorization() for uncategorized & categorized channels,
 *           case-insensitive keyword matching, checkSystemActionTitle filtering, deduplication, and persistence.
 * - Test 3: Source verification of scripts/content.js (EXEC_FETCH_SUBSCRIBED_CHANNELS isComplete/fetchError
 *           passthrough, parseVideoDurationSeconds, yt-org-feed-search-input, yt-org-feed-duration-select,
 *           showInSidebar, showFeedFilter).
 * - Test 4: Source verification of options/options.html & options/options.js (btn-auto-categorize,
 *           runAutoCategorization) and popup/popup.html & popup/popup.js (chk-hide-shorts, chk-only-live).
 * - Test 5: C-01 ReDoS protection (isSafeRegexPattern & bounded matchesAutoKeywords).
 * - Test 6: H-01 deduplicateData & syncWithCloud preserve & sanitize autoKeywords and reject __proto__.
 * - Test 7: H-02 sanitizeAvatarUrl & sanitizeUrl host allowlists & protocol upgrades.
 * - Test 8: M-02 batchMoveChannels O(1) canonical deduplication & performance (< 150ms).
 * - Test 9: Performance & 100% Equivalence Benchmarks — P-01..P-04 (Single-IPC getAllData,
 *           auto-heal write-back, RegExp cache pool & O(1) auto-categorization < 100ms).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// 1. Mock Chrome environment
let mockStorage = {};
let mockSyncStorage = {};
let storageWriteCount = 0;
let storageReadCount = 0;

function createMockArea(getStore, onWrite, onRead) {
  return {
    get: (keys, cb) => {
      if (onRead) onRead();
      const store = getStore();
      let res = {};
      if (!keys) {
        res = { ...store };
      } else if (Array.isArray(keys)) {
        keys.forEach(k => {
          if (store[k] !== undefined) res[k] = store[k];
        });
      } else if (typeof keys === 'string') {
        if (store[keys] !== undefined) res[keys] = store[keys];
      } else if (typeof keys === 'object') {
        Object.keys(keys).forEach(k => {
          res[k] = store[k] !== undefined ? store[k] : keys[k];
        });
      }
      if (cb) cb(res);
      return Promise.resolve(res);
    },
    set: (obj, cb) => {
      if (onWrite) onWrite();
      Object.assign(getStore(), obj);
      if (cb) cb();
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      const store = getStore();
      const arr = Array.isArray(keys) ? keys : [keys];
      arr.forEach(k => { delete store[k]; });
      if (cb) cb();
      return Promise.resolve();
    }
  };
}

global.chrome = {
  storage: {
    local: createMockArea(() => mockStorage, () => { storageWriteCount++; }, () => { storageReadCount++; }),
    sync: createMockArea(() => mockSyncStorage)
  },
  runtime: {
    id: 'test-v140',
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} }
  },
  tabs: {
    query: () => Promise.resolve([])
  }
};

// 2. Load modules
const YT_INITIAL_DATA = require('../scripts/initial_data.js');
const { YT_DEFAULT_AVATAR, YTFolderUtils } = YT_INITIAL_DATA;
global.YT_INITIAL_DATA = YT_INITIAL_DATA;
global.YT_DEFAULT_AVATAR = YT_DEFAULT_AVATAR;
global.YTFolderUtils = YTFolderUtils;
global.isSystemActionTitle = YT_INITIAL_DATA.isSystemActionTitle;
const YTFolderStorage = require('../scripts/storage.js');

async function runTests() {
  console.log('🚀 Starting v1.4.0 Features & Fixes Verification Tests...\n');

  // ---------------------------------------------------------------------------
  // Test 1: updateSettings & sanitizeSettings for v1.4.0 Feed Filter Settings
  // ---------------------------------------------------------------------------
  console.log('▶ [Test 1] YTFolderStorage.updateSettings & sanitizeSettings (selectedFeedFolderIds, mutedFeedFolderIds, feedDurationFilter):');
  mockStorage = {};
  await YTFolderStorage.init();

  const initialSettings = await YTFolderStorage.getSettings();
  assert(Array.isArray(initialSettings.selectedFeedFolderIds), 'selectedFeedFolderIds should default to an array');
  assert.strictEqual(initialSettings.selectedFeedFolderIds.length, 0, 'selectedFeedFolderIds should default to empty array');
  assert(Array.isArray(initialSettings.mutedFeedFolderIds), 'mutedFeedFolderIds should default to an array');
  assert.strictEqual(initialSettings.mutedFeedFolderIds.length, 0, 'mutedFeedFolderIds should default to empty array');
  assert.strictEqual(initialSettings.feedDurationFilter, 'all', 'feedDurationFilter should default to "all"');

  // Sanitize & deduplicate valid arrays + valid duration
  const updated = await YTFolderStorage.updateSettings({
    selectedFeedFolderIds: ['folder_tech', 'folder_gaming', 'folder_tech', '', '   ', null, undefined, 42],
    mutedFeedFolderIds: ['folder_music', 'folder_music', '', false],
    feedDurationFilter: 'short'
  });

  assert.deepStrictEqual(
    updated.selectedFeedFolderIds,
    ['folder_tech', 'folder_gaming'],
    'selectedFeedFolderIds must keep only non-empty deduplicated strings'
  );
  assert.deepStrictEqual(
    updated.mutedFeedFolderIds,
    ['folder_music'],
    'mutedFeedFolderIds must keep only non-empty deduplicated strings'
  );
  assert.strictEqual(updated.feedDurationFilter, 'short', 'feedDurationFilter must accept "short"');

  // Verify all valid feedDurationFilter values
  for (const mode of ['all', 'short', 'medium', 'long']) {
    const s = await YTFolderStorage.updateSettings({ feedDurationFilter: mode });
    assert.strictEqual(s.feedDurationFilter, mode, `feedDurationFilter should accept "${mode}"`);
  }

  // Reject invalid values
  const beforeInvalid = await YTFolderStorage.getSettings();
  const afterInvalid = await YTFolderStorage.updateSettings({
    selectedFeedFolderIds: 'invalid-string',
    mutedFeedFolderIds: { bad: true },
    feedDurationFilter: 'ultra_long'
  });
  assert.deepStrictEqual(afterInvalid.selectedFeedFolderIds, beforeInvalid.selectedFeedFolderIds, 'Invalid selectedFeedFolderIds must be rejected');
  assert.deepStrictEqual(afterInvalid.mutedFeedFolderIds, beforeInvalid.mutedFeedFolderIds, 'Invalid mutedFeedFolderIds must be rejected');
  assert.strictEqual(afterInvalid.feedDurationFilter, beforeInvalid.feedDurationFilter, 'Invalid feedDurationFilter must be rejected');

  // Prototype pollution check
  const protoPayload = JSON.parse('{"__proto__":{"pollutedV140":true},"constructor":{"pollutedV140":true},"selectedFeedFolderIds":["f_safe"],"feedDurationFilter":"medium"}');
  const cleanProto = YTFolderStorage.sanitizeSettings(protoPayload);
  assert.strictEqual(({}).pollutedV140, undefined, 'Object.prototype must not be polluted via sanitizeSettings');
  assert.deepStrictEqual(cleanProto.selectedFeedFolderIds, ['f_safe']);
  assert.strictEqual(cleanProto.feedDurationFilter, 'medium');
  console.log('  ✅ Test 1 Passed: Settings sanitization, deduplication, and prototype guard verified');

  // ---------------------------------------------------------------------------
  // Test 2: YTFolderStorage.runAutoCategorization()
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 2] YTFolderStorage.runAutoCategorization() smart keyword categorization:');
  assert.strictEqual(typeof YTFolderStorage.runAutoCategorization, 'function', 'runAutoCategorization must be exported on YTFolderStorage');

  mockStorage = {
    yt_initialized: true,
    yt_folders: [
      {
        id: 'folder_tech',
        name: '科技 3C',
        icon: '💻',
        color: '#2196f3',
        autoKeywords: ['Python', 'AI', 'tech'],
        channels: ['UC_ALREADY_TECH']
      },
      {
        id: 'folder_gaming',
        name: '電玩遊戲',
        icon: '🎮',
        color: '#4caf50',
        autoKeywords: ['Gaming', 'RPG', '電玩'],
        channels: []
      }
    ],
    yt_channels: {
      'UC_ALREADY_TECH': {
        id: 'UC_ALREADY_TECH',
        name: 'Tech & RPG Channel',
        handle: '@tech_rpg',
        isSubscribed: true
      },
      'UC_UNCAT_PYTHON': {
        id: 'UC_UNCAT_PYTHON',
        name: 'Learn python & ai daily',
        handle: '@pydaily',
        isSubscribed: true
      },
      'UC_UNCAT_GAMER': {
        id: 'UC_UNCAT_GAMER',
        name: 'Speedrun Central',
        handle: '@pro_gaming_hub',
        isSubscribed: true
      },
      'UC_DIRTY_ACTION': {
        id: 'UC_DIRTY_ACTION',
        name: '建立貼文',
        handle: '@python_system_action',
        isSubscribed: true
      },
      'UC_UNCAT_COOKING': {
        id: 'UC_UNCAT_COOKING',
        name: 'Chef Kitchen',
        handle: '@chefkitchen',
        isSubscribed: true
      }
    },
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  // 2A: Default { includeCategorized: false } only categorizes uncategorized channels
  storageWriteCount = 0;
  const autoRes1 = await YTFolderStorage.runAutoCategorization();
  assert.strictEqual(autoRes1.success, true, 'runAutoCategorization should return success: true');
  assert.strictEqual(autoRes1.matchedChannelsCount, 2, 'Should match 2 uncategorized channels (UC_UNCAT_PYTHON and UC_UNCAT_GAMER)');
  assert.strictEqual(autoRes1.totalAssignments, 2, 'Should make 2 folder assignments');
  assert(Array.isArray(autoRes1.affectedFolderIds), 'affectedFolderIds should be an array');
  assert(autoRes1.affectedFolderIds.includes('folder_tech'), 'folder_tech should be in affectedFolderIds');
  assert(autoRes1.affectedFolderIds.includes('folder_gaming'), 'folder_gaming should be in affectedFolderIds');
  assert(storageWriteCount >= 1, 'Changes must be persisted to storage');

  const foldersAfter1 = await YTFolderStorage.getFolders();
  const fTech1 = foldersAfter1.find(f => f.id === 'folder_tech');
  const fGaming1 = foldersAfter1.find(f => f.id === 'folder_gaming');
  assert(fTech1.channels.includes('UC_UNCAT_PYTHON'), 'UC_UNCAT_PYTHON should be added to folder_tech');
  assert(!fTech1.channels.includes('UC_DIRTY_ACTION'), 'Dirty system action title channel must be skipped');
  assert(fGaming1.channels.includes('UC_UNCAT_GAMER'), 'UC_UNCAT_GAMER should be added to folder_gaming via handle match');
  assert(!fGaming1.channels.includes('UC_ALREADY_TECH'), 'Already-categorized channel should not be processed when includeCategorized is false');

  // 2B: Re-running with { includeCategorized: false } produces 0 duplicate assignments
  const autoRes2 = await YTFolderStorage.runAutoCategorization({ includeCategorized: false });
  assert.strictEqual(autoRes2.success, true);
  assert.strictEqual(autoRes2.matchedChannelsCount, 0, 'No remaining uncategorized channels should match');
  assert.strictEqual(autoRes2.totalAssignments, 0, 'Zero duplicate assignments');
  assert.deepStrictEqual(autoRes2.affectedFolderIds, []);

  // 2C: Running with { includeCategorized: true } evaluates already-categorized channels without duplicating existing entries
  const autoRes3 = await YTFolderStorage.runAutoCategorization({ includeCategorized: true });
  assert.strictEqual(autoRes3.success, true);
  assert.strictEqual(autoRes3.matchedChannelsCount, 1, 'UC_ALREADY_TECH should match folder_gaming when includeCategorized is true');
  assert.strictEqual(autoRes3.totalAssignments, 1, 'Only 1 new assignment should be made (not duplicated in folder_tech)');
  assert.deepStrictEqual(autoRes3.affectedFolderIds, ['folder_gaming']);

  const foldersAfter3 = await YTFolderStorage.getFolders();
  const fTech3 = foldersAfter3.find(f => f.id === 'folder_tech');
  const fGaming3 = foldersAfter3.find(f => f.id === 'folder_gaming');
  assert.strictEqual(
    fTech3.channels.filter(id => id === 'UC_ALREADY_TECH').length,
    1,
    'UC_ALREADY_TECH must not be duplicated in folder_tech'
  );
  assert(fGaming3.channels.includes('UC_ALREADY_TECH'), 'UC_ALREADY_TECH must now also be in folder_gaming');
  console.log('  ✅ Test 2 Passed: runAutoCategorization uncategorized/categorized modes, dirty title skip, and deduplication verified');

  // ---------------------------------------------------------------------------
  // Test 3: Source Verification of scripts/content.js
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 3] Source verification of scripts/content.js:');
  const contentJs = fs.readFileSync(path.join(__dirname, '../scripts/content.js'), 'utf8');

  assert(
    contentJs.includes('isComplete: res.isComplete !== false'),
    'content.js EXEC_FETCH_SUBSCRIBED_CHANNELS response must include isComplete: res.isComplete !== false'
  );
  assert(
    contentJs.includes('fetchError: res.fetchError || null'),
    'content.js EXEC_FETCH_SUBSCRIBED_CHANNELS response must include fetchError: res.fetchError || null'
  );
  assert(
    contentJs.includes('parseVideoDurationSeconds'),
    'content.js must implement parseVideoDurationSeconds'
  );
  assert(
    contentJs.includes('yt-org-feed-search-input'),
    'content.js must include yt-org-feed-search-input'
  );
  assert(
    contentJs.includes('yt-org-feed-duration-select'),
    'content.js must include yt-org-feed-duration-select'
  );
  assert(
    contentJs.includes('showInSidebar'),
    'content.js must respect showInSidebar setting'
  );
  assert(
    contentJs.includes('showFeedFilter'),
    'content.js must respect showFeedFilter setting'
  );
  console.log('  ✅ Test 3 Passed: scripts/content.js pagination integrity, duration filter, search input, and visibility flags verified');

  // ---------------------------------------------------------------------------
  // Test 4: Source Verification of options/* and popup/*
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 4] Source verification of options/* and popup/*:');
  const optionsHtml = fs.readFileSync(path.join(__dirname, '../options/options.html'), 'utf8');
  const optionsJs = fs.readFileSync(path.join(__dirname, '../options/options.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');

  assert(optionsHtml.includes('btn-auto-categorize'), 'options.html must contain #btn-auto-categorize button');
  assert(optionsJs.includes('btn-auto-categorize'), 'options.js must bind #btn-auto-categorize');
  assert(optionsJs.includes('runAutoCategorization'), 'options.js must call YTFolderStorage.runAutoCategorization');

  assert(popupHtml.includes('chk-hide-shorts'), 'popup.html must contain #chk-hide-shorts checkbox');
  assert(popupHtml.includes('chk-only-live'), 'popup.html must contain #chk-only-live checkbox');
  assert(popupJs.includes('chk-hide-shorts'), 'popup.js must bind #chk-hide-shorts');
  assert(popupJs.includes('chk-only-live'), 'popup.js must bind #chk-only-live');
  console.log('  ✅ Test 4 Passed: options/* auto-categorize button and popup/* quick filter toggles verified');

  // ---------------------------------------------------------------------------
  // Test 5: C-01 ReDoS Protection (isSafeRegexPattern & matchesAutoKeywords)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 5] C-01 ReDoS Protection (isSafeRegexPattern & matchesAutoKeywords):');
  assert.strictEqual(typeof YTFolderStorage.isSafeRegexPattern, 'function', 'YTFolderStorage.isSafeRegexPattern must be exported');
  assert.strictEqual(typeof YTFolderUtils.isSafeRegexPattern, 'function', 'YTFolderUtils.isSafeRegexPattern must be exported');

  assert.strictEqual(
    YTFolderStorage.isSafeRegexPattern('(a+)+', 'i'),
    false,
    'Nested quantifier (a+)+ must be rejected as unsafe'
  );
  assert.strictEqual(
    YTFolderStorage.isSafeRegexPattern('([a-zA-Z0-9]+\\s*)+$', 'i'),
    false,
    'Nested quantifier ([a-zA-Z0-9]+\\s*)+$ must be rejected as unsafe'
  );
  assert.strictEqual(
    YTFolderUtils.isSafeRegexPattern('(a+)+', 'i'),
    false,
    'YTFolderUtils.isSafeRegexPattern must also reject (a+)+'
  );

  const redosStart = performance.now();
  const redosMatch = YTFolderStorage.matchesAutoKeywords(
    { name: 'a'.repeat(80) + '!' },
    ['/(a+)+$/i']
  );
  const redosElapsed = performance.now() - redosStart;
  assert.strictEqual(redosMatch, false, 'Catastrophic backtracking regex keyword must return false');
  assert(
    redosElapsed < 25,
    `ReDoS payload evaluation must complete in < 25ms, took ${redosElapsed.toFixed(2)}ms`
  );

  assert.strictEqual(
    YTFolderStorage.matchesAutoKeywords({ name: 'Tech Linked' }, ['/^(tech|ai)\\b/i']),
    true,
    'Legitimate regex keyword /^(tech|ai)\\b/i must still match "Tech Linked"'
  );
  assert.strictEqual(
    YTFolderStorage.matchesAutoKeywords({ name: 'Tech Linked' }, ['/^(tech|ai)\\b/gi']),
    true,
    'Stateful /g flag on regex keyword must be safely stripped and match reliably (call 1)'
  );
  assert.strictEqual(
    YTFolderStorage.matchesAutoKeywords({ name: 'Tech Linked' }, ['/^(tech|ai)\\b/gi']),
    true,
    'Stateful /g flag on regex keyword must match reliably on consecutive invocations (call 2)'
  );
  console.log(`  ✅ Test 5 Passed: C-01 ReDoS guard verified (${redosElapsed.toFixed(2)}ms < 25ms)`);

  // ---------------------------------------------------------------------------
  // Test 6: H-01 deduplicateData & syncWithCloud Preserve & Sanitize autoKeywords
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 6] H-01 deduplicateData & syncWithCloud preserve & sanitize autoKeywords:');

  // 6A: cleanDuplicates() preserves folder.autoKeywords 100%
  mockStorage = {
    yt_initialized: true,
    yt_folders: [
      {
        id: 'folder_dedup_kw',
        name: 'AI Research',
        icon: '🤖',
        color: '#673ab7',
        autoKeywords: ['LLM', 'Transformer', '/^deepmind/i'],
        channels: ['UC_DUP_1', 'UC_DUP_1', '@dup1']
      }
    ],
    yt_channels: {
      'UC_DUP_1': { id: 'UC_DUP_1', name: 'DeepMind Lab', handle: '@dup1', isSubscribed: true }
    },
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  const cleanRes = await YTFolderStorage.cleanDuplicates();
  assert(cleanRes.removedCount >= 1, 'cleanDuplicates should remove duplicate channel references');
  const foldersAfterClean = await YTFolderStorage.getFolders();
  const fAfterClean = foldersAfterClean.find(f => f.id === 'folder_dedup_kw');
  assert(fAfterClean, 'folder_dedup_kw must exist after cleanDuplicates');
  assert.deepStrictEqual(
    fAfterClean.autoKeywords,
    ['LLM', 'Transformer', '/^deepmind/i'],
    'cleanDuplicates must preserve folder.autoKeywords 100%'
  );

  // 6B: importData() preserves folder.autoKeywords 100%
  const backupPayload = JSON.stringify({
    version: 2,
    folders: [
      {
        id: 'folder_imported_kw',
        name: 'Cyber Security',
        icon: '🛡️',
        color: '#009688',
        autoKeywords: ['AppSec', 'ZeroDay', 'OWASP'],
        channels: ['UC_SEC_1', 'UC_SEC_1']
      }
    ],
    channels: {
      'UC_SEC_1': { id: 'UC_SEC_1', name: 'OWASP Foundation', handle: '@owasp', isSubscribed: true }
    }
  });

  await YTFolderStorage.importData(backupPayload, { mergeWithExisting: false });
  const foldersAfterImport = await YTFolderStorage.getFolders();
  const fAfterImport = foldersAfterImport.find(f => f.id === 'folder_imported_kw');
  assert(fAfterImport, 'folder_imported_kw must exist after importData');
  assert.deepStrictEqual(
    fAfterImport.autoKeywords,
    ['AppSec', 'ZeroDay', 'OWASP'],
    'importData must preserve folder.autoKeywords 100%'
  );

  // 6C: syncWithCloud('download') sanitizes remote colors/icons, strips system action channels, and blocks '__proto__' IDs
  mockStorage = {
    yt_initialized: true,
    yt_folders: [
      {
        id: 'folder_existing_local',
        name: 'Existing Local',
        icon: '📂',
        color: '#4caf50',
        autoKeywords: ['LocalKW'],
        channels: ['UC_LOCAL_1']
      }
    ],
    yt_channels: {},
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  mockSyncStorage = {
    yt_folders_sync_skeleton: JSON.parse(JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      folders: [
        {
          id: '__proto__',
          name: 'Prototype Pollution Attempt',
          icon: '💀',
          color: '#000000',
          autoKeywords: ['polluted'],
          channels: ['UC_EVIL']
        },
        {
          id: 'constructor',
          name: 'Constructor Pollution Attempt',
          icon: '💀',
          color: '#000000',
          channels: ['UC_EVIL_2']
        },
        {
          id: 'folder_remote_untrusted',
          name: 'Remote Folder',
          icon: '<>"\'&',
          color: 'javascript:alert(1)',
          autoKeywords: ['  CloudKW  ', '', '   '],
          channels: ['UC_REMOTE_CLEAN', 'Create post', '建立貼文', '__proto__', 'constructor']
        },
        {
          id: 'folder_existing_local',
          name: 'Existing Local',
          icon: '📂',
          color: '#4caf50',
          autoKeywords: ['MergedKW', '   '],
          channels: ['UC_MERGED_VALID', 'Create post', '__proto__']
        }
      ]
    }))
  };

  const syncDownRes = await YTFolderStorage.syncWithCloud('download');
  assert.strictEqual(syncDownRes.success, true, 'syncWithCloud("download") must succeed');
  const syncedFolders = await YTFolderStorage.getFolders();

  assert(
    !syncedFolders.some(f => f.id === '__proto__' || f.id === 'constructor' || f.id === 'prototype'),
    'syncWithCloud must reject or rewrite __proto__/constructor/prototype folder IDs'
  );
  assert.strictEqual(({}).polluted, undefined, 'Object.prototype must remain clean after syncWithCloud');

  const remoteSynced = syncedFolders.find(f => f.id === 'folder_remote_untrusted');
  assert(remoteSynced, 'Valid remote folder must be downloaded');
  assert.strictEqual(remoteSynced.color, '#2196f3', 'Invalid remote folder color must be sanitized to #2196f3');
  assert.strictEqual(remoteSynced.icon, '📁', 'Unsafe HTML chars in remote folder icon must be sanitized to fallback 📁');
  assert.deepStrictEqual(remoteSynced.autoKeywords, ['CloudKW'], 'Remote autoKeywords must be trimmed and non-empty');
  assert(remoteSynced.channels.includes('UC_REMOTE_CLEAN'), 'Clean remote channel must be preserved');
  assert(!remoteSynced.channels.includes('Create post'), 'Dirty system action "Create post" must be stripped in syncWithCloud');
  assert(!remoteSynced.channels.includes('建立貼文'), 'Dirty system action "建立貼文" must be stripped in syncWithCloud');
  assert(!remoteSynced.channels.includes('__proto__'), '__proto__ channel entry must be stripped in syncWithCloud');

  const mergedExisting = syncedFolders.find(f => f.id === 'folder_existing_local');
  assert(mergedExisting, 'Existing local folder must remain intact');
  assert(mergedExisting.channels.includes('UC_LOCAL_1'), 'Existing local channel must remain');
  assert(mergedExisting.channels.includes('UC_MERGED_VALID'), 'Clean merged remote channel must be added');
  assert(!mergedExisting.channels.includes('Create post'), 'Dirty system action must not be merged into existing folder');
  assert(mergedExisting.autoKeywords.includes('LocalKW') && mergedExisting.autoKeywords.includes('MergedKW'), 'Merged autoKeywords must retain local and valid remote keywords');
  console.log('  ✅ Test 6 Passed: deduplicateData & syncWithCloud preserve autoKeywords and sanitize untrusted remote data');

  // ---------------------------------------------------------------------------
  // Test 7: H-02 sanitizeAvatarUrl & sanitizeUrl Allowlists
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 7] H-02 sanitizeAvatarUrl & sanitizeUrl host allowlists:');
  assert.strictEqual(
    YTFolderStorage.sanitizeAvatarUrl('https://evil-tracker.org/beacon.png'),
    '',
    'External tracking avatar domain must be blocked by YTFolderStorage.sanitizeAvatarUrl'
  );
  assert.strictEqual(
    YTFolderUtils.sanitizeAvatarUrl('https://evil-tracker.org/beacon.png'),
    '',
    'External tracking avatar domain must be blocked by YTFolderUtils.sanitizeAvatarUrl'
  );
  assert.strictEqual(
    YTFolderStorage.sanitizeAvatarUrl('http://yt3.ggpht.com/ytc/avatar123'),
    'https://yt3.ggpht.com/ytc/avatar123',
    'http://yt3.ggpht.com avatar URL must be upgraded to https://'
  );
  assert.strictEqual(
    YTFolderStorage.sanitizeAvatarUrl(YT_DEFAULT_AVATAR),
    YT_DEFAULT_AVATAR,
    'Local base64 SVG YT_DEFAULT_AVATAR must be allowed'
  );

  assert.strictEqual(
    YTFolderUtils.sanitizeUrl('https://evil-phish.org/login'),
    '#',
    'Non-YouTube external URL must be blocked to "#"'
  );
  assert.strictEqual(
    YTFolderUtils.sanitizeUrl('//evil.org/x'),
    '#',
    'Protocol-relative URL must be blocked to "#"'
  );
  assert.strictEqual(
    YTFolderUtils.sanitizeUrl('javascript:alert(1)'),
    '#',
    'javascript: pseudo-protocol URL must be blocked to "#"'
  );
  assert.strictEqual(
    YTFolderUtils.sanitizeUrl('/@mkbhd'),
    '/@mkbhd',
    'Relative YouTube channel path /@mkbhd must be allowed'
  );
  assert.strictEqual(
    YTFolderUtils.sanitizeUrl('https://www.youtube.com/@mkbhd'),
    'https://www.youtube.com/@mkbhd',
    'https://www.youtube.com/@mkbhd must be allowed'
  );
  console.log('  ✅ Test 7 Passed: sanitizeAvatarUrl & sanitizeUrl strict host allowlists verified');

  // ---------------------------------------------------------------------------
  // Test 8: M-02 batchMoveChannels O(1) Canonical Dedup & Performance
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 8] M-02 batchMoveChannels O(1) canonical dedup & performance:');
  const perfChannels = {};
  const srcChannels = [];
  const existingDstChannels = [];
  const moveSelection = [];

  for (let i = 0; i < 200; i++) {
    const cid = `UC_PERF_CH_${String(i).padStart(4, '0')}`;
    const handle = `@perf_creator_${i}`;
    perfChannels[cid] = {
      id: cid,
      name: `Performance Creator ${i}`,
      handle,
      avatarUrl: '',
      isSubscribed: true
    };
    srcChannels.push(cid);
    if (i < 50) {
      // Seed target folder with 50 overlapping channels (mix of UC IDs and @handles)
      existingDstChannels.push(i % 2 === 0 ? cid : handle);
    }
    if (i < 150) {
      // Move 150 channels (50 overlapping + 100 new; mix handles & IDs to test canonical dedup)
      moveSelection.push(i % 3 === 0 ? handle : cid);
    }
  }

  mockStorage = {
    yt_initialized: true,
    yt_folders: [
      { id: 'folder_perf_src', name: 'Source 200', icon: '📥', color: '#2196f3', autoKeywords: [], channels: srcChannels },
      { id: 'folder_perf_dst', name: 'Target 50', icon: '📤', color: '#4caf50', autoKeywords: [], channels: existingDstChannels }
    ],
    yt_channels: perfChannels,
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  const moveStart = performance.now();
  const moveRes = await YTFolderStorage.batchMoveChannels('folder_perf_src', 'folder_perf_dst', moveSelection);
  const moveElapsed = performance.now() - moveStart;

  assert.strictEqual(moveRes.success, true, 'batchMoveChannels must succeed');
  assert.strictEqual(moveRes.movedCount, 100, 'movedCount must equal 100 (150 selected minus 50 overlapping)');

  const perfFoldersAfter = await YTFolderStorage.getFolders();
  const dstAfter = perfFoldersAfter.find(f => f.id === 'folder_perf_dst');
  const srcAfter = perfFoldersAfter.find(f => f.id === 'folder_perf_src');

  assert.strictEqual(dstAfter.channels.length, 150, 'Target folder must have exactly 150 channels with zero duplicates');
  assert.strictEqual(srcAfter.channels.length, 50, 'Source folder must have 50 remaining channels');
  assert(
    moveElapsed < 150,
    `batchMoveChannels for 200 channels must complete in < 150ms, took ${moveElapsed.toFixed(2)}ms`
  );
  console.log(`  ✅ Test 8 Passed: batchMoveChannels O(1) dedup verified (movedCount=100, total=150, ${moveElapsed.toFixed(2)}ms < 150ms)`);

  // ---------------------------------------------------------------------------
  // Test 9: Performance & 100% Equivalence Benchmarks — P-01..P-04
  // ---------------------------------------------------------------------------
  console.log('\n▶ [Test 9] Performance & 100% Equivalence Benchmarks — P-01..P-04:');
  assert.strictEqual(
    typeof YTFolderStorage.computeUncategorizedChannels,
    'function',
    'YTFolderStorage.computeUncategorizedChannels must be exported'
  );
  assert.strictEqual(
    typeof YTFolderStorage.getCompiledSafeRegex,
    'function',
    'YTFolderStorage.getCompiledSafeRegex must be exported'
  );

  // --- 9a: Single-IPC getAllData & 100% Equivalence with getUncategorizedChannels ---
  const p9aChannels = {};
  const p9aFolders = Array.from({ length: 10 }, (_, idx) => ({
    id: `folder_p9a_${idx}`,
    name: `Category ${idx}`,
    icon: '📁',
    color: '#2196f3',
    autoKeywords: [],
    channels: []
  }));

  for (let i = 0; i < 300; i++) {
    const cid = `UC_P9A_${String(i).padStart(4, '0')}`;
    const handle = `@p9a_handle_${String(i).padStart(4, '0')}`;
    if (i < 80) {
      // 80 channels categorized by UC_* ID
      p9aChannels[cid] = { id: cid, name: `Categorized By ID ${i}`, handle, avatarUrl: '', isSubscribed: true };
      p9aFolders[i % 10].channels.push(cid);
    } else if (i < 140) {
      // 60 channels categorized by @handle
      p9aChannels[cid] = { id: cid, name: `Categorized By Handle ${i}`, handle, avatarUrl: '', isSubscribed: true };
      p9aFolders[i % 10].channels.push(handle);
    } else if (i < 250) {
      // 110 uncategorized subscribed channels
      p9aChannels[cid] = { id: cid, name: `Uncategorized Creator ${i}`, handle, avatarUrl: '', isSubscribed: true };
    } else if (i < 280) {
      // 30 unsubscribed channels (isSubscribed: false)
      p9aChannels[cid] = { id: cid, name: `Unsubscribed Creator ${i}`, handle, avatarUrl: '', isSubscribed: false };
    } else {
      // 20 system action noise records ('Create post' / '建立貼文')
      p9aChannels[cid] = {
        id: cid,
        name: i % 2 === 0 ? 'Create post' : '建立貼文',
        handle,
        avatarUrl: '',
        isSubscribed: true
      };
    }
  }

  mockStorage = {
    yt_initialized: true,
    yt_folders: p9aFolders,
    yt_channels: p9aChannels,
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  storageReadCount = 0;
  const getAllStart = performance.now();
  const all = await YTFolderStorage.getAllData();
  const getAllElapsed = performance.now() - getAllStart;
  const getCallCount = storageReadCount;

  assert.strictEqual(
    getCallCount,
    1,
    `YTFolderStorage.getAllData() must issue strictly 1 Storage IPC read, got ${getCallCount}`
  );
  assert(Array.isArray(all.uncategorizedChannels), 'all.uncategorizedChannels must be an array');
  assert.strictEqual(
    all.uncategorizedChannels.length,
    110,
    `Expected exactly 110 uncategorized subscribed channels, got ${all.uncategorizedChannels.length}`
  );

  storageReadCount = 0;
  const standaloneUncat = await YTFolderStorage.getUncategorizedChannels();
  const standaloneUncatReadCount = storageReadCount;
  assert.strictEqual(
    standaloneUncatReadCount,
    1,
    `YTFolderStorage.getUncategorizedChannels() must issue strictly 1 Storage IPC read, got ${standaloneUncatReadCount}`
  );
  assert.deepStrictEqual(
    all.uncategorizedChannels.map(ch => ch.id),
    standaloneUncat.map(ch => ch.id),
    'all.uncategorizedChannels must have 100% set & order equivalence with getUncategorizedChannels()'
  );
  console.log(`  ✅ Test 9a Passed: getAllData() used ${getCallCount} IPC read (${getAllElapsed.toFixed(2)}ms) with 100% uncategorized equivalence (110 channels)`);

  // --- 9b: Read-Time Auto-Heal Write-Back ---
  mockStorage = {
    yt_initialized: true,
    yt_folders: [
      {
        id: 'folder_dirty_9b',
        name: '🎮 Gaming',
        icon: '🎮',
        color: '#4caf50',
        autoKeywords: ['RPG'],
        channels: ['UC_CLEAN_9B']
      }
    ],
    yt_channels: {
      'UC_CLEAN_9B': { id: 'UC_CLEAN_9B', name: 'Clean Gaming Channel', handle: '@cleangaming', isSubscribed: true },
      'UC_DIRTY_9B': { id: 'UC_DIRTY_9B', name: 'Create post', handle: '@createpost_noise', isSubscribed: true }
    },
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  storageWriteCount = 0;
  const healedAll = await YTFolderStorage.getAllData();
  assert.strictEqual(healedAll.folders[0].name, 'Gaming', 'Dirty leading icon in folder name must be stripped on read');
  assert.strictEqual(healedAll.folders[0].icon, '🎮', 'Folder icon must remain intact');
  assert.strictEqual(healedAll.subscribedChannels['UC_DIRTY_9B'], undefined, 'Dirty system action channel must be stripped on read');
  assert(storageWriteCount >= 1, 'Auto-healed folders/channels must be written back to storage');

  // Inspect raw persisted mockStorage directly
  assert.strictEqual(
    mockStorage.yt_folders[0].name,
    'Gaming',
    'Raw persisted yt_folders[0].name must be healed to "Gaming"'
  );
  assert.strictEqual(
    mockStorage.yt_channels['UC_DIRTY_9B'],
    undefined,
    'Raw persisted yt_channels must no longer contain dirty "Create post" record'
  );
  assert(
    Boolean(mockStorage.yt_channels['UC_CLEAN_9B']),
    'Raw persisted yt_channels must retain valid channels'
  );

  // Subsequent getAllData() must NOT re-write already-clean storage
  storageWriteCount = 0;
  await YTFolderStorage.getAllData();
  assert.strictEqual(storageWriteCount, 0, 'Subsequent getAllData() on clean storage must perform 0 writes');
  console.log('  ✅ Test 9b Passed: Read-time auto-heal persisted clean folder name & purged system action noise once (0 redundant writes after heal)');

  // --- 9c: RegExp Cache Pool & O(1) Auto-Categorization Benchmark ---
  const cachedRe1 = YTFolderStorage.getCompiledSafeRegex('^(tech|ai)\\b', 'i');
  const cachedRe2 = YTFolderStorage.getCompiledSafeRegex('^(tech|ai)\\b', 'i');
  assert(cachedRe1 instanceof RegExp, 'Safe pattern must compile to a RegExp instance');
  assert.strictEqual(cachedRe1, cachedRe2, 'getCompiledSafeRegex must return the exact same cached RegExp reference');
  assert.strictEqual(
    YTFolderStorage.getCompiledSafeRegex('(a+)+$', 'i'),
    null,
    'Unsafe catastrophic backtracking pattern /(a+)+$/ must return null'
  );

  const benchFolders = [];
  const benchChannels = {};
  for (let fIdx = 0; fIdx < 20; fIdx++) {
    const tag = String(fIdx).padStart(2, '0');
    const preChannels = [];
    for (let k = 0; k < 50; k++) {
      const preId = `UC_PRE_F${tag}_${String(k).padStart(2, '0')}`;
      const preHandle = `@pre_f${tag}_${String(k).padStart(2, '0')}`;
      preChannels.push(preId);
      benchChannels[preId] = {
        id: preId,
        name: k < 5 ? preId : `Seeded Member ${tag}-${k}`,
        handle: preHandle,
        avatarUrl: '',
        isSubscribed: true
      };
    }
    benchFolders.push({
      id: `folder_bench_${tag}`,
      name: `Bench Folder ${tag}`,
      icon: '⚡',
      color: '#2196f3',
      autoKeywords: [
        '/^(tech|ai|code)\\b/i',
        `/\\bstudio_f${tag}\\b/i`,
        `kw_alpha_f${tag}`,
        `kw_beta_f${tag}`,
        `kw_gamma_f${tag}`
      ],
      channels: preChannels
    });
  }

  const liveSubs = [];
  for (let i = 0; i < 1000; i++) {
    const fIdx = i % 20;
    const tag = String(fIdx).padStart(2, '0');
    if (i < 100) {
      // 100 channels overlapping pre-existing IDs (5 per folder) and matching /^(tech|ai|code)\b/i
      const k = Math.floor(i / 20); // 0..4
      const preId = `UC_PRE_F${tag}_${String(k).padStart(2, '0')}`;
      liveSubs.push({
        id: preId,
        name: `Tech Pioneer ${i}`,
        handle: `@pre_f${tag}_${String(k).padStart(2, '0')}`,
        avatarUrl: ''
      });
    } else if (i < 200) {
      // 100 new channels matching /^(tech|ai|code)\b/i across all 20 folders
      const prefix = i % 3 === 0 ? 'Tech' : (i % 3 === 1 ? 'AI' : 'Code');
      liveSubs.push({
        id: `UC_LIVE_TECH_${String(i).padStart(4, '0')}`,
        name: `${prefix} Insights ${i}`,
        handle: `@live_tech_${i}`,
        avatarUrl: ''
      });
    } else if (i < 400) {
      // 200 new channels matching folder-specific regex /\bstudio_fXX\b/i (10 per folder)
      liveSubs.push({
        id: `UC_LIVE_STUDIO_${String(i).padStart(4, '0')}`,
        name: `Official studio_f${tag} Network`,
        handle: `@live_studio_${i}`,
        avatarUrl: ''
      });
    } else if (i < 600) {
      // 200 new channels matching folder-specific plain keyword kw_alpha_fXX (10 per folder)
      liveSubs.push({
        id: `UC_LIVE_PLAIN_${String(i).padStart(4, '0')}`,
        name: `Creator ${i} kw_alpha_f${tag}`,
        handle: `@live_plain_${i}`,
        avatarUrl: ''
      });
    } else {
      // 400 uncategorized channels matching zero keywords
      liveSubs.push({
        id: `UC_LIVE_UNCAT_${String(i).padStart(4, '0')}`,
        name: `Culinary Journey ${i}`,
        handle: `@culinary_${i}`,
        avatarUrl: ''
      });
    }
  }

  mockStorage = {
    yt_initialized: true,
    yt_folders: benchFolders,
    yt_channels: benchChannels,
    yt_settings: { ...YTFolderStorage.DEFAULT_SETTINGS }
  };

  const benchStart = performance.now();
  const enrichStart = performance.now();
  await YTFolderStorage.enrichChannelsMetadata(liveSubs);
  const enrichElapsed = performance.now() - enrichStart;

  let directMatchCount = 0;
  const matchLoopStart = performance.now();
  for (let i = 0; i < liveSubs.length; i++) {
    const ch = liveSubs[i];
    for (let fIdx = 0; fIdx < benchFolders.length; fIdx++) {
      if (YTFolderStorage.matchesAutoKeywords(ch, benchFolders[fIdx].autoKeywords)) {
        directMatchCount++;
      }
    }
  }
  const matchLoopElapsed = performance.now() - matchLoopStart;
  const totalBenchElapsed = performance.now() - benchStart;

  assert(
    totalBenchElapsed < 100,
    `1,000 channels x 20 folders enrich + matchesAutoKeywords benchmark must complete in < 100ms, took ${totalBenchElapsed.toFixed(2)}ms`
  );

  // Ground-truth match count:
  // i=0..99 (100 ch * 20 folders = 2000) + i=100..199 (100 ch * 20 folders = 2000) +
  // i=200..399 (200 ch * 1 folder = 200) + i=400..599 (200 ch * 1 folder = 200) = 4,400 matches
  assert.strictEqual(
    directMatchCount,
    4400,
    `Expected exact 4,400 keyword matches across 20,000 evaluations, got ${directMatchCount}`
  );

  const foldersAfterBench = await YTFolderStorage.getFolders();
  assert.strictEqual(foldersAfterBench.length, 20);
  for (let fIdx = 0; fIdx < 20; fIdx++) {
    const f = foldersAfterBench[fIdx];
    const uniqueSet = new Set(f.channels);
    assert.strictEqual(
      uniqueSet.size,
      f.channels.length,
      `Folder ${f.id} must have zero duplicate channel IDs (unique=${uniqueSet.size}, length=${f.channels.length})`
    );
    // Expected per folder: 50 pre-existing + 95 other pre-existing tech + 100 live tech + 10 studio + 10 plain = 265
    assert.strictEqual(
      f.channels.length,
      265,
      `Folder ${f.id} must have exact 265 categorized channels (100% accuracy), got ${f.channels.length}`
    );
  }
  console.log(
    `  ✅ Test 9c Passed: RegExp cache & O(1) auto-categorization verified ` +
    `(enrich=${enrichElapsed.toFixed(2)}ms, 20k-eval=${matchLoopElapsed.toFixed(2)}ms, total=${totalBenchElapsed.toFixed(2)}ms < 100ms)`
  );

  console.log('\n🎉 ALL v1.4.0 FEATURE & FIX VERIFICATION TESTS PASSED 100%! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ v1.4.0 Test Suite Failed:', err);
  process.exit(1);
});
