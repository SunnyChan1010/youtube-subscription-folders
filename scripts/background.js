/**
 * YouTube Subscription Folders - Background Service Worker
 */

importScripts('initial_data.js', 'storage.js');

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[YT-Folders SW] Extension installed/updated, reason:', details.reason);
  await YTFolderStorage.init();
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return false;
  }

  if (message.action === 'GET_DATA') {
    (async () => {
      const folders = await YTFolderStorage.getFolders();
      const channels = await YTFolderStorage.getChannels();
      const settings = await YTFolderStorage.getSettings();
      sendResponse({ folders, channels, settings });
    })();
    return true; // async response
  }

  if (message.action === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  return false;
});
