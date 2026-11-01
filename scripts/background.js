/**
 * YouTube Subscription Folders - Background Service Worker
 */

importScripts('initial_data.js', 'storage.js');

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[YT-Folders SW] Extension installed/updated, reason:', details.reason);
  await YTFolderStorage.init();
});

// Handle messages from content script or popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || sender?.id !== chrome.runtime.id) {
    return false;
  }

  if (message.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return false;
  }

  if (message.action === 'STORAGE_UPDATED') {
    if (typeof chrome.tabs?.query === 'function') {
      chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
        if (!Array.isArray(tabs)) return;
        for (const tab of tabs) {
          if (tab.id && tab.id !== sender?.tab?.id) {
            try {
              const p = chrome.tabs.sendMessage(tab.id, { action: 'STORAGE_UPDATED' });
              if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (e) {}
          }
        }
      });
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  return false;
});
