/**
 * Unit tests for Redundant Subscription Check and Unsubscribe Feature
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
  cookies: {
    get: ({ name, url }) => {
      if (name === 'SAPISID') {
        return Promise.resolve({ value: 'mock_sapisid_value_12345' });
      }
      return Promise.resolve(null);
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

// Mock crypto subtle for getSapisidHash
if (!global.crypto) {
  const crypto = require('crypto');
  global.crypto = {
    subtle: {
      digest: async (algo, data) => {
        const hash = crypto.createHash('sha1').update(Buffer.from(data)).digest();
        return hash.buffer;
      }
    }
  };
}

// 2. Load modules
const YT_INITIAL_DATA = require('../scripts/initial_data.js');
global.YT_INITIAL_DATA = YT_INITIAL_DATA;
const YTFolderStorage = require('../scripts/storage.js');
global.YTFolderStorage = YTFolderStorage;
const YTSubscriptionService = require('../scripts/youtube_api.js');

async function runTests() {
  console.log('--- Starting Redundant Subscriptions & Unsubscribe Tests ---');

  // Test 1: compareSubscriptions returns redundantSubscribed
  console.log('\n[Test 1] compareSubscriptions identifies redundant subscribed channels:');
  
  // Set up mock fetch for YouTube API
  const mockLiveChannels = [
    { id: 'UC111', name: 'Channel One', handle: '@channelone', avatarUrl: 'https://img/1.png' },
    { id: 'UC222', name: 'Channel Two', handle: '@channeltwo', avatarUrl: 'https://img/2.png' },
    { id: 'UC333', name: 'Channel Three (Deleted in Backup)', handle: '@channelthree', avatarUrl: 'https://img/3.png' },
    { id: 'UC444', name: 'Channel Four (Deleted in Backup)', handle: '@channelfour', avatarUrl: 'https://img/4.png' }
  ];

  const unsubscribedCalls = [];

  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('/youtubei/v1/browse')) {
      return {
        ok: true,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [{
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [{
                        itemSectionRenderer: {
                          contents: mockLiveChannels.map(ch => ({
                            channelRenderer: {
                              channelId: ch.id,
                              title: { simpleText: ch.name },
                              subscriberCountText: { simpleText: ch.handle },
                              thumbnail: { thumbnails: [{ url: ch.avatarUrl }] }
                            }
                          }))
                        }
                      }]
                    }
                  }
                }
              }]
            }
          }
        })
      };
    }

    if (urlStr.includes('/youtubei/v1/subscription/unsubscribe')) {
      const body = JSON.parse(options.body || '{}');
      unsubscribedCalls.push(body);
      return {
        ok: true,
        json: async () => ({ status: 'UNSUBSCRIBED', channelIds: body.channelIds })
      };
    }

    // Default mock response for resolveChannelId or other calls
    return {
      ok: true,
      text: async () => '<html><body>"INNERTUBE_API_KEY":"mock_key","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20240101.00.00"</body></html>',
      json: async () => ({})
    };
  };

  // Force fetchSubscribedChannels to refresh live list
  await YTSubscriptionService.fetchSubscribedChannels(true);

  // Backup data has UC111, UC222, and UC555 (a newly added channel not yet subscribed)
  const backupChannels = [
    { id: 'UC111', name: 'Channel One', handle: '@channelone' },
    { id: 'UC222', name: 'Channel Two', handle: '@channeltwo' },
    { id: 'UC555', name: 'Channel Five (New)', handle: '@channelfive' }
  ];

  const cmp = await YTSubscriptionService.compareSubscriptions(backupChannels);

  console.log(`  Subscribed in backup: ${cmp.subscribed.length} (${cmp.subscribed.map(c => c.id).join(', ')})`);
  console.log(`  Unsubscribed in backup: ${cmp.unsubscribed.length} (${cmp.unsubscribed.map(c => c.id).join(', ')})`);
  console.log(`  Redundant subscribed: ${cmp.redundantSubscribed.length} (${cmp.redundantSubscribed.map(c => c.id).join(', ')})`);

  assert.strictEqual(cmp.subscribed.length, 2, 'Should match UC111 and UC222');
  assert.strictEqual(cmp.unsubscribed.length, 1, 'Should identify UC555 as not yet subscribed');
  assert.strictEqual(cmp.redundantSubscribed.length, 2, 'Should identify UC333 and UC444 as redundant');
  assert.ok(cmp.redundantSubscribed.some(c => c.id === 'UC333'), 'Redundant list contains UC333');
  assert.ok(cmp.redundantSubscribed.some(c => c.id === 'UC444'), 'Redundant list contains UC444');
  console.log('  ✅ compareSubscriptions successfully identified redundant subscribed channels');

  // Test 2: unsubscribeChannel single call
  console.log('\n[Test 2] unsubscribeChannel execution:');
  const unsubRes = await YTSubscriptionService.unsubscribeChannel('UC333');
  assert.strictEqual(unsubRes.success, true, 'unsubscribeChannel should return success');
  assert.strictEqual(unsubRes.channelId, 'UC333', 'channelId should be UC333');
  assert.ok(unsubscribedCalls.length > 0, 'Unsubscribe API should have been called');
  console.log('  ✅ unsubscribeChannel succeeded');

  // Test 3: batchUnsubscribeWithProgress
  console.log('\n[Test 3] batchUnsubscribeWithProgress execution and callbacks:');
  const channelsToUnsub = [
    { id: 'UC333', name: 'Channel Three' },
    { id: 'UC444', name: 'Channel Four' }
  ];

  const progressEvents = [];
  const batchRes = await YTSubscriptionService.batchUnsubscribeWithProgress(channelsToUnsub, {
    delayMs: 10,
    onProgress: (p) => {
      progressEvents.push({ ...p });
    }
  });

  assert.strictEqual(batchRes.total, 2, 'Total should be 2');
  assert.strictEqual(batchRes.succeeded, 2, 'Succeeded should be 2');
  assert.strictEqual(batchRes.failed, 0, 'Failed should be 0');
  assert.ok(progressEvents.length >= 2, 'onProgress should be called for each channel');
  console.log(`  Progress events received: ${progressEvents.length}`);
  console.log('  ✅ batchUnsubscribeWithProgress completed successfully');

  // Test 4: YTFolderStorage.removeChannelFromAllFolders multi-folder & handle synchronization
  console.log('\n[Test 4] YTFolderStorage.removeChannelFromAllFolders:');
  const testFolders = [
    { id: 'f_tech', name: 'Tech', channels: ['UC111', '@channelone'] },
    { id: 'f_news', name: 'News', channels: ['UC111', 'UC222'] },
    { id: 'f_music', name: 'Music', channels: ['UC222'] }
  ];
  const testChannels = {
    'UC111': { id: 'UC111', name: 'Channel One', handle: '@channelone', isSubscribed: true },
    'UC222': { id: 'UC222', name: 'Channel Two', handle: '@channeltwo', isSubscribed: true }
  };
  await YTFolderStorage.setFolders(testFolders);
  await YTFolderStorage.setChannels(testChannels);

  const remResult = await YTFolderStorage.removeChannelFromAllFolders('UC111', '@channelone');
  assert.strictEqual(remResult.success, true, 'removeChannelFromAllFolders should succeed');
  assert.strictEqual(remResult.removedCount, 3, 'Should remove 2 refs from f_tech and 1 from f_news (total 3)');

  const updatedFolders = await YTFolderStorage.getFolders();
  const fTech = updatedFolders.find(f => f.id === 'f_tech');
  const fNews = updatedFolders.find(f => f.id === 'f_news');
  const fMusic = updatedFolders.find(f => f.id === 'f_music');

  assert.deepStrictEqual(fTech.channels, [], 'Tech folder should be empty after removing UC111/@channelone');
  assert.deepStrictEqual(fNews.channels, ['UC222'], 'News folder should retain only UC222');
  assert.deepStrictEqual(fMusic.channels, ['UC222'], 'Music folder should remain untouched');

  const updatedChannels = await YTFolderStorage.getChannels();
  assert.strictEqual(updatedChannels['UC111'].isSubscribed, false, 'Channel One isSubscribed should be false');
  console.log('  ✅ removeChannelFromAllFolders successfully removed channel across all folders and updated subscription status');

  // Test 5: Automatic folder decategorization upon API unsubscription
  console.log('\n[Test 5] Automatic folder decategorization upon unsubscribeChannel:');
  fTech.channels = ['UC444'];
  fMusic.channels = ['UC222', 'UC444'];
  updatedChannels['UC444'] = { id: 'UC444', name: 'Channel Four', handle: '@channelfour', isSubscribed: true };
  await YTFolderStorage.setFolders([fTech, fNews, fMusic]);
  await YTFolderStorage.setChannels(updatedChannels);

  // Unsubscribe UC444 via YTSubscriptionService
  const autoUnsubRes = await YTSubscriptionService.unsubscribeChannel('UC444');
  assert.strictEqual(autoUnsubRes.success, true, 'unsubscribeChannel should succeed');

  const postUnsubFolders = await YTFolderStorage.getFolders();
  const postTech = postUnsubFolders.find(f => f.id === 'f_tech');
  const postMusic = postUnsubFolders.find(f => f.id === 'f_music');

  assert.ok(!postTech.channels.includes('UC444'), 'Tech folder should no longer contain UC444');
  assert.ok(!postMusic.channels.includes('UC444'), 'Music folder should no longer contain UC444');
  assert.deepStrictEqual(postMusic.channels, ['UC222'], 'Music folder should still contain UC222');
  console.log('  ✅ unsubscribeChannel automatically triggered synchronous folder decategorization');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('\n❌ Test Failed:', err);
  process.exit(1);
});
