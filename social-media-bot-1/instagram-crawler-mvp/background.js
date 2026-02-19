const STORAGE_KEYS = {
  SAVED_POSTS: 'savedPosts',
  FRIENDS: 'friends',
  POST_CATEGORIES: 'postCategories',
  CATEGORY_RULES: 'categoryRules'
};

const UNKNOWN_CATEGORY = '기타';
const DEFAULT_RULES = {
  여행: ['여행', 'travel', '여행기', '풍경', '리트릿', 'trip', '여행지', '호캉스'],
  음식: ['맛집', '카페', '요리', '커피', '디저트', '식당', '브런치', '레시피', 'food', 'restaurant', 'coffee', 'dessert'],
  패션: ['패션', '룩', 'OOTD', '스타일', '옷', '코디', '패션', '데일리룩', 'fashion', 'outfit'],
  운동: ['운동', '헬스', '런닝', '조깅', '피트니스', '요가', 'gym', 'workout', 'running'],
  디지털: ['테크', '기기', '앱', '컴퓨터', '노트북', 'IT', '기술', 'digital', 'tech', 'programming', '코딩']
};

const UNKNOWN_LABEL = '기타';

function now() {
  return new Date().toISOString();
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items || {}));
  });
}

function setStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function toLowerTrim(value) {
  return String(value || '').toLowerCase();
}

function toFiniteNumber(value) {
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
}

function toParsedTime(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePost(post) {
  const postId = String(post.postId || post.id || '').trim();
  if (!postId) {
    return null;
  }

  return {
    id: postId,
    postId,
    kind: post.kind || 'p',
    link: post.link || '',
    username: String(post.username || '').trim(),
    sourceFolder: String(post.sourceFolder || '').trim(),
    caption: String(post.caption || '').trim(),
    thumbnail: String(post.thumbnail || '').trim(),
    savedAt: post.savedAt || '',
    discoveredAt: post.discoveredAt || now(),
    lastSeenAt: post.lastSeenAt || now(),
    crawlAt: toFiniteNumber(post.crawlAt),
    crawlOrder: toFiniteNumber(post.crawlOrder)
  };
}

function normalizeFriend(friend) {
  const username = String(friend.username || '').trim().replace(/^@/, '');
  if (!username) {
    return null;
  }

  return {
    id: username,
    username,
    displayName: String(friend.displayName || '').trim() || username,
    profileUrl: String(friend.profileUrl || '').trim(),
    bio: String(friend.bio || '').trim(),
    sourcePage: String(friend.sourcePage || '').trim(),
    discoveredAt: friend.discoveredAt || now(),
    lastSeenAt: friend.lastSeenAt || now(),
    crawlAt: toFiniteNumber(friend.crawlAt),
    crawlOrder: toFiniteNumber(friend.crawlOrder)
  };
}

function inferCategoryFromText(text, rules) {
  const normalized = toLowerTrim(text);
  let bestCategory = UNKNOWN_LABEL;
  let bestScore = 0;

  Object.entries(rules || {}).forEach(([category, keywords]) => {
    let score = 0;
    keywords.forEach((keyword) => {
      const lower = toLowerTrim(keyword);
      if (lower && normalized.includes(lower)) {
        score += 1;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  });

  return bestCategory;
}

function summarizeByCategory(posts) {
  const counts = {};
  posts.forEach((post) => {
    const category = post.category || UNKNOWN_LABEL;
    counts[category] = (counts[category] || 0) + 1;
  });
  return counts;
}

function enrichPosts(savedPosts, categories, rules) {
  return (savedPosts || []).map((post) => {
    const assigned = categories[post.id];
    return {
      ...post,
      category: assigned || post.autoCategory || post.category || inferCategoryFromText(`${post.username} ${post.caption}`, rules)
    };
  });
}

async function initializeDefaults() {
  const current = await getStorage(Object.values(STORAGE_KEYS));
  const updates = {};

  if (!Array.isArray(current[STORAGE_KEYS.SAVED_POSTS])) {
    updates[STORAGE_KEYS.SAVED_POSTS] = [];
  }
  if (!Array.isArray(current[STORAGE_KEYS.FRIENDS])) {
    updates[STORAGE_KEYS.FRIENDS] = [];
  }
  if (!current[STORAGE_KEYS.POST_CATEGORIES] || typeof current[STORAGE_KEYS.POST_CATEGORIES] !== 'object') {
    updates[STORAGE_KEYS.POST_CATEGORIES] = {};
  }
  if (!current[STORAGE_KEYS.CATEGORY_RULES] || typeof current[STORAGE_KEYS.CATEGORY_RULES] !== 'object') {
    updates[STORAGE_KEYS.CATEGORY_RULES] = DEFAULT_RULES;
  }

  if (Object.keys(updates).length) {
    await setStorage(updates);
  }
}

async function mergeSavedPosts(items) {
  const raw = await getStorage([STORAGE_KEYS.SAVED_POSTS, STORAGE_KEYS.POST_CATEGORIES, STORAGE_KEYS.CATEGORY_RULES]);
  const saved = Array.isArray(raw[STORAGE_KEYS.SAVED_POSTS]) ? [...raw[STORAGE_KEYS.SAVED_POSTS]] : [];
  const rules = raw[STORAGE_KEYS.CATEGORY_RULES] || DEFAULT_RULES;

  const map = new Map();
  saved.forEach((post) => map.set(post.id, post));
  let added = 0;
  let updated = 0;

  items.forEach((item) => {
    const post = normalizePost(item);
    if (!post) {
      return;
    }
    post.lastSeenAt = now();
    if (!post.autoCategory) {
      post.autoCategory = inferCategoryFromText(`${post.username} ${post.caption}`, rules);
    }

    if (map.has(post.id)) {
      const existing = map.get(post.id) || {};
      const merged = {
        ...existing,
        ...post
      };
      if (post.crawlAt == null && existing.crawlAt != null) {
        merged.crawlAt = existing.crawlAt;
      }
      if (post.crawlOrder == null && existing.crawlOrder != null) {
        merged.crawlOrder = existing.crawlOrder;
      }
      map.set(post.id, merged);
      updated += 1;
      return;
    }
    map.set(post.id, post);
    added += 1;
  });

  const merged = [...map.values()].sort((a, b) => {
    const aCrawlAt = toFiniteNumber(a.crawlAt) || toParsedTime(a.lastSeenAt) || 0;
    const bCrawlAt = toFiniteNumber(b.crawlAt) || toParsedTime(b.lastSeenAt) || 0;
    if (aCrawlAt !== bCrawlAt) {
      return bCrawlAt - aCrawlAt;
    }

    const aOrder = toFiniteNumber(a.crawlOrder);
    const bOrder = toFiniteNumber(b.crawlOrder);
    if (aOrder !== null || bOrder !== null) {
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0);
  });
  await setStorage({ [STORAGE_KEYS.SAVED_POSTS]: merged });
  return { count: merged.length, added, updated };
}

async function mergeFriends(items) {
  const raw = await getStorage(STORAGE_KEYS.FRIENDS);
  const friends = Array.isArray(raw[STORAGE_KEYS.FRIENDS]) ? [...raw[STORAGE_KEYS.FRIENDS]] : [];
  const map = new Map();
  friends.forEach((friend) => map.set(friend.id, friend));
  let added = 0;
  let updated = 0;

  items.forEach((item) => {
    const friend = normalizeFriend(item);
    if (!friend) {
      return;
    }
    friend.lastSeenAt = now();

    if (map.has(friend.id)) {
      const existing = map.get(friend.id) || {};
      const merged = {
        ...existing,
        ...friend
      };
      if (friend.crawlAt == null && existing.crawlAt != null) {
        merged.crawlAt = existing.crawlAt;
      }
      if (friend.crawlOrder == null && existing.crawlOrder != null) {
        merged.crawlOrder = existing.crawlOrder;
      }
      map.set(friend.id, merged);
      updated += 1;
      return;
    }
    map.set(friend.id, friend);
    added += 1;
  });

  const merged = [...map.values()].sort((a, b) => {
    const aCrawlAt = toFiniteNumber(a.crawlAt) || toParsedTime(a.lastSeenAt) || 0;
    const bCrawlAt = toFiniteNumber(b.crawlAt) || toParsedTime(b.lastSeenAt) || 0;
    if (aCrawlAt !== bCrawlAt) {
      return bCrawlAt - aCrawlAt;
    }

    const aOrder = toFiniteNumber(a.crawlOrder);
    const bOrder = toFiniteNumber(b.crawlOrder);
    if (aOrder !== null || bOrder !== null) {
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0);
  });
  await setStorage({ [STORAGE_KEYS.FRIENDS]: merged });
  return { count: merged.length, added, updated };
}

async function getDashboardData() {
  const raw = await getStorage(Object.values(STORAGE_KEYS));
  const rules = raw[STORAGE_KEYS.CATEGORY_RULES] || DEFAULT_RULES;
  const categories = Object.keys(rules);
  const manual = raw[STORAGE_KEYS.POST_CATEGORIES] || {};
  const enrichedPosts = enrichPosts(raw[STORAGE_KEYS.SAVED_POSTS] || [], manual, rules);

  return {
    ok: true,
    savedPosts: enrichedPosts,
    friends: raw[STORAGE_KEYS.FRIENDS] || [],
    postCategories: manual,
    categoryRules: rules,
    categories,
    summary: {
      totalPosts: enrichedPosts.length,
      totalFriends: (raw[STORAGE_KEYS.FRIENDS] || []).length,
      byCategory: summarizeByCategory(enrichedPosts)
    }
  };
}

async function setPostCategory(postId, category) {
  const raw = await getStorage(STORAGE_KEYS.POST_CATEGORIES);
  const assignments = raw[STORAGE_KEYS.POST_CATEGORIES] || {};
  assignments[postId] = category;
  await setStorage({ [STORAGE_KEYS.POST_CATEGORIES]: assignments });
  return { ok: true };
}

async function clearAllData() {
  await setStorage({
    [STORAGE_KEYS.SAVED_POSTS]: [],
    [STORAGE_KEYS.FRIENDS]: [],
    [STORAGE_KEYS.POST_CATEGORIES]: {}
  });
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    sendResponse({ ok: false, error: 'invalid message' });
    return false;
  }

  if (message.type === 'crawl:result') {
    (async () => {
      const payload = message.payload || {};
      const kind = payload.kind || '';
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (kind === 'saved') {
        const result = await mergeSavedPosts(items);
        sendResponse({ ok: true, kind: 'saved', ...result });
        return;
      }

      if (kind === 'following') {
        const result = await mergeFriends(items);
        sendResponse({ ok: true, kind: 'following', ...result });
        return;
      }

      sendResponse({ ok: false, error: `unsupported kind: ${kind}` });
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }

  if (message.type === 'get:data') {
    (async () => {
      const data = await getDashboardData();
      sendResponse(data);
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }

  if (message.type === 'set:post-category') {
    const postId = String(message.postId || '').trim();
    const category = String(message.category || '').trim();

    if (!postId || !category) {
      sendResponse({ ok: false, error: 'postId and category are required' });
      return false;
    }

    (async () => {
      await setPostCategory(postId, category);
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }

  if (message.type === 'clear:data') {
    (async () => {
      const result = await clearAllData();
      sendResponse(result);
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }

  return false;
});
