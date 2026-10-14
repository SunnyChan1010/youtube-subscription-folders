/**
 * YouTube Subscription Folders - Background Service Worker
 */

importScripts('initial_data.js', 'storage.js', 'youtube_api.js');

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[YT-Folders SW] Extension installed/updated, reason:', details.reason);
  await YTFolderStorage.init();
});

// Handle messages from content script or popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || sender?.id !== chrome.runtime.id) {
    return false;
  }

  // Restrict privileged InnerTube mutation/comparison actions to extension UI pages (Options/Popup)
  const privilegedActions = new Set(['COMPARE_SUBSCRIPTIONS', 'SUBSCRIBE_CHANNEL', 'UNSUBSCRIBE_CHANNEL']);
  if (privilegedActions.has(message.action)) {
    const isExtensionPage = !sender.tab || (typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`));
    if (!isExtensionPage) {
      sendResponse({ success: false, error: 'UNAUTHORIZED_SENDER' });
      return false;
    }
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

  if (message.action === 'COMPARE_SUBSCRIPTIONS') {
    (async () => {
      try {
        const res = await YTSubscriptionService.compareSubscriptions(message.channels || []);
        sendResponse({ success: true, ...res });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'RESOLVE_CHANNEL') {
    (async () => {
      try {
        const canonicalId = await YTSubscriptionService.resolveChannelId(message.channelIdOrHandle);
        sendResponse({ success: Boolean(canonicalId), canonicalId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'SUBSCRIBE_CHANNEL') {
    (async () => {
      try {
        const res = await YTSubscriptionService.subscribeChannel(message.channelId);
        sendResponse(res);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'UNSUBSCRIBE_CHANNEL') {
    (async () => {
      try {
        const res = await YTSubscriptionService.unsubscribeChannel(message.channelId);
        if (res && res.success) {
          await YTFolderStorage.removeChannelFromAllFolders(message.channelId);
        }
        sendResponse(res);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

