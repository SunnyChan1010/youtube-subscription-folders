/**
 * Test Suite: Check & Clean Unsubscribed Channels & Avatar Fallback
 */

const assert = require('assert');

// Mock chrome.storage.local
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        let result = {};
        if (typeof keys === 'string') {
          result[keys] = mockStorage[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(k => { result[k] = mockStorage[k]; });
        } else if (keys === null) {
          result = { ...mockStorage };
        } else if (typeof keys === 'object') {
          Object.keys(keys).forEach(k => {
            result[k] = mockStorage[k] !== undefined ? mockStorage[k] : keys[k];
          });
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
        return Promise.resolve();
      },
      clear: (cb) => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: {
    sendMessage: () => Promise.resolve()
  }
};

const { YT_INITIAL_DATA, YT_DEFAULT_AVATAR } = require('../scripts/initial_data.js');
const YTFolderStorage = require('../scripts/storage.js');
const YTSubscriptionService = require('../scripts/youtube_api.js');

async function runCleanupTests() {
  console.log('--- Starting Check & Clean Unsubscribed Channels & Avatar Tests ---');

  // Test 1: Verify YT_DEFAULT_AVATAR format and validity
  console.log('\n[Test 1] Verify YT_DEFAULT_AVATAR:');
  assert.ok(YT_DEFAULT_AVATAR.startsWith('data:image/svg+xml;base64,'), 'Avatar must be a base64 SVG data URI');
  const base64Data = YT_DEFAULT_AVATAR.replace('data:image/svg+xml;base64,', '');
  const svgText = Buffer.from(base64Data, 'base64').toString('utf-8');
  assert.ok(svgText.includes('<svg') && svgText.includes('</svg>'), 'Decoded string must be valid SVG XML');
  console.log('  ✅ YT_DEFAULT_AVATAR is a valid, decodeable SVG data URI');

  // Setup initial mock folders & channels
  await YTFolderStorage.init();
  await YTFolderStorage.setFolders([
    { id: 'f1', name: 'Tech', channels: ['UC111', '@alpha', 'UC333'] },
    { id: 'f2', name: 'Gaming', channels: ['UC222', 'UC333', '@beta'] }
  ]);
  await YTFolderStorage.setChannels({
    'UC111': { id: 'UC111', name: 'UC111', handle: '@alpha', avatarUrl: '', isSubscribed: true },
    'UC222': { id: 'UC222', name: 'Channel 222', handle: '@beta', avatarUrl: 'https://img/2.png', isSubscribed: true },
    'UC333': { id: 'UC333', name: 'Dead Channel 333', handle: '@dead', avatarUrl: '', isSubscribed: true },
    'UC444': { id: 'UC444', name: 'Uncategorized Active', handle: '@active', avatarUrl: '', isSubscribed: true },
    'UC555': { id: 'UC555', name: 'Uncategorized Dead', handle: '@dead2', avatarUrl: '', isSubscribed: true }
  });

  // Test 2: enrichChannelsMetadata fills missing avatar and names from live subs
  console.log('\n[Test 2] enrichChannelsMetadata:');
  const liveSubs = [
    { id: 'UC111', name: 'Alpha Tech', handle: '@alpha', avatarUrl: 'https://yt/alpha.jpg' },
    { id: 'UC444', name: 'Active Channel', handle: '@active', avatarUrl: 'https://yt/active.jpg' }
  ];
  const enrichRes = await YTFolderStorage.enrichChannelsMetadata(liveSubs);
  assert.ok(enrichRes.updatedCount >= 2, 'Should update at least 2 channels');

  const channelsAfterEnrich = await YTFolderStorage.getChannels();
  assert.strictEqual(channelsAfterEnrich['UC111'].name, 'Alpha Tech', 'UC111 placeholder name should be enriched');
  assert.strictEqual(channelsAfterEnrich['UC111'].avatarUrl, 'https://yt/alpha.jpg', 'UC111 avatar should be enriched');
  assert.strictEqual(channelsAfterEnrich['UC444'].avatarUrl, 'https://yt/active.jpg', 'UC444 avatar should be enriched');
  console.log('  ✅ enrichChannelsMetadata successfully populated real channel names and avatars');

  // Test 3: getUncategorizedChannels excludes unsubscribed channels (isSubscribed === false)
  console.log('\n[Test 3] getUncategorizedChannels excludes unsubscribed channels:');
  // Mark UC555 as isSubscribed = false
  channelsAfterEnrich['UC555'].isSubscribed = false;
  await YTFolderStorage.setChannels(channelsAfterEnrich);

  const uncategorized = await YTFolderStorage.getUncategorizedChannels();
  const ucIds = uncategorized.map(c => c.id);
  assert.ok(ucIds.includes('UC444'), 'Active uncategorized channel must appear');
  assert.ok(!ucIds.includes('UC555'), 'Unsubscribed channel (isSubscribed: false) must NOT appear in uncategorized');
  console.log('  ✅ getUncategorizedChannels strictly excludes unsubscribed channels');

  // Test 4: batchRemoveUnsubscribedChannels across multiple folders and purge from storage
  console.log('\n[Test 4] batchRemoveUnsubscribedChannels:');
  const toPurge = [
    { id: 'UC333', handle: '@dead', name: 'Dead Channel 333' },
    { id: 'UC555', handle: '@dead2', name: 'Uncategorized Dead' }
  ];

  const purgeRes = await YTFolderStorage.batchRemoveUnsubscribedChannels(toPurge, { purgeFromStorage: true });
  assert.strictEqual(purgeRes.success, true);
  assert.strictEqual(purgeRes.removedChannelsCount, 2);

  const foldersAfterPurge = await YTFolderStorage.getFolders();
  const channelsAfterPurge = await YTFolderStorage.getChannels();

  const f1Channels = foldersAfterPurge.find(f => f.id === 'f1').channels;
  const f2Channels = foldersAfterPurge.find(f => f.id === 'f2').channels;

  assert.ok(!f1Channels.includes('UC333'), 'UC333 must be removed from f1');
  assert.ok(!f2Channels.includes('UC333'), 'UC333 must be removed from f2');
  assert.ok(f1Channels.includes('UC111') || f1Channels.includes('@alpha'), 'Other channels in f1 preserved');
  assert.ok(f2Channels.includes('UC222'), 'Other channels in f2 preserved');

  assert.strictEqual(channelsAfterPurge['UC333'], undefined, 'Purged channel UC333 must not exist in channels registry');
  assert.strictEqual(channelsAfterPurge['UC555'], undefined, 'Purged channel UC555 must not exist in channels registry');
  console.log('  ✅ batchRemoveUnsubscribedChannels atomically purged unsubscribed channels from all folders and registry');

  // Test 5: Filter and sanitize YouTube system actions (e.g. "Create post", "Upload video", "Settings", "建立貼文")
  console.log('\n[Test 5] System action filtering & storage sanitization:');
  const { isSystemActionTitle } = require('../scripts/initial_data.js');
  assert.strictEqual(isSystemActionTitle('Create post'), true, 'Create post must be recognized as system action');
  assert.strictEqual(isSystemActionTitle('建立貼文'), true, '建立貼文 must be recognized as system action');
  assert.strictEqual(isSystemActionTitle('Upload video'), true, 'Upload video must be recognized as system action');
  assert.strictEqual(isSystemActionTitle('設定'), true, '設定 must be recognized as system action');
  assert.strictEqual(isSystemActionTitle('BBC News'), false, 'Normal channel name must not be filtered');

  // Insert polluted channel with "Create post" directly into storage
  await global.chrome.storage.local.set({
    'yt_channels': {
      'UC111': { id: 'UC111', name: 'Alpha Tech', handle: '@alpha', avatarUrl: '', isSubscribed: true },
      'UC_USER_OWN': { id: 'UC_USER_OWN', name: 'Create post', handle: '', avatarUrl: '', isSubscribed: true }
    }
  });

  // Calling getChannels() must auto-sanitize and delete it
  const sanitizedChannels = await YTFolderStorage.getChannels();
  assert.strictEqual(sanitizedChannels['UC_USER_OWN'], undefined, 'Polluted "Create post" entry must be automatically purged from channels');

  // Calling getUncategorizedChannels() must never return system actions
  const uncategorizedAfterSanitize = await YTFolderStorage.getUncategorizedChannels();
  assert.ok(!uncategorizedAfterSanitize.some(c => c.name === 'Create post' || c.id === 'UC_USER_OWN'), 'System actions must never appear in uncategorized');

  // batchAddChannels should ignore system action titles
  await YTFolderStorage.batchAddChannels([
    { id: 'UC_INVALID_1', name: 'Upload video', handle: '' },
    { id: 'UC_VALID_1', name: 'Real Channel', handle: '@real' }
  ]);
  const channelsAfterBatch = await YTFolderStorage.getChannels();
  assert.strictEqual(channelsAfterBatch['UC_INVALID_1'], undefined, 'batchAddChannels must ignore "Upload video"');
  assert.ok(channelsAfterBatch['UC_VALID_1'], 'batchAddChannels must accept real channels');

  // deduplicateData should ignore system action titles
  const dedupRes = YTFolderStorage.deduplicateData({
    folders: [{ id: 'f_test', name: 'Test', channels: ['Create post', 'UC_VALID_1'] }],
    channels: {
      'Create post': { id: 'Create post', name: 'Create post' },
      'UC_VALID_1': { id: 'UC_VALID_1', name: 'Real Channel' }
    }
  });
  const dedupFolderChannels = dedupRes.cleanFolders[0].channels;
  assert.ok(!dedupFolderChannels.includes('Create post'), 'deduplicateData must purge "Create post" from folder channels');
  assert.strictEqual(dedupRes.cleanChannelsMap['Create post'], undefined, 'deduplicateData must not have "Create post" in channel map');
  console.log('  ✅ YouTube system action buttons (e.g. Create post) completely filtered, sanitized, and purged');

  console.log('\n🎉 ALL CLEANUP & AVATAR TESTS PASSED SUCCESSFULLY! 🎉');
}

runCleanupTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
