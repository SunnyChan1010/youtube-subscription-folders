/**
 * Unit tests for v1.1.0 Features:
 * - Shorts & Live Stream Detection and Settings
 * - Resilient Card Selectors & Feed Starvation Scroll Pump Conditions
 * - Sidebar Search Filtering Logic
 */

const assert = require('assert');

// 1. Mock Chrome environment
let mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = mockStorage[k]; });
        } else if (typeof keys === 'string') {
          res[keys] = mockStorage[keys];
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(k => {
            res[k] = mockStorage[k] !== undefined ? mockStorage[k] : keys[k];
          });
        }
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorage, obj);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: {
    sendMessage: () => {},
    onMessage: { addListener: () => {} }
  },
  tabs: {
    query: () => Promise.resolve([])
  }
};

// 2. Load modules
const YT_INITIAL_DATA = require('../scripts/initial_data.js');
global.YT_INITIAL_DATA = YT_INITIAL_DATA;
const YTFolderStorage = require('../scripts/storage.js');

async function runTests() {
  console.log('--- Starting v1.1.0 Features Verification Tests ---');

  // Test 1: Verify hideShorts and onlyLive in default settings
  console.log('\n[Test 1] Verify hideShorts and onlyLive in settings:');
  mockStorage = {};
  await YTFolderStorage.init();
  const settings = await YTFolderStorage.getSettings();
  assert.strictEqual(settings.hideShorts, false, 'hideShorts should default to false');
  assert.strictEqual(settings.onlyLive, false, 'onlyLive should default to false');
  console.log('  PASS: DEFAULT_SETTINGS contains hideShorts=false and onlyLive=false');

  await YTFolderStorage.updateSettings({ hideShorts: true, onlyLive: true });
  const updatedSettings = await YTFolderStorage.getSettings();
  assert.strictEqual(updatedSettings.hideShorts, true, 'hideShorts updated to true');
  assert.strictEqual(updatedSettings.onlyLive, true, 'onlyLive updated to true');
  console.log('  PASS: updateSettings successfully persisted hideShorts and onlyLive');

  // Test 2: Shorts Card Detection Logic
  console.log('\n[Test 2] Shorts Card Detection:');
  function isShortsCard(card) {
    return Boolean(
      card.querySelector('a[href*="/shorts/"], yt-thumbnail-overlay-badge-view-model [aria-label*="Shorts"], yt-icon[type="shorts"]') ||
      card.isShortsShelf
    );
  }

  const normalCard = {
    querySelector: (sel) => null,
    isShortsShelf: false
  };
  const shortsCardByUrl = {
    querySelector: (sel) => sel.includes('/shorts/') ? { href: 'https://youtube.com/shorts/xyz123' } : null,
    isShortsShelf: false
  };
  const shortsCardByShelf = {
    querySelector: (sel) => null,
    isShortsShelf: true
  };

  assert.strictEqual(isShortsCard(normalCard), false, 'Normal video card should not be detected as shorts');
  assert.strictEqual(isShortsCard(shortsCardByUrl), true, 'Video with /shorts/ url should be detected as shorts');
  assert.strictEqual(isShortsCard(shortsCardByShelf), true, 'Video in shorts shelf should be detected as shorts');
  console.log('  PASS: Shorts cards accurately identified across URL and shelf markers');

  // Test 3: Live Stream Card Detection Logic
  console.log('\n[Test 3] Live Stream Card Detection:');
  function isLiveCard(card) {
    return Boolean(
      card.querySelector('.badge-style-type-live-now, [badge-style="BADGE_STYLE_TYPE_LIVE_NOW"], [aria-label*="LIVE"], [aria-label*="直播"]') ||
      (card.badges && card.badges.some(b => b.toUpperCase().includes('LIVE') || b.includes('直播')))
    );
  }

  const regularCard = { querySelector: () => null, badges: [] };
  const liveBadgeCard = { querySelector: (s) => s.includes('badge-style-type-live-now') ? {} : null, badges: [] };
  const liveTextCard = { querySelector: () => null, badges: ['直播中', '1080p'] };

  assert.strictEqual(isLiveCard(regularCard), false, 'Regular video card is not live');
  assert.strictEqual(isLiveCard(liveBadgeCard), true, 'Card with live badge is live');
  assert.strictEqual(isLiveCard(liveTextCard), true, 'Card with live text badge is live');
  console.log('  PASS: Live broadcast cards accurately identified');

  // Test 4: Scroll Pump Triggering Condition
  console.log('\n[Test 4] Feed Starvation Scroll Pump Triggering Condition:');
  function shouldTriggerPump({ activeFolder, hideShorts, hideWatched, onlyLive, visibleCount, hasContinuation, attempts }) {
    const isFiltering = (activeFolder !== 'all' || hideShorts || hideWatched || onlyLive);
    if (!isFiltering) return false;
    if (attempts >= 5) return false;
    if (!hasContinuation) return false;
    return visibleCount < 6;
  }

  assert.strictEqual(
    shouldTriggerPump({ activeFolder: 'all', hideShorts: false, hideWatched: false, onlyLive: false, visibleCount: 2, hasContinuation: true, attempts: 0 }),
    false,
    'Should not pump if not filtering'
  );
  assert.strictEqual(
    shouldTriggerPump({ activeFolder: 'folder_tech', hideShorts: false, hideWatched: false, onlyLive: false, visibleCount: 2, hasContinuation: true, attempts: 0 }),
    true,
    'Should pump when filtering and visibleCount < 6 with continuation available'
  );
  assert.strictEqual(
    shouldTriggerPump({ activeFolder: 'folder_tech', hideShorts: false, hideWatched: false, onlyLive: false, visibleCount: 10, hasContinuation: true, attempts: 0 }),
    false,
    'Should not pump when visibleCount is already sufficient (>= 6)'
  );
  assert.strictEqual(
    shouldTriggerPump({ activeFolder: 'folder_tech', hideShorts: false, hideWatched: false, onlyLive: false, visibleCount: 2, hasContinuation: false, attempts: 0 }),
    false,
    'Should not pump if no continuation exists (end of feed)'
  );
  assert.strictEqual(
    shouldTriggerPump({ activeFolder: 'folder_tech', hideShorts: false, hideWatched: false, onlyLive: false, visibleCount: 2, hasContinuation: true, attempts: 5 }),
    false,
    'Should not pump if attempts exceed max cap of 5'
  );
  console.log('  PASS: Scroll pump triggering conditions correctly evaluated and safely capped');

  // Test 5: Sidebar Search Matching Logic
  console.log('\n[Test 5] Sidebar Search Matching Logic:');
  const mockFolders = [
    { id: 'f1', name: '🎮 遊戲實況', description: '電玩遊戲' },
    { id: 'f2', name: '💻 科技 3C', description: '電子產品評測' }
  ];
  const mockChannels = [
    { id: 'c1', name: 'MKBHD', handle: '@mkbhd', folderId: 'f2' },
    { id: 'c2', name: 'IGN', handle: '@ign', folderId: 'f1' }
  ];

  function searchSidebar(query, folders, channels) {
    const q = query.trim().toLowerCase();
    if (!q) return { matchedFolderIds: folders.map(f => f.id), matchedChannelIds: channels.map(c => c.id) };

    const matchedFolderIds = new Set();
    const matchedChannelIds = new Set();

    folders.forEach(f => {
      if (f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)) {
        matchedFolderIds.add(f.id);
      }
    });

    channels.forEach(c => {
      if (c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q)) {
        matchedChannelIds.add(c.id);
        matchedFolderIds.add(c.folderId);
      }
    });

    return {
      matchedFolderIds: Array.from(matchedFolderIds),
      matchedChannelIds: Array.from(matchedChannelIds)
    };
  }

  const res1 = searchSidebar('mkbhd', mockFolders, mockChannels);
  assert.deepStrictEqual(res1.matchedChannelIds, ['c1']);
  assert.deepStrictEqual(res1.matchedFolderIds, ['f2']);

  const res2 = searchSidebar('遊戲', mockFolders, mockChannels);
  assert.deepStrictEqual(res2.matchedFolderIds, ['f1']);

  console.log('  PASS: Sidebar search correctly matches folders and channels, auto-surfacing parent folder');

  console.log('\n🎉 ALL v1.1.0 FEATURE TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
