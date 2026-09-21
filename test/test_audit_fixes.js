/**
 * Unit tests for Codebase Audit & Improvement Fixes
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
const YTSubscriptionService = require('../scripts/youtube_api.js');

async function runTests() {
  console.log('--- Starting Audit Fixes Verification Tests ---');

  // Test 1: Destructive Auto-Reinitialization Prevention
  console.log('\n[Test 1] Storage empty folders preservation:');
  mockStorage = {};
  await YTFolderStorage.init();
  let folders = await YTFolderStorage.getFolders();
  assert.ok(folders.length > 0, 'First init should load fallback folders');
  console.log(`  Initial folders count: ${folders.length}`);

  // User intentionally deletes all folders
  await YTFolderStorage.setFolders([]);
  folders = await YTFolderStorage.getFolders();
  assert.strictEqual(folders.length, 0, 'getFolders() should return empty array [] when user cleared folders, NOT re-init');
  console.log('  PASS: User empty folders preserved without unwanted re-initialization.');

  // Test 2: Cross-referencing removal & toggle in removeChannelFromFolder
  console.log('\n[Test 2] removeChannelFromFolder and toggleChannelInFolder handle/ID cross-referencing:');
  mockStorage = {};
  await YTFolderStorage.init();

  // Create test folder with canonical UC ID
  const testFolder = {
    id: 'f_test_cross',
    name: 'Cross Test Folder',
    channels: ['UC_CANONICAL_123']
  };
  // Channel registry mapping canonical ID to handle
  const channels = {
    'UC_CANONICAL_123': {
      id: 'UC_CANONICAL_123',
      name: 'Channel 123',
      handle: '@channel123'
    }
  };
  await YTFolderStorage.setFolders([testFolder]);
  await YTFolderStorage.setChannels(channels);

  // Try toggling channel using handle '@channel123'
  // Since it already exists in folder as UC_CANONICAL_123, toggle should REMOVE it!
  const toggledOff = await YTFolderStorage.toggleChannelInFolder('f_test_cross', { handle: '@channel123' });
  assert.strictEqual(toggledOff, false, 'toggleChannelInFolder with handle should find UC ID and remove it');

  let updatedFolders = await YTFolderStorage.getFolders();
  assert.strictEqual(updatedFolders[0].channels.length, 0, 'Channel should have been removed from folder');
  console.log('  PASS: toggleChannelInFolder matched @handle against UC... ID and removed channel.');

  // Toggle it back on
  const toggledOn = await YTFolderStorage.toggleChannelInFolder('f_test_cross', { id: 'UC_CANONICAL_123', handle: '@channel123' });
  assert.strictEqual(toggledOn, true, 'toggleChannelInFolder should add channel back');

  // Test removeChannelFromFolder directly with handle
  const removed = await YTFolderStorage.removeChannelFromFolder('f_test_cross', '@channel123');
  assert.strictEqual(removed, true, 'removeChannelFromFolder should succeed');
  updatedFolders = await YTFolderStorage.getFolders();
  assert.strictEqual(updatedFolders[0].channels.length, 0, 'removeChannelFromFolder should remove UC ID when called with handle');
  console.log('  PASS: removeChannelFromFolder matched @handle against UC... ID and removed channel.');

  // Test 3: Continuation token extraction for InnerTube
  console.log('\n[Test 3] Continuation token extraction:');
  const dummyBrowseResponse = {
    responseContext: {},
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          { channelRenderer: { channelId: 'UC_TEST_1' } }
                        ]
                      }
                    },
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: {
                            token: 'TOKEN_XYZ_CONTINUATION_456'
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  };

  const extractedToken = YTSubscriptionService.extractContinuationToken(dummyBrowseResponse);
  assert.strictEqual(extractedToken, 'TOKEN_XYZ_CONTINUATION_456', 'extractContinuationToken should extract token from nested continuationItemRenderer');
  console.log(`  Extracted token: ${extractedToken}`);
  console.log('  PASS: Continuation token extracted successfully.');

  const noTokenObj = { item: { value: 123 } };
  assert.strictEqual(YTSubscriptionService.extractContinuationToken(noTokenObj), null, 'extractContinuationToken should return null when no token present');
  console.log('  PASS: Returns null correctly when no token exists.');

  console.log('\n🎉 ALL AUDIT FIXES VERIFIED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
