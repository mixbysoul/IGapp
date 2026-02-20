const elements = {
  status: document.getElementById('status'),
  summary: document.getElementById('summary'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  postList: document.getElementById('postList'),
  friendList: document.getElementById('friendList'),
  crawlSaved: document.getElementById('crawlSaved'),
  crawlFollowing: document.getElementById('crawlFollowing'),
  clearData: document.getElementById('clearData'),
  toggleRawData: document.getElementById('toggleRawData'),
  copyRawData: document.getElementById('copyRawData'),
  downloadRawData: document.getElementById('downloadRawData'),
  rawData: document.getElementById('rawData')
};

let cachedData = null;
let lastCrawlMeta = null;
let cachedRawStorage = null;
const crawlState = {
  saved: { running: false },
  following: { running: false }
};
const STOP_REQUEST_KEY = '__IG_ORGANIZER_STOP_REQUESTS';

function setCrawlButton(mode, running) {
  const savedText = running ? '중지' : '저장글 수집';
  if (mode === 'saved' && elements.crawlSaved) {
    elements.crawlSaved.textContent = savedText;
  }

  if (mode === 'following' && elements.crawlFollowing) {
    elements.crawlFollowing.textContent = running ? '중지' : '팔로우 목록 수집';
  }
}

function isModeCrawling(mode) {
  return Boolean(crawlState[mode]?.running);
}

function setModeRunning(mode, running) {
  if (crawlState[mode]) {
    crawlState[mode].running = Boolean(running);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInstagramUrl(url = '') {
  return /^https?:\/\/(www\.|m\.)?instagram\.com\//.test(url);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(message) {
  elements.status.textContent = message;
}

function toAbsoluteUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return '';
  }
}

function getCategoryOptions(categories) {
  const unique = ['기타', ...(categories || [])];
  const uniqueSet = [...new Set(unique)];
  return uniqueSet.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
}

function getLocalStorageSnapshot() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: true, data: items || {} });
    });
  });
}

function setStopRequestInStorage(mode, enabled = true) {
  const requestMode = String(mode || '').trim();
  return new Promise((resolve) => {
    chrome.storage.local.get(STOP_REQUEST_KEY, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      const current = items && typeof items[STOP_REQUEST_KEY] === 'object' && !Array.isArray(items[STOP_REQUEST_KEY])
        ? { ...items[STOP_REQUEST_KEY] }
        : {};
      if (enabled) {
        current[requestMode] = true;
      } else {
        delete current[requestMode];
      }

      chrome.storage.local.set({ [STOP_REQUEST_KEY]: current }, () => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true });
      });
    });
  });
}

function prettyPrintStorage(data) {
  return JSON.stringify(data, null, 2);
}

async function loadRawStorage() {
  const response = await getLocalStorageSnapshot();
  if (!response.ok) {
    setStatus(`저장소 읽기 실패: ${response.error}`);
    return '';
  }
  const normalized = response.data || {};
  cachedRawStorage = normalized;
  return prettyPrintStorage(normalized);
}

function updateRawDataUi(content) {
  if (!elements.rawData) {
    return;
  }
  elements.rawData.textContent = content || '';
  if (content) {
    elements.rawData.classList.remove('hidden');
    if (elements.toggleRawData) {
      elements.toggleRawData.textContent = '원시 저장소 숨기기';
    }
    return;
  }
  elements.rawData.classList.add('hidden');
  if (elements.toggleRawData) {
    elements.toggleRawData.textContent = '원시 저장소 보기';
  }
}

async function handleToggleRawData() {
  if (!elements.rawData) {
    return;
  }
  if (!elements.rawData.classList.contains('hidden')) {
    updateRawDataUi('');
    return;
  }

  const content = await loadRawStorage();
  updateRawDataUi(content);
  if (!content) {
    setStatus('원시 저장소가 비어 있습니다.');
  }
}

async function handleCopyRawData() {
  if (!cachedRawStorage) {
    const content = await loadRawStorage();
    if (!content) {
      setStatus('복사할 저장소 데이터가 없습니다.');
      return;
    }
    cachedRawStorage = JSON.parse(content);
  }
  const text = prettyPrintStorage(cachedRawStorage);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('원시 저장소 JSON을 클립보드에 복사했습니다.');
  } catch (error) {
    setStatus(`복사 실패: ${error.message || '클립보드 접근이 거부됨'}`);
  }
}

async function handleDownloadRawData() {
  let payload = cachedRawStorage;
  if (!payload) {
    const content = await loadRawStorage();
    if (!content) {
      setStatus('내보낼 저장소 데이터가 없습니다.');
      return;
    }
    payload = JSON.parse(content);
  }
  const text = prettyPrintStorage(payload);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ig-organizer-storage-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus('원시 저장소 JSON으로 저장했습니다.');
}

function sendMessageToBackground(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

async function sendMessageToTabReliable(tabId, payload) {
  let response = await sendMessageToTab(tabId, payload);
  if (response.ok) {
    return response;
  }

  const errorMessage = String(response.error || '');
  if (!/Receiving end does not exist|Could not establish connection/i.test(errorMessage)) {
    return response;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await sleep(300);
    response = await sendMessageToTab(tabId, payload);
  } catch (error) {
    return { ok: false, error: `${errorMessage} / 재삽입 후 재시도 실패: ${error.message || error}` };
  }

  return response;
}

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

function sendStopRequestFallback(tabId, mode) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        args: [mode],
        func: (requestMode) => {
          try {
            const key = '__IG_ORGANIZER_STOP_REQUESTS';
            const bucket = (() => {
              const current = window[key];
              if (current && typeof current === 'object') {
                return current;
              }
              return {};
            })();
            bucket[String(requestMode)] = true;
            window[key] = bucket;
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ [key]: bucket });
            }
          } catch {
            // ignore
          }
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, response });
      }
    );
  });
}

function isPortClosedNoResponseError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('message port closed before a response was received') ||
    normalized.includes('receiving end does not exist') ||
    normalized.includes('could not establish connection');
}

function isAlreadyRunningError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('already running') || normalized.includes('진행 중');
}

function getInstagramTab(mode = 'saved') {
  return new Promise((resolve) => {
    const pickInstagram = (tabs) => {
      const instagramTabs = tabs.filter((tab) => isInstagramUrl(tab.url || ''));
      if (!instagramTabs.length) {
        return null;
      }
      const matchesSaved = (url) => /\/saved(\/|$)|\/all-posts/.test(url);
      const matchesFollowing = (url) => /\/(followers|following)(\/|$)/.test(url);
      const activeInstagram = instagramTabs.find((tab) => tab.active);
      const savedLike = instagramTabs.find((tab) => matchesSaved(tab.url || ''));
      const followLike = instagramTabs.find((tab) => matchesFollowing(tab.url || ''));
      const modeMatch = instagramTabs.find((tab) =>
        mode === 'following' ? matchesFollowing(tab.url || '') : matchesSaved(tab.url || '')
      );

      return modeMatch || (mode === 'following' ? followLike || activeInstagram : savedLike || activeInstagram) || instagramTabs[0];
    };

    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const direct = pickInstagram(tabs);
      if (direct) {
        resolve(direct);
        return;
      }
      chrome.tabs.query({}, (allTabs) => {
        resolve(pickInstagram(allTabs));
      });
    });
  });
}

function collectDirectFromPage(tab, mode) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        args: [mode],
        func: async (requestMode) => {
          try {
            const SCRAPE_ROUNDS = 10;
            const SCRAPE_DELAY_MS = 800;
            const STABLE_ROUNDS = 2;

            const PROFILE_PATH = /^\/([A-Za-z0-9._]+)\/$/;
            const POST_PATH = /^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)\/?$/;
            const blockedProfile = new Set([
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

          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          const sanitize = (value) => {
            return String(value || '')
              .replace(/\s+/g, ' ')
              .replace(/\u200b/g, '')
              .trim();
          };

          const toAbsoluteUrl = (href) => {
            try {
              return new URL(href, location.href).toString();
            } catch {
              return '';
            }
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
            if (lower.startsWith('data:') || lower.startsWith('blob:')) {
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
            if (!/^https?:\/\//i.test(safe)) {
              return false;
            }
            return true;
          };

          const isHighQualityImageUrl = (url) => {
            const lower = String(url).toLowerCase();
            return (
              /\.(jpe?g|png|webp|avif)(\?|$)/.test(lower) ||
              /scontent|cdninstagram/.test(lower)
            );
          };

          const parsePost = (href) => {
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
            } catch {
              return null;
            }
          };

          const parseProfile = (href) => {
            try {
              const path = new URL(href, location.href).pathname;
              const match = path.match(PROFILE_PATH);
              if (!match) {
                return null;
              }
              const username = match[1];
              if (blockedProfile.has(username) || username.length > 40) {
                return null;
              }
              return username;
            } catch {
              return null;
            }
          };

          const pickFromSrcSet = (raw) => {
            if (!raw) {
              return '';
            }
            const entries = String(raw).split(',').map((entry) => entry.trim()).filter(Boolean);
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
              .filter((entry) => entry.src)
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

          const isLikelyAvatarOrBadge = (node) => {
            const area = getNodeArea(node);
            const src = node.getAttribute('src') || node.getAttribute('data-src') || node.poster || '';
            return isLikelyAvatarOrBadgeImage(src, area);
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
              if (!node) {
                return;
              }
              if (unique.has(node)) {
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
                const priority = (preferredAnchor && preferredAnchor.contains(node)) ? 250 : 0;
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

          const extractAuthorFromContainer = (container, fallbackAnchor) => {
            const anchors = [...(container ? container.querySelectorAll('a[href]') : [])];
            if (fallbackAnchor) {
              anchors.push(fallbackAnchor);
            }
            return (
              anchors
                .map((node) => parseProfile(node.getAttribute('href') || ''))
                .find(Boolean) || ''
            );
          };

          const extractCaptionFromContainer = (container, fallbackAnchor) => {
            const texts = [
              ...(container ? container.querySelectorAll('span[dir="auto"], h2, h3') : []),
              fallbackAnchor
            ]
              .filter(Boolean)
              .map((node) => sanitize(node.textContent))
              .filter(Boolean);
            return texts.reduce((winner, text) => (text.length > winner.length ? text : winner), '');
          };

          const collectSavedPosts = () => {
            const folderMatch = location.pathname.match(/^\/([A-Za-z0-9._]+)\/saved\/([^/?#]+)/);
            const sourceFolder = folderMatch ? sanitize(folderMatch[2]).toLowerCase() : '';
            const map = new Map();
            const anchors = new Set([
              ...document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"], article a[href*="/reels/"], article a[href*="/tv/"]'),
              ...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'),
              ...document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"], a[href^="/tv/"]')
            ]);

            anchors.forEach((anchor) => {
              const info = parsePost(anchor.getAttribute('href') || '');
              if (!info) {
                return;
              }

              const postId = info.id;
              if (map.has(postId)) {
                return;
              }

              const container =
                anchor.closest('article') ||
                anchor.closest('li') ||
                anchor.closest('main') ||
                anchor.parentElement;
              if (!container) {
                return;
              }
              const timeNode = container ? container.querySelector('time[datetime]') : null;
              const thumbnail = extractThumbnailFromContainer(container, anchor);

              map.set(postId, {
                postId,
                kind: info.kind,
                link: toAbsoluteUrl(info.href),
                username: extractAuthorFromContainer(container, anchor),
                caption: extractCaptionFromContainer(container, anchor),
                sourceFolder,
                thumbnail,
                savedAt: timeNode ? sanitize(timeNode.getAttribute('datetime') || '') : '',
                discoveredAt: new Date().toISOString()
              });
            });

            return [...map.values()];
          };

          const findFollowerDialog = () => {
            const dialogs = [...document.querySelectorAll('div[role="dialog"], [role="dialog"]')];
            const scored = dialogs
              .map((dialog) => {
                const anchors = [...dialog.querySelectorAll('a[href]')];
                const usernames = anchors.map((anchor) => parseProfile(anchor.getAttribute('href') || '')).filter(Boolean);
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
              const username = parseProfile(anchor.getAttribute('href') || '');
              if (!username) {
                return;
              }

              const row = anchor.closest('li') || anchor.closest('div[role="button"]') || anchor.closest('article') || anchor.parentElement || scopeNode;
              const rawBio = [
                ...(row ? row.querySelectorAll('span[dir="auto"]') : [])
              ]
                .map((node) => sanitize(node.textContent))
                .filter(Boolean)
                .find((text) => text.length > 1 && !text.includes(username));

              if (!map.has(username)) {
                map.set(username, {
                  username,
                  displayName: extractFollowDisplayName(row, anchor, username),
                  profileUrl: toAbsoluteUrl(`/${username}/`),
                  bio: rawBio || '',
                  sourcePage: location.pathname,
                  discoveredAt: new Date().toISOString()
                });
              }
            });

            return [...map.values()];
          };

          const collectWithAutoScroll = async (collector, keySelector) => {
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
                    Boolean(parseProfile(anchor.getAttribute('href') || ''))
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

            const sendChunk = (kind, payloadItems) => {
              return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                  {
                    type: 'crawl:result',
                    payload: {
                      kind,
                      items: payloadItems
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

            const batchSize = 400;
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
            const crawlAt = Date.now();
            let crawlOrder = 0;

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
              queued.clear();
              accumulatedAdded += Number(response.added || 0);
              accumulatedUpdated += Number(response.updated || 0);
              lastStoredCount = Number(response.count || 0);
              chunkCallCount += 1;
              return payload.length;
            };

            for (let i = 0; i < maxRounds; i += 1) {
              scroller = getScroller() || scroller;
              if (!scroller) {
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
                const key = keySelector(item);
                if (!key) {
                  return;
                }
                  if (!merged.has(key)) {
                    const payloadItem = {
                      ...item,
                      crawlAt,
                      crawlOrder: crawlOrder++
                    };
                    merged.set(key, payloadItem);
                    queued.set(key, payloadItem);
                  }
                });

              await flush();

              reachedBottom = isAtBottom(scroller);
              if (reachedBottom && stable >= stableRoundLimit) {
                break;
              }

              scrollOne(scroller);
              await sleep(SCRAPE_DELAY_MS);
              await sleep(180);
            }

      await flush(true);
      maxRoundsReached = rounds >= maxRounds;

      const items = [...merged.values()];
      return {
        items,
        count: items.length,
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
                storedTotal: lastStoredCount
              },
              batchFlushed: true
            };
          };

          if (requestMode === 'saved') {
            const { items, count, meta } = await collectWithAutoScroll(collectSavedPosts, (item) => item.postId);
            return { ok: true, kind: 'saved', items, count: Number(count || items.length), meta };
          }
          if (requestMode === 'following') {
            const { items, count, meta } = await collectWithAutoScroll(
              collectFollowingUsers,
              (item) => item.username
            );
            return { ok: true, kind: 'following', items, count: Number(count || items.length), meta };
          }
            return { ok: false, error: `unsupported mode ${requestMode}` };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: `direct collect failed: ${chrome.runtime.lastError.message}`
          });
          return;
        }
        if (!results || !results.length || !results[0]) {
          resolve({ ok: false, error: 'direct collect failed: no result' });
          return;
        }
        const result = results[0].result;
        if (!result || result.ok === false) {
          resolve(result || { ok: false, error: 'direct collect failed: no result' });
          return;
        }
        resolve(result);
      }
    );
  });
}

function renderSummary(data) {
  const categories = Object.entries(data.summary.byCategory || {})
    .map(([category, count]) => `<li>${escapeHtml(category)}: ${count}개</li>`)
    .join('');

  elements.summary.innerHTML = `
    <p>저장글: ${data.summary.totalPosts}개 / 팔로우: ${data.summary.totalFriends}명</p>
    <ul>${categories}</ul>
  `;
}

function renderCategoryFilter(categories) {
  const list = ['all', ...categories, '기타'];
  const unique = [...new Set(list)];
  elements.categoryFilter.innerHTML = unique
    .map((category) => {
      const label = category === 'all' ? '모든 카테고리' : category;
      return `<option value="${escapeHtml(category)}">${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderPosts() {
  const query = (elements.searchInput.value || '').toLowerCase().trim();
  const filterCategory = elements.categoryFilter.value || 'all';

  const rows = (cachedData.savedPosts || []).filter((post) => {
    const matchCategory =
      filterCategory === 'all' || String(post.category || '기타') === filterCategory;

    const matchQuery = !query
      ? true
      : `${post.username} ${post.caption} ${post.link}`.toLowerCase().includes(query);
    return matchCategory && matchQuery;
  });

  if (!rows.length) {
    elements.postList.innerHTML = '<li class="empty">저장된 게시물이 없습니다.</li>';
    return;
  }

  const categories = cachedData.categories || [];
  const categoryOptions = getCategoryOptions(categories);

  elements.postList.innerHTML = rows
    .map((post) => {
      const category = post.category || '기타';
      return `
        <li class="post-item">
          <a class="thumb" href="${escapeHtml(toAbsoluteUrl(post.link))}" target="_blank" rel="noreferrer">
            ${
              post.thumbnail
                ? `<img src="${escapeHtml(post.thumbnail)}" alt="${escapeHtml(post.username)}" />`
                : '<span class="no-thumb">No image</span>'
            }
          </a>
          <div class="post-body">
            ${
              post.sourceFolder
                ? `<p class="folder-tag">폴더: ${escapeHtml(post.sourceFolder)}</p>`
                : ''
            }
            <p><strong>@${escapeHtml(post.username || '알수없음')}</strong></p>
            <p class="caption">${escapeHtml(post.caption || '캡션 없음')}</p>
            <label>카테고리
              <select class="category-select" data-post-id="${escapeHtml(post.id)}">
                ${categoryOptions}
              </select>
            </label>
          </div>
          <span class="category-chip">${escapeHtml(category)}</span>
        </li>
      `;
    })
    .join('');

  document.querySelectorAll('.category-select').forEach((select) => {
    const id = select.dataset.postId;
    const post = rows.find((item) => item.id === id);
    select.value = post?.category || '기타';
    select.addEventListener('change', async (event) => {
      const next = event.target.value;
      const response = await sendMessageToBackground({
        type: 'set:post-category',
        postId: id,
        category: next
      });
      if (!response.ok) {
        setStatus(`카테고리 저장 실패: ${response.error}`);
        return;
      }
      loadData();
    });
  });
}

function renderFriends() {
  const friends = cachedData.friends || [];

  if (!friends.length) {
    elements.friendList.innerHTML = '<li class="empty">팔로우 데이터가 없습니다.</li>';
    return;
  }

  elements.friendList.innerHTML = friends
    .map((friend) => {
      return `
        <li class="friend-item">
          <a href="${escapeHtml(toAbsoluteUrl(friend.profileUrl))}" target="_blank" rel="noreferrer">
            @${escapeHtml(friend.username)}
          </a>
          <span>${escapeHtml(friend.displayName || friend.username)}</span>
          <small>${escapeHtml(friend.bio || '')}</small>
        </li>
      `;
    })
    .join('');
}

function renderAll() {
  if (!cachedData) {
    return;
  }
  renderSummary(cachedData);
  renderCategoryFilter(cachedData.categories || []);
  renderPosts();
  renderFriends();
}

async function loadData() {
  const response = await sendMessageToBackground({ type: 'get:data' });
  if (!response.ok) {
    setStatus(`데이터 로드 실패: ${response.error}`);
    return;
  }
  cachedData = response;
  renderAll();
  if (elements.rawData && !elements.rawData.classList.contains('hidden')) {
    const content = await loadRawStorage();
    updateRawDataUi(content);
  }
  setStatus('데이터 로드 완료');
}

async function handleCrawl(mode) {
  const isRunning = isModeCrawling(mode);
  if (isRunning) {
    const tab = await getInstagramTab(mode);
    if (!tab || !tab.id) {
      setStatus('중지할 수 있는 Instagram 탭을 찾지 못했습니다.');
      return;
    }

    const persistedStop = await setStopRequestInStorage(mode, true);
    let stopResponse = await sendMessageToTab(tab.id, { type: 'crawl:stop', mode });
    let stopHandled = stopResponse.ok;
    if (!stopHandled && persistedStop.ok) {
      stopHandled = true;
    }
    if (!stopResponse.ok) {
      const isPortClosedError = isPortClosedNoResponseError(stopResponse.error);
      if (isPortClosedError || (stopResponse.error || '').includes('Could not establish connection')) {
        const fallback = await sendStopRequestFallback(tab.id, mode);
        stopHandled = stopHandled || fallback.ok;
      } else if (!stopResponse.ok) {
        stopHandled = false;
      }

      if (!stopHandled) {
        setStatus(`중지 요청 실패: ${stopResponse.error || '알 수 없는 오류'}`);
        return;
      }
    }

    if (!stopHandled) {
      setStatus(`중지 요청 전달은 되지 않았습니다.`);
      return;
    }

    setStatus('중지 요청했습니다. 수집 완료 직전까지 데이터가 저장됩니다.');
    setModeRunning(mode, false);
    setCrawlButton(mode, false);
    return;
  }

  setStatus('크롤링 요청 중...');
  const tab = await getInstagramTab(mode);
  if (!tab || !tab.id) {
    setStatus('활성 Instagram 탭을 찾지 못했습니다.');
    return;
  }
  await setStopRequestInStorage(mode, false);
  let tabPath = '알 수 없음';
  try {
    tabPath = new URL(tab.url).pathname;
  } catch {
    tabPath = String(tab.url || '');
  }
  setStatus(`탭 준비: ${tabPath}`);

  setModeRunning(mode, true);
  setCrawlButton(mode, true);
  let response = { ok: false };
  try {
    response = await sendMessageToTabReliable(tab.id, { type: 'crawl:start', mode });
    if (!response.ok) {
      if (isAlreadyRunningError(response.error)) {
        setStatus('이미 실행 중인 수집이 있습니다. 중지 후 다시 시도해 주세요.');
        return;
      }

      if (isPortClosedNoResponseError(response.error)) {
        setStatus(`컨텐츠 스크립트 응답 실패: ${response.error || '직접 수집으로 전환'}`);
        const fallback = await collectDirectFromPage(tab, mode);
        if (!fallback.ok) {
          setStatus(`직접 수집 실패: ${fallback.error}`);
          return;
        }

        let forwarded = { ok: true, count: fallback.count || 0, kind: fallback.kind };
        if (!fallback.batchFlushed) {
          forwarded = await sendMessageToBackground({
            type: 'crawl:result',
            payload: {
              kind: fallback.kind,
              items: fallback.items
            }
          });
          if (!forwarded.ok) {
            setStatus(forwarded.error || '백그라운드 전달 실패');
            return;
          }
        }

        response = {
          ok: true,
          kind: fallback.kind,
          count: fallback.batchFlushed ? (Number(fallback.meta?.storedTotal) || Number(fallback.count || 0)) : (Number(forwarded.count) || Number(fallback.count || 0)),
          meta: {
            totalChecked: fallback.meta?.totalChecked || fallback.count,
            totalCandidates: fallback.meta?.totalCandidates || fallback.count,
            collected: fallback.meta?.collected || fallback.count,
            rounds: fallback.meta?.rounds || 1,
            maxRoundsReached: fallback.meta?.maxRoundsReached || false
          }
        };
      } else {
        setStatus(`수집 실패: ${response.error || '알 수 없는 오류'}`);
        return;
      }
    }

    if (!response.ok) {
      setStatus(`수집 실패: ${response.error || '알 수 없는 오류'}`);
      return;
    }

    const tabResponse = {
      ok: true,
      kind: response.kind,
      count: response.batchFlushed ? (Number(response.count) || 0) : (Number(response.count) || 0),
      meta: response.meta || {}
    };
    lastCrawlMeta = tabResponse.meta || null;
    const suffix = mode === 'following' ? '팔로우' : '저장글';
    const stopped = Boolean(response.stopped || response.meta?.stopped);
    const stateText = stopped ? '중지됨' : '완료';
    const savedFolderInfo =
      mode === 'saved' && response.meta?.savedFolderCount
        ? ` / 폴더 ${response.meta.savedFolderCount}개`
        : '';
    if (tabResponse.count === 0) {
      setStatus(
        `${suffix} 수집 결과 0개입니다. 인스타 페이지에서 아래로 충분히 스크롤한 뒤 다시 시도해 보세요.`
      );
    } else {
      const detail = lastCrawlMeta
        ? ` (확인: 라운드 ${lastCrawlMeta.rounds || 0}, 후보 ${lastCrawlMeta.totalCandidates || 0}, 총탐색 ${lastCrawlMeta.totalChecked || 0})`
        : '';
      const truncated = lastCrawlMeta?.maxRoundsReached ? ' / 최대 스크롤 횟수 도달(중단될 수 있음)' : '';
      const stoppedMessage = stopped ? ' / 중지 요청 지점까지 수집됨' : '';
      setStatus(`${suffix} 수집 ${stateText} (${tabResponse.count}개)${savedFolderInfo}${detail}${truncated}${stoppedMessage}`);
    }
    await loadData();
  } finally {
    setModeRunning(mode, false);
    setCrawlButton(mode, false);
  }
}

async function handleClear() {
  cachedRawStorage = null;
  const response = await sendMessageToBackground({ type: 'clear:data' });
  if (!response.ok) {
    setStatus(`초기화 실패: ${response.error}`);
    return;
  }
  cachedData = {
    savedPosts: [],
    friends: [],
    categories: Object.keys(cachedData?.summary?.byCategory || []),
    summary: { totalPosts: 0, totalFriends: 0, byCategory: {} }
  };
  elements.searchInput.value = '';
  elements.categoryFilter.value = 'all';
  renderAll();
  if (elements.rawData && !elements.rawData.classList.contains('hidden')) {
    const content = await loadRawStorage();
    updateRawDataUi(content);
  }
  setStatus('모든 데이터가 초기화되었습니다.');
}

elements.crawlSaved.addEventListener('click', () => handleCrawl('saved'));
elements.crawlFollowing.addEventListener('click', () => handleCrawl('following'));
elements.clearData.addEventListener('click', handleClear);
elements.searchInput.addEventListener('input', renderPosts);
elements.categoryFilter.addEventListener('change', renderPosts);
if (elements.toggleRawData) {
  elements.toggleRawData.addEventListener('click', handleToggleRawData);
}
if (elements.copyRawData) {
  elements.copyRawData.addEventListener('click', handleCopyRawData);
}
if (elements.downloadRawData) {
  elements.downloadRawData.addEventListener('click', handleDownloadRawData);
}

document.addEventListener('DOMContentLoaded', loadData);
