/**
 * YouTube Subscription Folders - YouTube InnerTube Subscription Service
 * Provides authenticated subscription checks and batch subscription execution.
 */

const YTSubscriptionService = (() => {
  let cachedSession = null;
  let cachedSubscribedChannels = null;
  let lastSubscribedFetchTime = 0;

  /**
   * Generates SAPISIDHASH authorization header value for YouTube InnerTube API.
   * Format: SAPISIDHASH <timestamp>_<sha1(timestamp + " " + sapisid + " " + origin)>
   */
  async function getSapisidHash(sapisid, origin = 'https://www.youtube.com') {
    if (!sapisid) return '';
    const timestamp = Math.floor(Date.now() / 1000);
    const textToHash = `${timestamp} ${sapisid} ${origin}`;

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(textToHash);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `SAPISIDHASH ${timestamp}_${hashHex}`;
    }

    // Fallback if crypto.subtle is unavailable (Node.js test environment)
    if (typeof require !== 'undefined') {
      try {
        const cryptoMod = require('crypto');
        const hashHex = cryptoMod.createHash('sha1').update(textToHash).digest('hex');
        return `SAPISIDHASH ${timestamp}_${hashHex}`;
      } catch (e) {}
    }

    return '';
  }

  /**
   * Retrieves SAPISID cookie from YouTube
   */
  async function getSapisidCookie() {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      try {
        let cookie = await chrome.cookies.get({ url: 'https://www.youtube.com', name: 'SAPISID' });
        if (!cookie) {
          cookie = await chrome.cookies.get({ url: 'https://www.youtube.com', name: '__Secure-3PAPISID' });
        }
        if (cookie && cookie.value) {
          return cookie.value;
        }
      } catch (err) {
        console.warn('[YTSubscriptionService] chrome.cookies.get error:', err);
      }
    }

    // If running in page context
    if (typeof document !== 'undefined' && document.cookie) {
      const match = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Obtains active YouTube InnerTube session credentials (API key, client context, SAPISID)
   */
  async function getAuthSession(forceRefresh = false) {
    if (!forceRefresh && cachedSession && (Date.now() - cachedSession.time < 300000)) {
      return cachedSession;
    }

    const sapisid = await getSapisidCookie();
    let apiKey = '';
    let clientVersion = '2.20250101.00.00';
    let visitorData = '';

    // Strategy 1: Ask open YouTube tabs via content script
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        for (const tab of tabs) {
          if (tab.id) {
            try {
              const res = await chrome.tabs.sendMessage(tab.id, { action: 'GET_YT_CONFIG' });
              if (res && res.apiKey) {
                apiKey = res.apiKey;
                if (res.clientVersion) clientVersion = res.clientVersion;
                if (res.visitorData) visitorData = res.visitorData;
                break;
              }
            } catch (e) {
              // Tab might be sleeping or loading
            }
          }
        }
      } catch (e) {}
    }

    // Strategy 2: Fetch YouTube homepage HTML to extract INNERTUBE_API_KEY if not yet found
    if (!apiKey) {
      try {
        const resp = await fetch('https://www.youtube.com/', {
          credentials: 'include',
          headers: { 'Accept': 'text/html' }
        });
        if (resp.ok) {
          const html = await resp.text();
          const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
          if (keyMatch) apiKey = keyMatch[1];

          const verMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
                           html.match(/"clientVersion":"([^"]+)"/);
          if (verMatch) clientVersion = verMatch[1];

          const visMatch = html.match(/"VISITOR_DATA":"([^"]+)"/);
          if (visMatch) visitorData = visMatch[1];
        }
      } catch (err) {
        console.warn('[YTSubscriptionService] Error scraping YouTube config:', err);
      }
    }

    // Default fallback public client key if all scraping failed
    if (!apiKey) {
      apiKey = 'AIzaSyAO_FJ2SlqU8Q4usWStTG5e8PwPAQL35Oo';
    }

    cachedSession = {
      sapisid,
      apiKey,
      clientVersion,
      visitorData,
      isLoggedIn: Boolean(sapisid),
      time: Date.now()
    };

    return cachedSession;
  }

  /**
   * Resolves channel handle (@username or custom name) to canonical YouTube Channel ID (UC...)
   */
  async function resolveChannelId(handleOrId) {
    if (!handleOrId) return null;
    const clean = String(handleOrId).trim();

    // Already a standard 24-character UC... channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(clean)) {
      return clean;
    }

    const path = clean.startsWith('@') ? clean : (clean.startsWith('http') ? '' : `@${clean}`);
    const url = clean.startsWith('http') ? clean : `https://www.youtube.com/${path}`;

    try {
      const resp = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'text/html' }
      });
      if (!resp.ok) return clean;

      const html = await resp.text();

      // Look for meta itemprop="channelId" or "channelId":"UC..."
      const metaMatch = html.match(/<meta\s+itemprop="channelId"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+name="channelId"\s+content="([^"]+)"/i);
      if (metaMatch && metaMatch[1] && metaMatch[1].startsWith('UC')) {
        return metaMatch[1];
      }

      const jsonMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (jsonMatch && jsonMatch[1]) {
        return jsonMatch[1];
      }

      const extMatch = html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (extMatch && extMatch[1]) {
        return extMatch[1];
      }

      const canMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
      if (canMatch && canMatch[1]) {
        return canMatch[1];
      }
    } catch (err) {
      console.warn('[YTSubscriptionService] Error resolving channel ID for:', clean, err);
    }

    return clean;
  }

  /**
   * Recursively extracts channel IDs, handles, and channel details from YouTube browse API response
   */
  function extractChannelsFromBrowseData(data, channelSet = new Set(), handleSet = new Set(), channelMap = new Map()) {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data)) {
      for (const item of data) {
        extractChannelsFromBrowseData(item, channelSet, handleSet, channelMap);
      }
      return;
    }

    let foundId = '';
    if (data.channelId && typeof data.channelId === 'string' && data.channelId.startsWith('UC')) {
      foundId = data.channelId.trim();
    } else if (data.navigationEndpoint?.browseEndpoint?.browseId &&
        typeof data.navigationEndpoint.browseEndpoint.browseId === 'string' &&
        data.navigationEndpoint.browseEndpoint.browseId.startsWith('UC')) {
      foundId = data.navigationEndpoint.browseEndpoint.browseId.trim();
    }

    let foundHandle = '';
    if (data.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl &&
        typeof data.navigationEndpoint.browseEndpoint.canonicalBaseUrl === 'string') {
      const url = data.navigationEndpoint.browseEndpoint.canonicalBaseUrl;
      const hMatch = url.match(/\/(@[^\/\?]+)/);
      if (hMatch) {
        foundHandle = hMatch[1].toLowerCase();
      }
    }

    if (foundId) channelSet.add(foundId);
    if (foundHandle) {
      handleSet.add(foundHandle);
      handleSet.add(foundHandle.replace(/^@/, ''));
    }

    // Extract title / name and thumbnail if present
    let foundName = '';
    if (data.title) {
      if (typeof data.title === 'string') {
        foundName = data.title;
      } else if (data.title.simpleText) {
        foundName = data.title.simpleText;
      } else if (Array.isArray(data.title.runs) && data.title.runs[0]?.text) {
        foundName = data.title.runs.map(r => r.text).join('');
      }
    }

    let foundAvatar = '';
    if (data.thumbnail?.thumbnails && Array.isArray(data.thumbnail.thumbnails) && data.thumbnail.thumbnails.length > 0) {
      foundAvatar = data.thumbnail.thumbnails[data.thumbnail.thumbnails.length - 1].url || '';
    } else if (data.avatar?.thumbnails && Array.isArray(data.avatar.thumbnails) && data.avatar.thumbnails.length > 0) {
      foundAvatar = data.avatar.thumbnails[data.avatar.thumbnails.length - 1].url || '';
    }

    if (foundId && channelMap) {
      const existing = channelMap.get(foundId);
      if (!existing) {
        channelMap.set(foundId, {
          id: foundId,
          name: foundName || foundHandle || foundId,
          handle: foundHandle ? (foundHandle.startsWith('@') ? foundHandle : `@${foundHandle}`) : '',
          avatarUrl: foundAvatar
        });
      } else {
        if (!existing.name && foundName) existing.name = foundName;
        if (!existing.handle && foundHandle) existing.handle = foundHandle.startsWith('@') ? foundHandle : `@${foundHandle}`;
        if (!existing.avatarUrl && foundAvatar) existing.avatarUrl = foundAvatar;
      }
    }

    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'object' && data[key] !== null) {
        extractChannelsFromBrowseData(data[key], channelSet, handleSet, channelMap);
      }
    }
  }

  /**
   * Recursively finds a continuation token in InnerTube response data
   */
  function extractContinuationToken(data) {
    if (!data || typeof data !== 'object') return null;

    if (data.continuationCommand && typeof data.continuationCommand.token === 'string') {
      return data.continuationCommand.token;
    }
    if (data.nextContinuationData && typeof data.nextContinuationData.continuation === 'string') {
      return data.nextContinuationData.continuation;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        const token = extractContinuationToken(item);
        if (token) return token;
      }
      return null;
    }

    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'object' && data[key] !== null) {
        const token = extractContinuationToken(data[key]);
        if (token) return token;
      }
    }
    return null;
  }

  /**
   * Fetches user's currently subscribed channels directly from YouTube InnerTube browse API
   */
  async function fetchSubscribedChannels(forceRefresh = false) {
    if (!forceRefresh && cachedSubscribedChannels && (Date.now() - lastSubscribedFetchTime < 180000)) {
      return cachedSubscribedChannels;
    }

    const session = await getAuthSession(forceRefresh);
    const channelIds = new Set();
    const handles = new Set();
    const channelsMap = new Map();

    // If not logged in, return whatever we currently have
    if (!session.sapisid) {
      console.warn('[YTSubscriptionService] No SAPISID cookie found, user might not be logged in.');
      cachedSubscribedChannels = {
        channelIds,
        handles,
        channelsList: [],
        isLoggedIn: false
      };
      return cachedSubscribedChannels;
    }

    try {
      const authHeader = await getSapisidHash(session.sapisid);
      const headers = {
        'Content-Type': 'application/json',
        'X-Origin': 'https://www.youtube.com',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': session.clientVersion
      };
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      if (session.visitorData) {
        headers['X-Goog-Visitor-Id'] = session.visitorData;
      }

      const payload = {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: session.clientVersion,
            originalUrl: 'https://www.youtube.com/feed/channels',
            mainAppWebInfo: {
              graftUrl: '/feed/channels'
            }
          }
        },
        browseId: 'FEchannels'
      };

      const resp = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${session.apiKey}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const json = await resp.json();
        extractChannelsFromBrowseData(json, channelIds, handles, channelsMap);

        // Continuation pagination: fetch subsequent pages (up to 10 pages for 1000+ channels)
        let continuationToken = extractContinuationToken(json);
        let pageCount = 0;
        const maxPages = 10;

        while (continuationToken && pageCount < maxPages) {
          pageCount++;
          const contPayload = {
            context: {
              client: {
                clientName: 'WEB',
                clientVersion: session.clientVersion,
                originalUrl: 'https://www.youtube.com/feed/channels',
                mainAppWebInfo: {
                  graftUrl: '/feed/channels'
                }
              }
            },
            continuation: continuationToken
          };

          try {
            const contResp = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${session.apiKey}`, {
              method: 'POST',
              headers,
              credentials: 'include',
              body: JSON.stringify(contPayload)
            });

            if (!contResp.ok) break;

            const contJson = await contResp.json();
            extractChannelsFromBrowseData(contJson, channelIds, handles, channelsMap);
            const nextToken = extractContinuationToken(contJson);
            if (!nextToken || nextToken === continuationToken) break;
            continuationToken = nextToken;
          } catch (pErr) {
            console.warn('[YTSubscriptionService] Error fetching continuation page:', pErr);
            break;
          }
        }

        console.log(`[YTSubscriptionService] Fetched ${channelIds.size} subscribed channels from YouTube InnerTube (${pageCount + 1} pages).`);
      } else {
        console.warn(`[YTSubscriptionService] InnerTube browse returned status ${resp.status}`);
      }
    } catch (err) {
      console.error('[YTSubscriptionService] Error fetching subscriptions:', err);
    }

    cachedSubscribedChannels = {
      channelIds,
      handles,
      channelsList: Array.from(channelsMap.values()),
      isLoggedIn: true
    };
    lastSubscribedFetchTime = Date.now();

    return cachedSubscribedChannels;
  }

  /**
   * Subscribes to a single channel on YouTube
   */
  async function subscribeChannel(channelIdOrHandle) {
    if (!channelIdOrHandle) {
      return { success: false, error: 'MISSING_CHANNEL_ID' };
    }

    const canonicalId = await resolveChannelId(channelIdOrHandle);
    if (!canonicalId || !canonicalId.startsWith('UC')) {
      return { success: false, error: 'INVALID_CHANNEL_ID', channelId: channelIdOrHandle };
    }

    const session = await getAuthSession();
    if (!session.sapisid) {
      return { success: false, error: 'NOT_LOGGED_IN', channelId: canonicalId };
    }

    const authHeader = await getSapisidHash(session.sapisid);
    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://www.youtube.com',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': session.clientVersion
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    if (session.visitorData) {
      headers['X-Goog-Visitor-Id'] = session.visitorData;
    }

    const payload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: session.clientVersion
        }
      },
      channelIds: [canonicalId],
      params: 'EgIIBBgA'
    };

    try {
      const resp = await fetch(`https://www.youtube.com/youtubei/v1/subscription/subscribe?key=${session.apiKey}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const json = await resp.json().catch(() => ({}));
        // Update cached subscribed set if present
        if (cachedSubscribedChannels) {
          if (cachedSubscribedChannels.channelIds) {
            cachedSubscribedChannels.channelIds.add(canonicalId);
          }
          if (cachedSubscribedChannels.channelsList && !cachedSubscribedChannels.channelsList.some(c => c.id === canonicalId)) {
            cachedSubscribedChannels.channelsList.push({
              id: canonicalId,
              name: canonicalId,
              handle: channelIdOrHandle.startsWith('@') ? channelIdOrHandle : '',
              avatarUrl: ''
            });
          }
        }
        return { success: true, channelId: canonicalId, data: json };
      } else if (resp.status === 401 || resp.status === 403) {
        return { success: false, error: 'AUTH_FAILED', status: resp.status, channelId: canonicalId };
      } else {
        return { success: false, error: `HTTP_${resp.status}`, status: resp.status, channelId: canonicalId };
      }
    } catch (err) {
      return { success: false, error: err.message, channelId: canonicalId };
    }
  }

  /**
   * Unsubscribes from a single channel on YouTube
   */
  async function unsubscribeChannel(channelIdOrHandle) {
    if (!channelIdOrHandle) {
      return { success: false, error: 'MISSING_CHANNEL_ID' };
    }

    const canonicalId = await resolveChannelId(channelIdOrHandle);
    if (!canonicalId || !canonicalId.startsWith('UC')) {
      return { success: false, error: 'INVALID_CHANNEL_ID', channelId: channelIdOrHandle };
    }

    const session = await getAuthSession();
    if (!session.sapisid) {
      return { success: false, error: 'NOT_LOGGED_IN', channelId: canonicalId };
    }

    const authHeader = await getSapisidHash(session.sapisid);
    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://www.youtube.com',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': session.clientVersion
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    if (session.visitorData) {
      headers['X-Goog-Visitor-Id'] = session.visitorData;
    }

    const payload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: session.clientVersion
        }
      },
      channelIds: [canonicalId],
      params: 'CgIIBBgA'
    };

    try {
      const resp = await fetch(`https://www.youtube.com/youtubei/v1/subscription/unsubscribe?key=${session.apiKey}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const json = await resp.json().catch(() => ({}));
        if (cachedSubscribedChannels) {
          if (cachedSubscribedChannels.channelIds) {
            cachedSubscribedChannels.channelIds.delete(canonicalId);
          }
          if (cachedSubscribedChannels.channelsList) {
            cachedSubscribedChannels.channelsList = cachedSubscribedChannels.channelsList.filter(c => c.id !== canonicalId);
          }
        }
        return { success: true, channelId: canonicalId, data: json };
      } else if (resp.status === 401 || resp.status === 403) {
        return { success: false, error: 'AUTH_FAILED', status: resp.status, channelId: canonicalId };
      } else {
        return { success: false, error: `HTTP_${resp.status}`, status: resp.status, channelId: canonicalId };
      }
    } catch (err) {
      return { success: false, error: err.message, channelId: canonicalId };
    }
  }

  /**
   * Compares a list of channels against YouTube subscription status
   * Returns: {
   *   subscribed: [...],            // in backup & currently subscribed on YouTube
   *   unsubscribed: [...],          // in backup & NOT yet subscribed on YouTube
   *   redundantSubscribed: [...],   // currently subscribed on YouTube & NOT in backup
   *   isLoggedIn: boolean
   * }
   */
  async function compareSubscriptions(channelsList) {
    const subsData = await fetchSubscribedChannels();
    const { channelIds, handles, channelsList: liveChannelsList, isLoggedIn } = subsData;

    const subscribed = [];
    const unsubscribed = [];

    const backupIds = new Set();
    const backupHandles = new Set();

    for (const ch of channelsList) {
      const id = ch.id ? String(ch.id).trim() : '';
      const handle = ch.handle ? String(ch.handle).trim().toLowerCase() : '';
      const normHandle = handle.replace(/^@/, '');

      if (id) {
        backupIds.add(id.toLowerCase());
      }
      if (normHandle) {
        backupHandles.add(normHandle);
        backupHandles.add('@' + normHandle);
      }

      let isSub = false;
      if (id && channelIds.has(id)) {
        isSub = true;
      } else if (handle && (handles.has(handle) || handles.has(`@${normHandle}`))) {
        isSub = true;
      } else if (ch.isSubscribed === true) {
        isSub = true;
      }

      if (isSub) {
        subscribed.push(ch);
      } else {
        unsubscribed.push(ch);
      }
    }

    // Identify channels currently subscribed on YouTube that are NOT in backup
    const redundantSubscribed = [];
    const candidateList = (liveChannelsList && liveChannelsList.length > 0)
      ? liveChannelsList
      : Array.from(channelIds).map(cid => ({ id: cid, name: cid, handle: '', avatarUrl: '' }));

    for (const liveCh of candidateList) {
      const lId = liveCh.id ? String(liveCh.id).trim().toLowerCase() : '';
      const lHandle = liveCh.handle ? String(liveCh.handle).trim().toLowerCase().replace(/^@/, '') : '';

      const matchedInBackup = (lId && backupIds.has(lId)) ||
                             (lHandle && (backupHandles.has(lHandle) || backupHandles.has('@' + lHandle)));

      if (!matchedInBackup) {
        redundantSubscribed.push(liveCh);
      }
    }

    return {
      subscribed,
      unsubscribed,
      redundantSubscribed,
      isLoggedIn
    };
  }

  /**
   * Batch subscribes to multiple channels with safety delay and progress callbacks
   */
  async function batchSubscribeWithProgress(channels, {
    delayMs = 500,
    onProgress = null,
    shouldAbort = null
  } = {}) {
    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < channels.length; i++) {
      if (shouldAbort && shouldAbort()) {
        break;
      }

      const ch = channels[i];
      const target = ch.id || ch.handle;
      const displayName = ch.name || ch.handle || ch.id || `頻道 #${i + 1}`;

      if (onProgress) {
        onProgress({
          index: i + 1,
          total: channels.length,
          channel: ch,
          displayName,
          status: 'subscribing'
        });
      }

      const res = await subscribeChannel(target);

      if (res.success) {
        succeeded++;
      } else {
        failed++;
      }

      results.push({
        channel: ch,
        result: res
      });

      if (onProgress) {
        onProgress({
          index: i + 1,
          total: channels.length,
          channel: ch,
          displayName,
          status: res.success ? 'success' : 'error',
          error: res.error
        });
      }

      // Respectful delay between requests to prevent rate-limiting
      if (i < channels.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    return {
      total: channels.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * Batch unsubscribes from multiple channels with safety delay and progress callbacks
   */
  async function batchUnsubscribeWithProgress(channels, {
    delayMs = 500,
    onProgress = null,
    shouldAbort = null
  } = {}) {
    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < channels.length; i++) {
      if (shouldAbort && shouldAbort()) {
        break;
      }

      const ch = channels[i];
      const target = ch.id || ch.handle;
      const displayName = ch.name || ch.handle || ch.id || `頻道 #${i + 1}`;

      if (onProgress) {
        onProgress({
          index: i + 1,
          total: channels.length,
          channel: ch,
          displayName,
          status: 'unsubscribing'
        });
      }

      const res = await unsubscribeChannel(target);

      if (res.success) {
        succeeded++;
      } else {
        failed++;
      }

      results.push({
        channel: ch,
        result: res
      });

      if (onProgress) {
        onProgress({
          index: i + 1,
          total: channels.length,
          channel: ch,
          displayName,
          status: res.success ? 'success' : 'error',
          error: res.error
        });
      }

      if (i < channels.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    return {
      total: channels.length,
      succeeded,
      failed,
      results
    };
  }

  return {
    getSapisidHash,
    getAuthSession,
    resolveChannelId,
    fetchSubscribedChannels,
    compareSubscriptions,
    subscribeChannel,
    unsubscribeChannel,
    batchSubscribeWithProgress,
    batchUnsubscribeWithProgress,
    extractContinuationToken
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = YTSubscriptionService;
}
