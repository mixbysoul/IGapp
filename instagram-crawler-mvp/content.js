(() => {
  if (window.__IG_ORGANIZER_BOOTSTRAPPED) {
    return;
  }
  window.__IG_ORGANIZER_BOOTSTRAPPED = true;

  const PROFILE_PATH = /^\/([A-Za-z0-9._]+)\/$/;
  const POST_PATH = /^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)\/?$/;
  const BLOCKED_PROFILE_SEGMENTS = new Set([
    'accounts',
    'account',
    'about',
    'explore',
    'reels',
    'reel',
    'p',
    'tags',
    'tv',
    'developers',
    'directory',
    'legal',
    'help',
    'stories',
    'explore',
    'accounts',
    'support',
    'login',
    'logout',
    'terms',
    'privacy'
  ]);
  const LAUNCHER_ID = '__igOrganizerLauncher';
  const LAUNCHER_STORAGE_KEY = 'igOrganizerLauncherHiddenUntil';
  const SCRAPE_DELAY_MS = 700;
  const SAVED_SEGMENT = 'saved';
  const SAVED_ALL_POSTS_SEGMENT = 'all-posts';
  const crawlState = {
    saved: { running: false, stopRequested: false },
    following: { running: false, stopRequested: false }
  };
  const STOP_REQUEST_KEY = '__IG_ORGANIZER_STOP_REQUESTS';
  let stopRequestStore = {};
  const normalizeStopRequestStore = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value;
  };

  const persistStopRequestStore = () => {
    try {
      chrome.storage?.local?.set({ [STOP_REQUEST_KEY]: stopRequestStore });
    } catch {
      // ignore persistence failures
    }
  };

  const updateStopRequestStoreFromWindow = () => {
    try {
      stopRequestStore = {
        ...normalizeStopRequestStore(window[STOP_REQUEST_KEY])
      };
    } catch {
      stopRequestStore = {};
    }
  };

  const hydrateStopRequestStore = () => {
    try {
      chrome.storage?.local?.get(STOP_REQUEST_KEY, (items) => {
        try {
          stopRequestStore = normalizeStopRequestStore(items?.[STOP_REQUEST_KEY]);
        } catch {
          stopRequestStore = {};
        }
      });
    } catch {
      updateStopRequestStoreFromWindow();
    }
  };

  try {
    hydrateStopRequestStore();
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[STOP_REQUEST_KEY]) {
        return;
      }
      try {
        stopRequestStore = normalizeStopRequestStore(changes[STOP_REQUEST_KEY].newValue);
      } catch {
        stopRequestStore = {};
      }
    });
  } catch {
    // ignore storage event wiring failures
  }

  const ensureStopRequests = () => {
    updateStopRequestStoreFromWindow();
    const bucket = normalizeStopRequestStore(stopRequestStore);
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
      return {};
    }
    try {
      const current = window[STOP_REQUEST_KEY];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return { ...current };
      }
    } catch {
      // ignore
    }
    window[STOP_REQUEST_KEY] = bucket;
    return bucket;
  };

  const setCrawlState = (mode, updates) => {
    const state = crawlState[mode];
    if (!state) {
      return;
    }
    Object.assign(state, updates);
  };

  const requestCrawlStop = (mode) => {
    setCrawlState(mode, { stopRequested: true });
    try {
      const stops = ensureStopRequests();
      const nextStops = {
        ...normalizeStopRequestStore(stops),
        [String(mode)]: true
      };
      stopRequestStore = nextStops;
      window[STOP_REQUEST_KEY] = nextStops;
      persistStopRequestStore();
    } catch {
      // ignore
    }
  };

  const clearCrawlStop = (mode) => {
    setCrawlState(mode, { stopRequested: false });
    try {
      const stops = ensureStopRequests();
      const nextStops = normalizeStopRequestStore(stops);
      delete nextStops[String(mode)];
      stopRequestStore = nextStops;
      window[STOP_REQUEST_KEY] = nextStops;
      persistStopRequestStore();
    } catch {
      // ignore
    }
  };

  const markCrawlRunning = (mode, running) => {
    setCrawlState(mode, { running: Boolean(running) });
  };

  const isCrawlRunning = (mode) => Boolean(crawlState[mode]?.running);
  const isCrawlStopRequested = (mode) => {
    if (crawlState[mode]?.stopRequested) {
      return true;
    }
    updateStopRequestStoreFromWindow();
    const fromWindow = normalizeStopRequestStore(window[STOP_REQUEST_KEY])[String(mode)];
    const fromStore = normalizeStopRequestStore(stopRequestStore)[String(mode)];
    if (fromStore) {
      return true;
    }
    if (fromWindow) {
      return true;
    }
    return false;
  };

  const getStopRequestsFromStorageAsync = () => {
    return new Promise((resolve) => {
      if (!chrome.storage?.local?.get) {
        resolve({});
        return;
      }

      chrome.storage.local.get(STOP_REQUEST_KEY, (items) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        const parsed = normalizeStopRequestStore(items?.[STOP_REQUEST_KEY]);
        stopRequestStore = parsed;
        window[STOP_REQUEST_KEY] = parsed;
        resolve(parsed);
      });
    });
  };

  const isCrawlStopRequestedAsync = async (mode) => {
    if (isCrawlStopRequested(mode)) {
      return true;
    }

    const parsed = await getStopRequestsFromStorageAsync();
    return Boolean(parsed[String(mode)]);
  };

  const toAbsoluteUrl = (href) => {
    try {
      return new URL(href, location.href).toString();
    } catch (error) {
      return href;
    }
  };

  const sanitize = (value) => {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\u200b/g, '')
      .trim();
  };

  const isInstagram = () => {
    return /instagram\.com$/.test(location.hostname);
  };

  const parsePostInfoFromHref = (href) => {
    try {
      const path = new URL(href, location.href).pathname;
      const match = path.match(POST_PATH);
      if (!match) {
        return null;
      }
      return {
        kind: match[1],
        id: match[2],
        href: match[1] === 'p' ? `/p/${match[2]}/` : `/${match[1]}/${match[2]}/`
      };
    } catch (error) {
      return null;
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isMeaningfulValue = (value) => {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  };

  const mergeCrawlRecord = (existing, incoming) => {
    const merged = { ...(existing || {}) };
    Object.entries(incoming || {}).forEach(([key, value]) => {
      if (!isMeaningfulValue(value)) {
        return;
      }
      merged[key] = value;
    });
    return merged;
  };

  const parseProfileFromHref = (href) => {
    try {
      const path = new URL(href, location.href).pathname;
      const match = path.match(PROFILE_PATH);
      if (!match) {
        return null;
      }
      const username = match[1];
      if (BLOCKED_PROFILE_SEGMENTS.has(username) || username.length > 40) {
        return null;
      }
      return username;
    } catch (error) {
      return null;
    }
  };

  const toNormalizedPath = (urlLike) => {
    try {
      return new URL(urlLike, location.href).pathname.replace(/\/?$/, '/');
    } catch {
      return '';
    }
  };

  const getSavedProfileFromPath = () => {
    const match = location.pathname.match(new RegExp(`^/([A-Za-z0-9._]+)/${SAVED_SEGMENT}/(?:[^/?#]+)?/?$`));
    if (!match) {
      return '';
    }
    const username = match[1];
    if (BLOCKED_PROFILE_SEGMENTS.has(username)) {
      return '';
    }
    return username;
  };

  const getCurrentSavedFolder = () => {
    const match = location.pathname.match(new RegExp(`^/([A-Za-z0-9._]+)/${SAVED_SEGMENT}/([^/?#]+)/?$`));
    if (!match) {
      return '';
    }
    return sanitize(match[2]).toLowerCase();
  };

  const parseSavedFolderFromHref = (href) => {
    try {
      const path = new URL(href, location.href).pathname;
      const match = path.match(new RegExp(`^/([A-Za-z0-9._]+)/${SAVED_SEGMENT}/([^/?#]+)/?$`));
      if (!match) {
        return null;
      }
      const username = match[1];
      const folder = match[2];
      if (BLOCKED_PROFILE_SEGMENTS.has(username) || username.length > 40) {
        return null;
      }
      return {
        username,
        folder: sanitize(folder).toLowerCase(),
        path: `/${username}/${SAVED_SEGMENT}/${folder}/`
      };
    } catch {
      return null;
    }
  };

  const getSavedFolderTargets = () => {
    const owner = getSavedProfileFromPath();
    if (!owner) {
      return [];
    }

    const allPostsPath = `/${owner}/${SAVED_SEGMENT}/${SAVED_ALL_POSTS_SEGMENT}/`;
    const regular = [];
    const seen = new Set();

    const anchors = [...document.querySelectorAll('a[href]')];
    anchors.forEach((anchor) => {
      const parsed = parseSavedFolderFromHref(anchor.getAttribute('href') || '');
      if (!parsed || parsed.username !== owner) {
        return;
      }

      if (parsed.folder === SAVED_ALL_POSTS_SEGMENT) {
        return;
      }

      const path = toNormalizedPath(parsed.path);
      if (!path || seen.has(path)) {
        return;
      }

      regular.push(path);
      seen.add(path);
    });

    const currentFolder = getCurrentSavedFolder();
    if (currentFolder && currentFolder !== SAVED_ALL_POSTS_SEGMENT) {
      const currentPath = `/${owner}/${SAVED_SEGMENT}/${currentFolder}/`;
      const normalizedCurrent = toNormalizedPath(currentPath);
      if (normalizedCurrent && !seen.has(normalizedCurrent)) {
        regular.unshift(normalizedCurrent);
      }
    }

    const finalTargets = [...regular];
    const normalizedAll = toNormalizedPath(allPostsPath);
    const withoutAll = finalTargets.filter((path) => path !== normalizedAll);
    if (normalizedAll) {
      withoutAll.push(normalizedAll);
    } else if (allPostsPath) {
      withoutAll.push(allPostsPath);
    }

    return withoutAll;
  };

  const waitForSavedRouteReady = async (targetPath) => {
    const target = toNormalizedPath(targetPath);
    const start = Date.now();
    let stableRound = 0;
    let lastCount = -1;

    while (Date.now() - start < 12000) {
      const currentPath = toNormalizedPath(location.pathname);
      if (currentPath === target) {
        const anchors = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
        const count = anchors.length;

        if ((count > 0 && count === lastCount) || (count > 0 && Date.now() - start >= 1200)) {
          return true;
        }
        if (count === 0) {
          return true;
        }
        if (count === lastCount) {
          stableRound += 1;
        } else {
          stableRound = 0;
          lastCount = count;
        }
        if (stableRound >= 2) {
          return true;
        }
      }
      await sleep(300);
    }
    return toNormalizedPath(location.pathname) === target;
  };

  const navigateToSavedFolder = async (targetPath) => {
    const target = toNormalizedPath(targetPath);
    if (toNormalizedPath(location.pathname) === target) {
      await waitForSavedRouteReady(target);
      return true;
    }

    const targetUrl = toAbsoluteUrl(target);
    const anchors = [...document.querySelectorAll('a[href]')];
    const link = anchors.find((anchor) => toNormalizedPath(anchor.getAttribute('href') || '') === target);
    if (link) {
      link.click();
    } else {
      history.pushState({}, '', targetUrl);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }

    return waitForSavedRouteReady(target);
  };

  const shouldHideLauncher = async () => {
    const response = await new Promise((resolve) => {
      chrome.storage.local.get(LAUNCHER_STORAGE_KEY, (items) => resolve(items || {}));
    });
    const hiddenUntil = Number(response[LAUNCHER_STORAGE_KEY] || 0);
    return Number.isFinite(hiddenUntil) && hiddenUntil > Date.now();
  };

  const hideLauncherTemporarily = () => {
    const nextUntil = Date.now() + 24 * 60 * 60 * 1000;
    chrome.storage.local.set({ [LAUNCHER_STORAGE_KEY]: nextUntil });
  };

  const ensureLauncherButton = async () => {
    const existing = document.getElementById(LAUNCHER_ID);
    if (existing) {
      return;
    }

    const hidden = await shouldHideLauncher();
    if (hidden) {
      return;
    }

    const host = document.createElement('div');
    host.id = LAUNCHER_ID;
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '16px';
    host.style.zIndex = '2147483647';
    host.style.fontSize = '12px';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #0f172a;
          color: #ffffff;
          border-radius: 999px;
          border: 1px solid #1f2937;
          padding: 8px 10px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
        }
        button {
          border: 0;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .open {
          color: #0f172a;
          background: #f8fafc;
        }
        .close {
          background: #1f2937;
          color: #e5e7eb;
          width: 20px;
          height: 20px;
          padding: 0;
          line-height: 1;
        }
        .label {
          white-space: nowrap;
          opacity: 0.85;
          margin-right: 2px;
        }
      </style>
      <div class="wrap">
        <span class="label">IG 정리기</span>
        <button class="open" id="openOrganizer">열기</button>
        <button class="close" id="hideLauncher" aria-label="임시 숨기기">×</button>
      </div>
    `;

    const openBtn = shadow.querySelector('#openOrganizer');
    const closeBtn = shadow.querySelector('#hideLauncher');
    openBtn.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('popup/dashboard.html'), '_blank');
    });
    closeBtn.addEventListener('click', () => {
      hideLauncherTemporarily();
      host.remove();
    });

    document.body.appendChild(host);
  };

  const extractAuthor = (container, fallbackAnchor) => {
    const candidateAnchors = [...(container ? container.querySelectorAll('a[href]') : [])];
    if (fallbackAnchor) {
      candidateAnchors.push(fallbackAnchor);
    }
    for (const anchor of candidateAnchors) {
      const username = parseProfileFromHref(anchor.getAttribute('href') || '');
      if (username) {
        return username;
      }
    }
    return '';
  };

  const extractCaption = (container, fallbackAnchor) => {
    const anchors = [...(container ? container.querySelectorAll('span[dir="auto"]') : [])];
    const texts = anchors
      .map((node) => sanitize(node.textContent))
      .filter(Boolean);

    if (fallbackAnchor) {
      const anchorText = sanitize(fallbackAnchor.textContent);
      if (anchorText) {
        texts.push(anchorText);
      }
    }

    if (!texts.length) {
      return '';
    }
    return texts.reduce((winner, text) => (text.length > winner.length ? text : winner), texts[0]);
  };

  const toImageUrl = (value) => {
    const raw = sanitize(value);
    if (!raw) {
      return '';
    }
    if (/^https?:\/\//i.test(raw) || /^\/\//.test(raw)) {
      if (/^\/\//.test(raw)) {
        return `${location.protocol}${raw}`;
      }
      return raw;
    }
    return toAbsoluteUrl(raw);
  };

  const parseImageFromUrl = (url) => {
    const sizeMatch = String(url).match(/\/s(\d+)x(\d+)\//i);
    if (sizeMatch) {
      return { width: Number(sizeMatch[1] || 0), height: Number(sizeMatch[2] || 0) };
    }
    const wMatch = String(url).match(/[?&]w=(\d+)/i);
    const hMatch = String(url).match(/[?&]h=(\d+)/i);
    if (wMatch || hMatch) {
      return { width: Number(wMatch?.[1] || 0), height: Number(hMatch?.[1] || 0) };
    }
    return { width: 0, height: 0 };
  };

  const isLikelyAvatarOrBadgeImage = (url, area) => {
    const lower = String(url || '').toLowerCase();
    if (!lower) {
      return true;
    }
    if (/^data:|^blob:/i.test(lower)) {
      return true;
    }
    if (area > 0 && area <= 72 * 72) {
      return true;
    }
    if (/profile|avatar|icon|badge|emoji|logo|sparkle/.test(lower)) {
      return true;
    }
    if (/s(5\d|6\d|7\d|8\d|9\d|1[0-5]\d)x/.test(lower)) {
      return true;
    }
    const size = parseImageFromUrl(lower);
    if ((size.width && size.width <= 160) || (size.height && size.height <= 160)) {
      return true;
    }
    return false;
  };

  const isSafeImageUrl = (url) => {
    const safe = toImageUrl(url);
    if (!safe || safe.startsWith('data:') || safe.startsWith('blob:')) {
      return false;
    }
    return /^https?:\/\//i.test(safe);
  };

  const isHighQualityImageUrl = (url) => {
    const lower = String(url).toLowerCase();
    return /\.(jpe?g|png|webp|avif)(\?|$)/.test(lower) || /scontent|cdninstagram/.test(lower);
  };

  const pickFromSrcSet = (raw) => {
    if (!raw) {
      return '';
    }
    const entries = String(raw)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const picked = entries
      .map((entry) => {
        const parts = entry.split(/\s+/);
        const src = parts[0] || '';
        const width = Number((parts.find((part) => /\d+w/.test(part)) || '0w').replace('w', ''));
        return {
          src,
          width: Number.isFinite(width) ? width : 0
        };
      })
      .filter((entryItem) => entryItem.src)
      .sort((a, b) => b.width - a.width)[0];
    return picked?.src || '';
  };

  const extractMediaUrl = (node) => {
    if (!node) {
      return '';
    }
    const srcSetUrl = pickFromSrcSet(
      node.getAttribute('srcset') ||
        node.getAttribute('data-srcset') ||
        node.getAttribute('data-video-sources')
    );
    if (srcSetUrl) {
      return toImageUrl(srcSetUrl);
    }
    if (node.tagName.toLowerCase() === 'video') {
      return toImageUrl(
        node.poster ||
          node.getAttribute('poster') ||
          node.getAttribute('data-poster') ||
          ''
      );
    }
    return toImageUrl(
      node.getAttribute('src') ||
        node.getAttribute('data-src') ||
        node.getAttribute('poster') ||
        node.getAttribute('data-poster') ||
        ''
    );
  };

  const getNodeArea = (node) => {
    if (!node) {
      return 0;
    }
    const width = Number(node.clientWidth || node.width || 0);
    const height = Number(node.clientHeight || node.height || 0);
    return width * height;
  };

  const extractThumbnailFromContainer = (container, preferredAnchor) => {
    if (!container) {
      return '';
    }

    const directNodes = preferredAnchor ? [...preferredAnchor.querySelectorAll('img, video, source')] : [];
    const scopedNodes = [...container.querySelectorAll('img, video, source, picture')];
    const nodeList = [...directNodes, ...scopedNodes];
    const unique = new Map();
    nodeList.forEach((node) => {
      if (!node || unique.has(node)) {
        return;
      }
      unique.set(node, node);
    });

    const candidates = [...unique.values()]
      .map((node) => {
        const url = extractMediaUrl(node);
        const area = getNodeArea(node);
        const size = parseImageFromUrl(url);
        const isSmall = isLikelyAvatarOrBadgeImage(url, area);
        const srcsetScore = size.width > 0 ? Math.max(0, size.width + size.height) : 0;
        const areaScore = Math.min(8000, area);
        const priority = preferredAnchor && preferredAnchor.contains(node) ? 250 : 0;
        let score = areaScore + srcsetScore * 0.4 + priority;
        if (isSmall) {
          score -= 400;
        }
        if (isHighQualityImageUrl(url)) {
          score += 120;
        }
        if (!isSafeImageUrl(url)) {
          score = -1;
        }
        return { url, score };
      })
      .filter((candidate) => candidate.url && candidate.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.url || '';
  };

  const extractSavedTime = (container) => {
    const timeNode = container ? container.querySelector('time[datetime]') : null;
    if (!timeNode) {
      return '';
    }
    return sanitize(timeNode.getAttribute('datetime') || '');
  };

  const collectSavedPosts = () => {
    const anchors = [
      ...document.querySelectorAll(
        'article a[href*="/p/"], article a[href*="/reel/"], article a[href*="/reels/"], article a[href*="/tv/"]'
      ),
      ...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'),
      ...document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"], a[href^="/tv/"]')
    ];
    const map = new Map();

    anchors.forEach((anchor) => {
      const postInfo = parsePostInfoFromHref(anchor.getAttribute('href') || '');
      if (!postInfo) {
        return;
      }

      const article =
        anchor.closest('article') ||
        anchor.closest('main') ||
        document.body;

      const postId = postInfo.id;
      if (map.has(postId)) {
        return;
      }

      const post = {
        postId,
        kind: postInfo.kind,
        link: toAbsoluteUrl(postInfo.href),
        username: extractAuthor(article, anchor),
        caption: extractCaption(article, anchor),
        thumbnail: extractThumbnailFromContainer(article, anchor),
        sourceFolder: getCurrentSavedFolder(),
        savedAt: extractSavedTime(article),
        href: postInfo.href,
        discoveredAt: new Date().toISOString()
      };

      map.set(postId, post);
    });

    return [...map.values()];
  };

  const findFollowerDialog = () => {
    const dialogs = [...document.querySelectorAll('div[role="dialog"], [role="dialog"]')];
    const scored = dialogs
      .map((dialog) => {
        const anchors = [...dialog.querySelectorAll('a[href]')];
        const usernames = anchors
          .map((anchor) => parseProfileFromHref(anchor.getAttribute('href') || ''))
          .filter(Boolean);
        const headingText = sanitize(
          (dialog.querySelector('[role="heading"]')?.textContent || '') +
            (dialog.querySelector('h1, h2, h3')?.textContent || '')
        );
        const hasFollowerSignal = /팔로우|팔로워|followers|following/i.test(headingText);
        const textScore = hasFollowerSignal ? 10 : 0;
        return {
          dialog,
          count: usernames.length,
          score: usernames.length * 12 + textScore
        };
      })
      .filter((item) => item.count >= 4)
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      return scored[0].dialog;
    }

    return null;
  };

  const extractFollowDisplayName = (row, anchor, username) => {
    const names = [
      ...(row ? row.querySelectorAll('h2, h3, span[dir="auto"]') : []),
      anchor
    ]
      .filter(Boolean)
      .map((node) => sanitize(node.textContent))
      .filter((text) => text && text !== username);
    return names.find((name) => name && name.length <= 40 && !/@/.test(name)) || username;
  };

  const collectFollowingUsers = () => {
    const dialog = findFollowerDialog();
    const scopeNode = dialog || document.querySelector('main') || document.body;
    const anchors = [...scopeNode.querySelectorAll('a[href]')];
    const map = new Map();

    anchors.forEach((anchor) => {
      const username = parseProfileFromHref(anchor.getAttribute('href') || '');
      if (!username) {
        return;
      }

      const card =
        anchor.closest('li') ||
        anchor.closest('div[role="button"]') ||
        anchor.closest('article') ||
        anchor.closest('main') ||
        anchor.parentElement;

      const rawBio = [
        ...(card ? card.querySelectorAll('span[dir="auto"]') : [])
      ]
        .map((node) => sanitize(node.textContent))
        .filter(Boolean)
        .find((text) => text.length > 1 && !text.includes(username));

      if (!map.has(username)) {
        map.set(username, {
          username,
          displayName: extractFollowDisplayName(card, anchor, username),
          profileUrl: toAbsoluteUrl(`/${username}/`),
          bio: rawBio || '',
          sourcePage: location.pathname,
          discoveredAt: new Date().toISOString()
        });
      }
    });

    return [...map.values()];
  };

  const collectSavedPostsAcrossFolders = async () => {
    const targets = getSavedFolderTargets();
    if (!targets.length) {
      return collectWithAutoScroll('saved', collectSavedPosts, (item) => item.postId);
    }

    const crawlAt = Date.now();
    let crawlOrder = 0;
    const merged = new Map();
    const metaHistory = [];
    let totalChecked = 0;
    let totalCandidates = 0;
    let totalCollected = 0;
    let maxRoundsReached = false;
    let maxRounds = 0;
    let stoppedByUser = false;

    for (const target of targets) {
      if (isCrawlStopRequested('saved')) {
        stoppedByUser = true;
        break;
      }

      const navigated = await navigateToSavedFolder(target);
      if (!navigated) {
        continue;
      }

      const result = await collectWithAutoScroll('saved', collectSavedPosts, (item) => item.postId, {
        crawlAt,
        crawlOrderStart: crawlOrder
      });
      if (result?.meta?.stopped) {
        stoppedByUser = true;
      }

      const items = result.items || [];
      items.forEach((item) => {
        const key = item.postId || item.id;
        if (!key || merged.has(key)) {
          return;
        }
        merged.set(key, item);
      });

      if (typeof result.nextCrawlOrder === 'number') {
        crawlOrder = result.nextCrawlOrder;
      }
      totalChecked += Number(result.meta?.totalChecked || 0);
      totalCandidates += Number(result.meta?.totalCandidates || 0);
      totalCollected += Number(result.meta?.collected || 0);
      maxRounds = Math.max(maxRounds, Number(result.meta?.rounds || 0));
      metaHistory.push({
        target,
        meta: result.meta || {},
        count: result.count || 0
      });
      if (result.meta && result.meta.maxRoundsReached) {
        maxRoundsReached = true;
      }
      if (isCrawlStopRequested('saved')) {
        stoppedByUser = true;
        break;
      }
    }

    return {
      items: [...merged.values()],
      count: merged.size,
      batchFlushed: true,
      metaHistory,
      maxRoundsReached,
      meta: {
        savedFolders: targets,
        savedFolderCount: targets.length,
        folderRuns: metaHistory,
        totalChecked,
        totalCandidates,
        collected: totalCollected,
        rounds: maxRounds,
        maxRoundsReached,
        stopped: stoppedByUser
      }
    };
  };

  const collectWithAutoScroll = async (requestMode, collector, keySelector, options = {}) => {
    const isWindowScroller = (node) => (
      node === document.scrollingElement ||
      node === document.documentElement ||
      node === document.body
    );

    const isScrollable = (node) => {
      if (!node || !(node instanceof Element)) {
        return false;
      }
      const style = getComputedStyle(node);
      const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
      const hasScrollableHeight = node.scrollHeight > node.clientHeight + 24;
      return hasOverflow || hasScrollableHeight;
    };

    const detectFollowerScroller = () => {
      const dialog = findFollowerDialog();
      if (!dialog) {
        return null;
      }
      const nodes = [dialog, ...dialog.querySelectorAll('div, section, ul, main')];
      const candidates = nodes
        .filter((node) => node instanceof Element)
        .map((node) => {
          const links = [...node.querySelectorAll('a[href]')].filter((anchor) =>
            Boolean(parseProfileFromHref(anchor.getAttribute('href') || ''))
          ).length;
          return {
            node,
            score: (isScrollable(node) ? 2000 : 0) + links * 100 + node.scrollHeight
          };
        })
        .filter((item) => item.score > 0);

      if (!candidates.length) {
        return dialog;
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].node;
    };

    const detectPageScroller = () => {
      const candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        ...document.querySelectorAll('main, [role="main"], section, div')
      ].filter(Boolean);
      const sorted = candidates
        .map((node) => {
          if (!isScrollable(node)) {
            return { node, score: 0 };
          }
          return { node, score: node.scrollHeight + (isWindowScroller(node) ? 100000 : 0) };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      return sorted[0]?.node || document.scrollingElement || document.documentElement || document.body;
    };

    const getScroller = () => {
      if (requestMode === 'following') {
        return detectFollowerScroller() || detectPageScroller();
      }
      return detectPageScroller();
    };

    const isAtBottom = (scroller) => {
      if (!scroller) {
        return true;
      }
      if (isWindowScroller(scroller)) {
        const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        return window.scrollY + window.innerHeight >= docHeight - 16;
      }
      return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 16;
    };

    const scrollOne = (scroller) => {
      if (!scroller) {
        return;
      }
      if (isWindowScroller(scroller)) {
        window.scrollTo(0, window.scrollY + Math.max(700, window.innerHeight * 0.9));
        return;
      }
      scroller.scrollTop = scroller.scrollTop + Math.max(220, scroller.clientHeight * 0.85);
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    };

    const sendChunk = async (kind, payloadItems, maxRetry = 3) => {
      let attempt = 0;
      let lastError = 'background merge failed';
      while (attempt < maxRetry) {
        attempt += 1;
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'crawl:result',
              payload: {
                kind,
                items: payloadItems
              }
            },
            (result) => {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              resolve(result || { ok: false, error: 'No response' });
            }
          );
        });

        if (response && response.ok) {
          return response;
        }

        lastError = String(response?.error || 'No response');
        if (attempt >= maxRetry) {
          break;
        }
        await sleep(120 * attempt);
      }
      return { ok: false, error: lastError };
    };

    const requestedBatchSize = Number(options.batchSize);
    const batchSize = requestMode === 'following'
      ? Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
        ? Math.max(1, Math.floor(requestedBatchSize))
        : 500
      : Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
        ? Math.max(1, Math.floor(requestedBatchSize))
        : 400;
    const merged = new Map();
    const queued = new Map();
    let totalCandidates = 0;
    let totalChecked = 0;
    let rounds = 0;
    let stable = 0;
    let prevHeight = -1;
    let scroller = getScroller();
    const maxRounds = requestMode === 'following' ? 3000 : 300;
    const stableRoundLimit = requestMode === 'following' ? 12 : 8;
    const kind = requestMode === 'following' ? 'following' : 'saved';
    let maxRoundsReached = false;
    let reachedBottom = false;
    let chunkCallCount = 0;
    let accumulatedAdded = 0;
    let accumulatedUpdated = 0;
    let lastStoredCount = 0;
    const crawlAt = Number.isFinite(Number(options.crawlAt)) ? Number(options.crawlAt) : Date.now();
    let crawlOrder = Number.isFinite(Number(options.crawlOrderStart)) ? Number(options.crawlOrderStart) : 0;
    const normalizeKey = (item) => {
      if (keySelector) {
        return keySelector(item);
      }
      return item.postId || item.id || item.username;
    };

    const flush = async (force = false) => {
      if (!force && queued.size < batchSize) {
        return 0;
      }
      if (!queued.size) {
        return 0;
      }
      const payload = [...queued.values()];
      const response = await sendChunk(kind, payload);
      if (!response || !response.ok) {
        throw new Error(response?.error || 'background merge failed');
      }
      accumulatedAdded += Number(response.added || 0);
      accumulatedUpdated += Number(response.updated || 0);
      lastStoredCount = Number(response.count || 0);
      queued.clear();
      chunkCallCount += 1;
      return payload.length;
    };

    let stoppedByUser = false;

    for (let i = 0; i < maxRounds; i += 1) {
      if (isCrawlStopRequested(requestMode)) {
        stoppedByUser = true;
        break;
      }

      scroller = getScroller() || scroller;
      if (!scroller) {
        stoppedByUser = stoppedByUser || isCrawlStopRequested(requestMode);
        break;
      }

      rounds = i + 1;
      const height = isWindowScroller(scroller)
        ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
        : scroller.scrollHeight;
      if (height > prevHeight + 16) {
        stable = 0;
        prevHeight = height;
      } else {
        stable += 1;
      }

      const batch = collector();
      totalCandidates += batch.length;
      totalChecked += batch.length;

      batch.forEach((item) => {
        const key = normalizeKey(item);
        if (!key) {
          return;
        }
        const payloadItem = {
          ...item,
          crawlAt,
          crawlOrder: merged.has(key) ? (merged.get(key)?.crawlOrder ?? crawlOrder++) : crawlOrder++
        };
        if (!merged.has(key)) {
          merged.set(key, payloadItem);
          queued.set(key, payloadItem);
          return;
        }

        const mergedBefore = merged.get(key) || {};
        const mergedAfter = mergeCrawlRecord(mergedBefore, payloadItem);
        if (JSON.stringify(mergedAfter) !== JSON.stringify(mergedBefore)) {
          merged.set(key, mergedAfter);
          queued.set(key, mergedAfter);
        }
      });

      await flush();
      if (isCrawlStopRequested(requestMode)) {
        stoppedByUser = true;
        break;
      }

      reachedBottom = isAtBottom(scroller);
      if (reachedBottom && stable >= stableRoundLimit) {
        stoppedByUser = stoppedByUser || isCrawlStopRequested(requestMode);
        break;
      }

      if (isCrawlStopRequested(requestMode)) {
        stoppedByUser = true;
        break;
      }

      scrollOne(scroller);
      await sleep(SCRAPE_DELAY_MS);
      await sleep(180);
    }

    const lastPayload = await flush(true);
    maxRoundsReached = rounds >= maxRounds;

      return {
      items: [...merged.values()],
      count: merged.size,
      nextCrawlOrder: crawlOrder,
      meta: {
        totalChecked,
        totalCandidates,
        collected: merged.size,
        rounds,
        maxRoundsReached,
        batchSize,
        chunkCallCount,
        reachedBottom,
        appended: accumulatedAdded,
        updated: accumulatedUpdated,
        storedTotal: lastStoredCount,
        lastPayload,
        stopped: stoppedByUser
      },
      batchFlushed: true
    };
  };

  const sendCrawlResultToBackground = (kind, items) => {
    chrome.runtime.sendMessage({
      type: 'crawl:result',
      payload: {
        kind,
        items
      }
    });
  };

  const sendCrawlResultToBackgroundAsync = (kind, items) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'crawl:result',
          payload: {
            kind,
            items
          }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'No response' });
        }
      );
    });
  };

  const bootstrapLauncher = async () => {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', () => {
        ensureLauncherButton().catch(() => {});
      }, { once: true });
      return;
    }
    await ensureLauncherButton();
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === 'crawl:stop') {
      const requestMode = message.mode === 'following' ? 'following' : message.mode === 'saved' ? 'saved' : '';
      if (!requestMode) {
        sendResponse({ ok: false, error: `지원하지 않는 모드입니다: ${message.mode}` });
        return true;
      }
      requestCrawlStop(requestMode);
      sendResponse({ ok: true, mode: requestMode, running: isCrawlRunning(requestMode) });
      return true;
    }

    if (message.type !== 'crawl:start') {
      return false;
    }

  if (!isInstagram()) {
      sendResponse({
        ok: false,
        error: 'Instagram 페이지가 아닙니다. 인스타그램 탭에서 실행하세요.'
      });
      return false;
    }

    const requestMode = message.mode === 'following' ? 'following' : message.mode === 'saved' ? 'saved' : '';
    if (!requestMode) {
      sendResponse({ ok: false, error: `지원하지 않는 모드입니다: ${message.mode}` });
      return true;
    }

    if (isCrawlRunning(requestMode)) {
      sendResponse({ ok: false, error: `${requestMode} 크롤링이 이미 진행 중입니다.` });
      return true;
    }

    markCrawlRunning(requestMode, true);
    clearCrawlStop(requestMode);
    if (requestMode === 'saved') {
      (async () => {
        const { items, count, meta, batchFlushed, maxRoundsReached = false } = await collectSavedPostsAcrossFolders();
        const stopped = Boolean(meta?.stopped);
        if (!batchFlushed) {
          const forwarded = await sendCrawlResultToBackgroundAsync('saved', items);
          if (!forwarded.ok) {
            throw new Error(forwarded.error || '백그라운드 저장 실패');
          }
          sendResponse({ ok: true, kind: 'saved', count: items.length, meta, stopped });
          return;
        }
        sendResponse({ ok: true, kind: 'saved', count, meta, batchFlushed: true, maxRoundsReached, stopped });
      })().catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      }).finally(() => {
        markCrawlRunning(requestMode, false);
        clearCrawlStop(requestMode);
      });
      return true;
    }

    if (requestMode === 'following') {
      (async () => {
        const { items, count, meta, batchFlushed } = await collectWithAutoScroll(
          'following',
          collectFollowingUsers,
          (item) => item.username,
          { batchSize: 500 }
        );
        const stopped = Boolean(meta?.stopped);
        if (!batchFlushed) {
          const forwarded = await sendCrawlResultToBackgroundAsync('following', items);
          if (!forwarded.ok) {
            throw new Error(forwarded.error || '백그라운드 저장 실패');
          }
          sendResponse({ ok: true, kind: 'following', count: items.length, meta, stopped });
          return;
        }
        sendResponse({ ok: true, kind: 'following', count, meta, batchFlushed: true, stopped });
      })().catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      }).finally(() => {
        markCrawlRunning(requestMode, false);
        clearCrawlStop(requestMode);
      });
      return true;
    }

    sendResponse({ ok: false, error: `지원하지 않는 모드입니다: ${message.mode}` });
    markCrawlRunning(requestMode, false);
    clearCrawlStop(requestMode);
    return true;
  });

  (async () => {
    try {
      bootstrapLauncher();
    } catch (error) {
      // do nothing for launcher bootstrap failures
    }
  })();
})();
