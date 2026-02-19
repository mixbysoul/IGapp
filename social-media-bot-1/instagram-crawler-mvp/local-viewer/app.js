const VIEWER_STORAGE_KEY = 'igOrganizerLocalViewer_v3';

const DEFAULT_CATEGORIES = ['기타'];

const state = {
  savedPosts: [],
  friends: [],
  postCategoryList: ['기타'],
  friendCategoryList: ['기타'],
  postCategories: {},
  friendCategories: {},
  friendMemos: {},
  friendMemoUpdatedAt: {},
  selectedPostIds: new Set(),
  selectedFriendNames: new Set(),
  ui: {
    activeView: 'posts',
    postQuery: '',
    postCategory: 'all',
    postSort: 'savedAtDesc',
    postSize: 'medium',
    friendQuery: '',
    friendCategory: 'all',
    friendSort: 'crawlOrder',
    friendMemoOnly: false
  }
};

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $('fileInput'),
  pasteBtn: $('pasteBtn'),
  applyBtn: $('applyBtn'),
  copyBtn: $('copyBtn'),
  downloadBtn: $('downloadBtn'),
  clearBtn: $('clearBtn'),
  pasteArea: $('pasteArea'),
  status: $('status'),
  debugText: $('debugText'),
  summary: $('summary'),
  viewPosts: $('viewPosts'),
  viewFriends: $('viewFriends'),
  postsPanel: $('postsPanel'),
  friendsPanel: $('friendsPanel'),
  postList: $('postList'),
  friendList: $('friendList'),
  postSearchInput: $('postSearchInput'),
  postCategoryFilter: $('postCategoryFilter'),
  postSort: $('postSort'),
  postSize: $('postSize'),
  newPostCategory: $('newPostCategory'),
  addPostCategoryBtn: $('addPostCategoryBtn'),
  selectAllPostsBtn: $('selectAllPostsBtn'),
  clearPostSelectionBtn: $('clearPostSelectionBtn'),
  postBulkCategory: $('postBulkCategory'),
  applyPostBulkCategoryBtn: $('applyPostBulkCategoryBtn'),
  friendSearchInput: $('friendSearchInput'),
  friendCategoryFilter: $('friendCategoryFilter'),
  friendSort: $('friendSort'),
  friendMemoOnly: $('friendMemoOnly'),
  newFriendCategory: $('newFriendCategory'),
  addFriendCategoryBtn: $('addFriendCategoryBtn'),
  selectAllFriendsBtn: $('selectAllFriendsBtn'),
  clearFriendSelectionBtn: $('clearFriendSelectionBtn'),
  friendBulkCategory: $('friendBulkCategory'),
  applyFriendBulkCategoryBtn: $('applyFriendBulkCategoryBtn')
};

const debugLines = [];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u200b/g, '')
    .trim();
}

function sanitizeMemo(value) {
  return String(value || '')
    .replace(/\u200b/g, '')
    .trim();
}

function toAbsoluteUrl(value) {
  const raw = cleanText(value);
  if (!raw) {
    return '';
  }
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).toString();
    }
    return new URL(raw, 'https://www.instagram.com').toString();
  } catch (error) {
    return '';
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushDebug(message) {
  if (!el.debugText) {
    return;
  }
  const line = `${new Date().toLocaleTimeString()} ${String(message || '')}`;
  debugLines.unshift(line);
  while (debugLines.length > 20) {
    debugLines.pop();
  }
  el.debugText.textContent = debugLines.join('\n');
}

function setStatus(message) {
  if (el.status) {
    el.status.textContent = message || '';
  }
  pushDebug(message || '');
}

function getPostKeyFromItem(post) {
  return String(post && (post.postId || post.id) || '').trim();
}

function getFriendKeyFromItem(friend) {
  return String(friend && (friend.username || friend.id) || '').trim().toLowerCase();
}

function isPostSelected(postId) {
  return state.selectedPostIds.has(String(postId || '').trim());
}

function isFriendSelected(username) {
  return state.selectedFriendNames.has(String(username || '').trim().toLowerCase());
}

function setPostSelection(postId, checked) {
  const key = String(postId || '').trim();
  if (!key) {
    return;
  }
  if (checked) {
    state.selectedPostIds.add(key);
    return;
  }
  state.selectedPostIds.delete(key);
}

function setFriendSelection(username, checked) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) {
    return;
  }
  if (checked) {
    state.selectedFriendNames.add(key);
    return;
  }
  state.selectedFriendNames.delete(key);
}

function clearPostSelection() {
  state.selectedPostIds.clear();
}

function clearFriendSelection() {
  state.selectedFriendNames.clear();
}

const applyBulkSelectionToPosts = (category) => {
  const targetCategory = cleanText(category);
  if (!targetCategory || !state.selectedPostIds.size) {
    return 0;
  }
  const selectedPosts = new Set(state.selectedPostIds);
  const existing = new Set(state.savedPosts.map((post) => getPostKeyFromItem(post)).filter(Boolean));
  let count = 0;

  selectedPosts.forEach((postId) => {
    if (!existing.has(postId)) {
      return;
    }
    state.postCategories[postId] = targetCategory;
    count += 1;
  });

  if (count > 0 && !state.postCategoryList.includes(targetCategory)) {
    state.postCategoryList = dedupeCategoryList([...state.postCategoryList, targetCategory]);
  }

  clearPostSelection();
  return count;
};

const applyBulkSelectionToFriends = (category) => {
  const targetCategory = cleanText(category);
  if (!targetCategory || !state.selectedFriendNames.size) {
    return 0;
  }
  const selectedFriends = new Set(state.selectedFriendNames);
  const existing = new Set(state.friends.map((friend) => getFriendKeyFromItem(friend)).filter(Boolean));
  let count = 0;

  selectedFriends.forEach((username) => {
    if (!existing.has(username)) {
      return;
    }
    state.friendCategories[username] = targetCategory;
    count += 1;
  });

  if (count > 0 && !state.friendCategoryList.includes(targetCategory)) {
    state.friendCategoryList = dedupeCategoryList([...state.friendCategoryList, targetCategory]);
  }

  clearFriendSelection();
  return count;
};

const selectAllVisiblePosts = () => {
  clearPostSelection();
  getFilteredPosts().forEach((post) => {
    const key = getPostKeyFromItem(post);
    if (key) {
      state.selectedPostIds.add(key);
    }
  });
};

const selectAllVisibleFriends = () => {
  clearFriendSelection();
  getFilteredFriends().forEach((friend) => {
    const key = getFriendKeyFromItem(friend);
    if (key) {
      state.selectedFriendNames.add(key);
    }
  });
};

function syncSelectionButtons() {
  if (el.applyPostBulkCategoryBtn) {
    el.applyPostBulkCategoryBtn.disabled = state.selectedPostIds.size === 0;
  }
  if (el.applyFriendBulkCategoryBtn) {
    el.applyFriendBulkCategoryBtn.disabled = state.selectedFriendNames.size === 0;
  }
}

function saveUiState() {
  const payload = {
    postCategoryList: state.postCategoryList,
    friendCategoryList: state.friendCategoryList,
    postCategories: state.postCategories,
    friendCategories: state.friendCategories,
    friendMemos: state.friendMemos,
    friendMemoUpdatedAt: state.friendMemoUpdatedAt,
    ui: state.ui
  };
  localStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify(payload));
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(VIEWER_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const loaded = JSON.parse(raw);
    if (!loaded || typeof loaded !== 'object') {
      return;
    }

    if (Array.isArray(loaded.postCategoryList) && loaded.postCategoryList.length) {
      state.postCategoryList = [...new Set([DEFAULT_CATEGORIES[0], ...loaded.postCategoryList.map(cleanText).filter(Boolean)])];
    }
    if (Array.isArray(loaded.friendCategoryList) && loaded.friendCategoryList.length) {
      state.friendCategoryList = [...new Set([DEFAULT_CATEGORIES[0], ...loaded.friendCategoryList.map(cleanText).filter(Boolean)])];
    }
    if (loaded.postCategories && typeof loaded.postCategories === 'object') {
      state.postCategories = normalizeMap(loaded.postCategories, false);
    }
    if (loaded.friendCategories && typeof loaded.friendCategories === 'object') {
      state.friendCategories = normalizeMap(loaded.friendCategories, false);
    }
    if (loaded.friendMemos && typeof loaded.friendMemos === 'object') {
      Object.entries(loaded.friendMemos).forEach(([user, memo]) => {
        const key = cleanText(user).toLowerCase();
        const text = sanitizeMemo(memo);
        if (!key || !text) {
          return;
        }
        state.friendMemos[key] = text;
      });
    }
    if (loaded.friendMemoUpdatedAt && typeof loaded.friendMemoUpdatedAt === 'object') {
      Object.entries(loaded.friendMemoUpdatedAt).forEach(([user, updatedAt]) => {
        const key = cleanText(user).toLowerCase();
        const numeric = toNumber(updatedAt);
        if (!key || numeric == null) {
          return;
        }
        state.friendMemoUpdatedAt[key] = numeric;
      });
    }
    if (loaded.ui && typeof loaded.ui === 'object') {
      state.ui = { ...state.ui, ...loaded.ui };
    }
  } catch (error) {
    pushDebug(`로컬 상태 로드 실패: ${error.message || error}`);
  }
}

function normalizeMap(raw, allowFallback = false) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    const k = cleanText(key);
    if (!k) {
      return;
    }
    const v = cleanText(value) || allowFallback || DEFAULT_CATEGORIES[0];
    if (v) {
      out[k] = v;
    }
  });
  return out;
}

function normalizeStringMap(raw, preserveMultiLine = false) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    const k = cleanText(key);
    if (!k) {
      return;
    }
    const text = preserveMultiLine ? sanitizeMemo(value) : cleanText(value);
    if (text) {
      out[k] = text;
    }
  });
  return out;
}

function getByPath(root, path) {
  return path.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return acc[key];
  }, root);
}

function coerceArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return coerceArray(parsed);
    } catch (error) {
      return [];
    }
  }
  return [];
}

function guessPostIdFromHref(href) {
  if (!href) {
    return '';
  }
  try {
    const path = new URL(href, 'https://www.instagram.com').pathname;
    const m = path.match(/\/(reel|reels|p|tv)\/([^/]+)/);
    return m ? m[2] : '';
  } catch (error) {
    return '';
  }
}

function guessUsernameFromHref(href) {
  if (!href) {
    return '';
  }
  try {
    const path = new URL(href, 'https://www.instagram.com').pathname;
    const m = path.match(/^\/([A-Za-z0-9._]{1,40})\/?/);
    if (!m) {
      return '';
    }
    const candidate = m[1].toLowerCase();
    if (['accounts', 'account', 'explore', 'help', 'about', 'reels', 'reel', 'tv', 'p', 'tags', 'stories', 'explore', 'support', 'login', 'logout', 'terms', 'privacy', 'directory', 'legal'].includes(candidate)) {
      return '';
    }
    return candidate;
  } catch (error) {
    return '';
  }
}

function parsePost(raw, index) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const rawLink = cleanText(raw.link || raw.href || raw.url || raw.urlLink || '');
  const link = toAbsoluteUrl(rawLink);
  const postId = cleanText(raw.postId || raw.id || raw.post_id || guessPostIdFromHref(link) || String(index));
  const username = cleanText(raw.username || raw.owner || raw.author || raw.writer || guessUsernameFromHref(raw.userUrl || raw.profileUrl || raw.profile_url || ''));

  const captionText = cleanText(
    raw.caption || raw.text || raw.description || raw.story || raw.title || raw.summary || raw.alt
  );
  const sourceFolder = cleanText(raw.sourceFolder || raw.folder || raw.category || '');
  const thumbCandidates = [
    raw.thumbnail,
    raw.image,
    raw.imageUrl,
    raw.thumb,
    raw.poster,
    raw.imageUrlSq,
    raw.imageUrlLg
  ].filter(Boolean);
  const thumbnail = cleanText(
    toAbsoluteUrl(thumbCandidates[0] || '')
  );
  const savedAt = cleanText(raw.savedAt || raw.saved_at || raw.savedDate || raw.date || '');
  const crawlAt = toNumber(raw.crawlAt ?? raw.savedAtTs ?? raw.crawledAt ?? raw.crawlTime ?? raw.time);
  const crawlOrder = toNumber(raw.crawlOrder ?? raw.order ?? index);

  return {
    id: postId,
    postId,
    kind: cleanText(raw.kind || 'p'),
    link,
    username,
    caption: captionText,
    thumbnail,
    savedAt,
    sourceFolder,
    crawlAt,
    crawlOrder: crawlOrder == null ? index : crawlOrder,
    discoveredAt: cleanText(raw.discoveredAt || raw.createdAt || raw.updatedAt || ''),
    raw
  };
}

function parseFriend(raw, index) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const profileUrl = toAbsoluteUrl(raw.profileUrl || raw.profile_url || raw.url || raw.href || '');
  const username = cleanText(raw.username || raw.id || raw.user || raw.author || guessUsernameFromHref(profileUrl) || String(index));
  if (!username) {
    return null;
  }
  const displayName = cleanText(raw.displayName || raw.name || raw.full_name || raw.fullName || username);
  const bio = cleanText(raw.bio || raw.intro || raw.description || '');
  const sourcePage = cleanText(raw.sourcePage || raw.source || raw.origin || '');
  const discoveredAt = cleanText(raw.discoveredAt || raw.createdAt || raw.updatedAt || '');
  const crawlAt = toNumber(raw.crawlAt ?? raw.time ?? raw.crawledAt ?? raw.orderAt);
  const crawlOrder = toNumber(raw.crawlOrder ?? raw.order ?? index);

  const avatar = cleanText(
    toAbsoluteUrl(raw.avatar || raw.profileImage || raw.thumbnail || raw.photo || raw.image || raw.icon)
  );
  return {
    username,
    id: username,
    displayName,
    profileUrl,
    bio,
    sourcePage,
    avatar,
    crawlAt,
    crawlOrder: crawlOrder == null ? index : crawlOrder,
    discoveredAt,
    raw
  };
}

function pickCandidates(raw) {
  const candidates = [
    ['savedPosts'],
    ['posts'],
    ['payload.savedPosts'],
    ['data.savedPosts'],
    ['result.savedPosts'],
    ['state.savedPosts'],
    ['dashboardData.savedPosts'],
    ['snapshot.savedPosts'],
    ['raw.savedPosts'],
    ['response.savedPosts'],
    ['items.savedPosts'],
    ['content.savedPosts'],
    ['value.savedPosts']
  ];

  const friendCandidates = [
    ['friends'],
    ['following'],
    ['payload.friends'],
    ['data.friends'],
    ['result.friends'],
    ['state.friends'],
    ['dashboardData.friends'],
    ['snapshot.friends'],
    ['raw.friends'],
    ['response.friends'],
    ['items.friends'],
    ['value.friends']
  ];

  const directSaved = coerceArray(
    candidates.reduce((acc, path) => {
      if (acc) {
        return acc;
      }
      const value = getByPath(raw, path.join('.'));
      return coerceArray(value).length ? value : null;
    }, null)
  );

  const directFriends = coerceArray(
    friendCandidates.reduce((acc, path) => {
      if (acc) {
        return acc;
      }
      const value = getByPath(raw, path.join('.'));
      return coerceArray(value).length ? value : null;
    }, null)
  );

  if (!directSaved.length && !directFriends.length) {
    const fallbackFromObject = coerceArray(getByPath(raw, '0') && getByPath(raw, 'items'));
    if (fallbackFromObject.length) {
      const itemHasPost = fallbackFromObject.some((item) => item && (item.postId || item.link || item.kind || item.caption));
      if (itemHasPost) {
        directSaved.push(...fallbackFromObject);
      }
    }
  }

  return {
    savedPosts: directSaved,
    friends: directFriends
  };
}

function autoDetectFromArray(arr, mode) {
  if (!Array.isArray(arr) || !arr.length) {
    return [];
  }
  return arr.filter((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const text = JSON.stringify(item).toLowerCase();
    if (mode === 'posts') {
      return item.postId || item.id || /instagram\.com\/(p|reel|reels|tv)\//.test(text) || /caption|thumbnail|savedat|sourcefolder/.test(text);
    }
    return item.username || item.profileUrl || item.avatar || /instagram\.com\/[a-z0-9._]+/.test(text);
  });
}

function parsePayload(payload) {
  const detected = {
    savedPosts: [],
    friends: []
  };

  if (Array.isArray(payload) && payload.length) {
    detected.savedPosts = autoDetectFromArray(payload, 'posts');
    if (!detected.savedPosts.length) {
      detected.friends = autoDetectFromArray(payload, 'friends');
    }
    if (detected.savedPosts.length || detected.friends.length) {
      return { ...detected, postCategories: {}, friendCategories: {}, friendMemos: {} };
    }
  }

  const direct = pickCandidates(payload);
  if (direct.savedPosts && direct.savedPosts.length) {
    detected.savedPosts = direct.savedPosts;
  }
  if (direct.friends && direct.friends.length) {
    detected.friends = direct.friends;
  }

  if (!detected.savedPosts.length && !detected.friends.length) {
    const maybeRawPayload = pickCandidates(payload);
    if (maybeRawPayload.savedPosts.length) {
      detected.savedPosts = maybeRawPayload.savedPosts;
    }
    if (maybeRawPayload.friends.length) {
      detected.friends = maybeRawPayload.friends;
    }
  }

  const postCategories = normalizeMap(
    getByPath(payload, 'postCategories') ||
    getByPath(payload, 'categories.posts') ||
    getByPath(payload, 'payload.postCategories') ||
    {}
  );

  const friendCategoryAssignments = normalizeMap(
    getByPath(payload, 'friendCategoryAssignments') ||
    getByPath(payload, 'friendCategories') ||
    getByPath(payload, 'friend.categoryAssignments') ||
    {}
  );

  const friendMemos = normalizeStringMap(
    getByPath(payload, 'friendMemos') ||
    getByPath(payload, 'memos.friends') ||
    getByPath(payload, 'payload.friendMemos') ||
    {},
    true
  );

  const friendMemoUpdatedAt = {};
  const rawUpdated = getByPath(payload, 'friendMemoUpdatedAt') || getByPath(payload, 'memoUpdatedAt');
  if (rawUpdated && typeof rawUpdated === 'object') {
    Object.entries(rawUpdated).forEach(([username, updatedAt]) => {
      const key = cleanText(username).toLowerCase();
      const ts = toNumber(updatedAt);
      if (!key || ts == null) {
        return;
      }
      friendMemoUpdatedAt[key] = ts;
    });
  }

  return {
    savedPosts: detected.savedPosts,
    friends: detected.friends,
    postCategories,
    friendCategories: friendCategoryAssignments,
    friendMemos,
    friendMemoUpdatedAt
  };
}

function normalizeUniquePosts(rawPosts) {
  const map = new Map();
  const list = coerceArray(rawPosts).map((item, index) => parsePost(item, index)).filter(Boolean);
  list.forEach((post) => {
    const key = String(post.id || '').trim();
    if (!key || map.has(key)) {
      return;
    }
    map.set(key, post);
  });
  return [...map.values()];
}

function normalizeUniqueFriends(rawFriends) {
  const map = new Map();
  const list = coerceArray(rawFriends).map((item, index) => parseFriend(item, index)).filter(Boolean);
  list.forEach((friend) => {
    const key = String(friend.username || '').trim().toLowerCase();
    if (!key || map.has(key)) {
      return;
    }
    map.set(key, friend);
  });
  return [...map.values()];
}

function dedupeCategoryList(list) {
  return [...new Set([DEFAULT_CATEGORIES[0], ...list.map(cleanText).filter(Boolean)])];
}

function setDefaultsFromIncoming(parsed) {
  if (parsed.savedPosts.length) {
    state.postCategoryList = dedupeCategoryList([
      ...state.postCategoryList,
      ...Object.values(parsed.postCategories || {})
    ]);
  }
  if (parsed.friends.length) {
    state.friendCategoryList = dedupeCategoryList([
      ...state.friendCategoryList,
      ...Object.values(parsed.friendCategories || {})
    ]);
  }
}

function mergeCategoryAssignments(mapName, incoming) {
  const keys = Object.keys(incoming || {});
  if (!keys.length) {
    return;
  }
  Object.entries(incoming).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    const category = cleanText(value) || DEFAULT_CATEGORIES[0];
    if (!normalizedKey || !category) {
      return;
    }
    state[mapName][normalizedKey] = category;
  });
}

function loadPayloadFromJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { error: `JSON 파싱 실패: ${error.message || error}` };
  }

  const parsed = parsePayload(raw);

  if (!parsed.savedPosts.length && !parsed.friends.length) {
    return {
      error: 'savedPosts/friends 배열을 찾지 못했습니다. JSON 구조( savedPosts, friends, 또는 단일 배열 )를 확인하세요.'
    };
  }

  const nextPosts = normalizeUniquePosts(parsed.savedPosts);
  const nextFriends = normalizeUniqueFriends(parsed.friends);

  setDefaultsFromIncoming(parsed);
  mergeCategoryAssignments('postCategories', parsed.postCategories);
  mergeCategoryAssignments('friendCategories', parsed.friendCategories);

  if (parsed.friendMemos) {
    Object.entries(parsed.friendMemos).forEach(([username, memo]) => {
      const key = cleanText(username).toLowerCase();
      if (!key) {
        return;
      }
      state.friendMemos[key] = sanitizeMemo(memo);
    });
  }
  if (parsed.friendMemoUpdatedAt) {
    Object.entries(parsed.friendMemoUpdatedAt).forEach(([username, ts]) => {
      const key = cleanText(username).toLowerCase();
      if (!key || toNumber(ts) == null) {
        return;
      }
      state.friendMemoUpdatedAt[key] = toNumber(ts);
    });
  }

  state.savedPosts = nextPosts;
  state.friends = nextFriends;
  state.selectedPostIds.clear();
  state.selectedFriendNames.clear();
  state.savedPosts.sort((a, b) => {
    if ((b.crawlAt || 0) !== (a.crawlAt || 0)) {
      return (b.crawlAt || 0) - (a.crawlAt || 0);
    }
    if ((a.crawlOrder ?? 0) !== (b.crawlOrder ?? 0)) {
      return (a.crawlOrder || 0) - (b.crawlOrder || 0);
    }
    return 0;
  });
  state.friends.sort((a, b) => {
    if ((b.crawlAt || 0) !== (a.crawlAt || 0)) {
      return (b.crawlAt || 0) - (a.crawlAt || 0);
    }
    if ((a.crawlOrder ?? 0) !== (b.crawlOrder ?? 0)) {
      return (a.crawlOrder || 0) - (b.crawlOrder || 0);
    }
    return 0;
  });
  return {
    ok: true,
    savedPosts: nextPosts.length,
    friends: nextFriends.length
  };
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  if (/^\d+$/.test(String(value))) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return new Date(n).toLocaleString();
    }
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString();
  }
  return cleanText(value);
}

function getFilteredPosts() {
  const query = state.ui.postQuery.toLowerCase();
  const catFilter = state.ui.postCategory;
  return state.savedPosts
    .filter((post) => {
      const category = state.postCategories[post.postId] || DEFAULT_CATEGORIES[0];
      const haystack = `${post.username} ${post.caption} ${post.link} ${post.sourceFolder} ${post.savedAt}`.toLowerCase();
      const queryMatch = query ? haystack.includes(query) : true;
      const categoryMatch = catFilter === 'all' ? true : category === catFilter;
      return queryMatch && categoryMatch;
    })
    .sort((a, b) => {
      if (state.ui.postSort === 'savedAtAsc') {
        return (toNumber(a.crawlAt) || 0) - (toNumber(b.crawlAt) || 0);
      }
      if (state.ui.postSort === 'username') {
        return (a.username || '').localeCompare(b.username || '');
      }
      if (state.ui.postSort === 'crawlOrder') {
        const diff = (a.crawlOrder || 0) - (b.crawlOrder || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return (toNumber(b.crawlAt) || 0) - (toNumber(a.crawlAt) || 0);
    });
}

function getFilteredFriends() {
  const query = state.ui.friendQuery.toLowerCase();
  const catFilter = state.ui.friendCategory;
  const memoOnly = state.ui.friendMemoOnly;
  return state.friends
    .filter((friend) => {
      const key = cleanText(friend.username || '').toLowerCase();
      const category = state.friendCategories[key] || DEFAULT_CATEGORIES[0];
      const memo = (state.friendMemos[key] || '').toLowerCase();
      const haystack = `${friend.username} ${friend.displayName} ${friend.bio}`.toLowerCase();
      const queryMatch = query ? haystack.includes(query) : true;
      const categoryMatch = catFilter === 'all' ? true : category === catFilter;
      const memoMatch = memoOnly ? !!memo : true;
      return queryMatch && categoryMatch && memoMatch;
    })
    .sort((a, b) => {
      const aKey = cleanText(a.username || '').toLowerCase();
      const bKey = cleanText(b.username || '').toLowerCase();
      if (state.ui.friendSort === 'username') {
        return a.username.localeCompare(b.username);
      }
      if (state.ui.friendSort === 'category') {
        const ac = state.friendCategories[aKey] || DEFAULT_CATEGORIES[0];
        const bc = state.friendCategories[bKey] || DEFAULT_CATEGORIES[0];
        if (ac !== bc) {
          return ac.localeCompare(bc);
        }
        return a.username.localeCompare(b.username);
      }
      if (state.ui.friendSort === 'memoUpdatedAt') {
        return (state.friendMemoUpdatedAt[bKey] || 0) - (state.friendMemoUpdatedAt[aKey] || 0);
      }
      if (state.ui.friendSort === 'crawlOrder') {
        const diff = (a.crawlOrder || 0) - (b.crawlOrder || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return (toNumber(b.crawlAt) || 0) - (toNumber(a.crawlAt) || 0);
    });
}

function buildCategoryOptions(select, values, selectedValue) {
  const unique = values && values.length ? values : [DEFAULT_CATEGORIES[0]];
  const safe = [...new Set(unique.map(cleanText).filter(Boolean))];
  const options = [`<option value="all">전체</option>`]
    .concat(safe.map((cat) => `<option value="${escapeHtml(cat)}"${cat === selectedValue ? ' selected' : ''}>${escapeHtml(cat)}</option>`))
    .join('');
  select.innerHTML = options;
}

function renderSummary(filteredPosts, filteredFriends) {
  if (!el.summary) {
    return;
  }
  const postSelected = state.selectedPostIds.size;
  const friendSelected = state.selectedFriendNames.size;
  el.summary.innerHTML = [
    `<span class="muted">저장글: ${state.savedPosts.length}개 (표시 ${filteredPosts.length}개)</span>`,
    `<span class="muted">팔로워: ${state.friends.length}명 (표시 ${filteredFriends.length}개)</span>`,
    `<span class="muted">카테고리: 게시글 ${state.postCategoryList.length}개 / 팔로워 ${state.friendCategoryList.length}개</span>`,
    `<span class="muted">선택: 저장글 ${postSelected}개 / 팔로워 ${friendSelected}개</span>`
  ].join(' ');

  syncSelectionButtons();
}

function fillBulkCategorySelects() {
  const postOptions = ['기타', ...state.postCategoryList]
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index)
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join('');
  const friendOptions = ['기타', ...state.friendCategoryList]
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index)
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join('');

  if (el.postBulkCategory) {
    el.postBulkCategory.innerHTML = postOptions;
  }
  if (el.friendBulkCategory) {
    el.friendBulkCategory.innerHTML = friendOptions;
  }
}

function renderPosts() {
  const posts = getFilteredPosts();
  const filter = state.ui;

  buildCategoryOptions(el.postCategoryFilter, ['all', ...state.postCategoryList], filter.postCategory);
  el.postList.dataset.size = filter.postSize;
  fillBulkCategorySelects();

  if (!posts.length) {
    el.postList.innerHTML = `<div class="no-data">표시할 저장글이 없습니다.</div>`;
    renderSummary(posts, getFilteredFriends());
    return;
  }

  el.postList.innerHTML = posts.map((post) => {
    const postKey = getPostKeyFromItem(post);
    const id = escapeHtml(postKey);
    const selected = isPostSelected(postKey);
    const username = escapeHtml(post.username || '');
    const caption = escapeHtml(post.caption || '');
    const folder = escapeHtml(post.sourceFolder || '');
    const link = escapeHtml(post.link || '#');
    const category = escapeHtml(state.postCategories[postKey] || DEFAULT_CATEGORIES[0]);
    const savedAt = escapeHtml(formatTime(post.savedAt || post.crawlAt));
    const fallback = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect fill="%23111a31" width="400" height="400"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23a1b2d9" font-size="22" font-family="Arial">썸네일 없음</text></svg>'
    );
    const image = escapeHtml(post.thumbnail || '');
    return `
      <article class="post-card${selected ? ' is-selected' : ''}">
        <label class="item-select-wrap">
          <input type="checkbox" class="post-item-select" data-post-id="${id}" ${selected ? 'checked' : ''} />
          선택
        </label>
        <img class="post-thumb" src="${image || fallback}" alt="${id}" onerror="this.src='${fallback}'" loading="lazy" />
        <div class="post-body">
          <a class="post-title text-link" href="${link}" target="_blank" rel="noreferrer">${link ? `게시물 보기` : '링크 없음'}</a>
          <div class="meta">
            <span>${username ? `작성자: ${username}` : '작성자 미확인'}</span>
            ${folder ? `<span> / 폴더: ${folder}</span>` : ''}
          </div>
          <div class="meta">${savedAt ? `저장시간: ${savedAt}` : ''}</div>
          <div class="caption">${caption ? caption : '캡션 없음'}</div>
          <div class="row">
            <select class="post-category-select" data-post-id="${id}">
              ${state.postCategoryList.map((cat) => `<option value="${escapeHtml(cat)}"${cat === category ? ' selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
            </select>
          </div>
        </div>
      </article>
    `;
  }).join('');
  syncSelectionButtons();
  renderSummary(posts, getFilteredFriends());
}

function renderFriends() {
  const friends = getFilteredFriends();

  buildCategoryOptions(el.friendCategoryFilter, ['all', ...state.friendCategoryList], state.ui.friendCategory);
  fillBulkCategorySelects();

  if (!friends.length) {
    el.friendList.innerHTML = `<div class="no-data">표시할 팔로워가 없습니다.</div>`;
    renderSummary(getFilteredPosts(), friends);
    return;
  }

  el.friendList.innerHTML = friends.map((friend) => {
    const username = cleanText(friend.username || '');
    const safeUser = escapeHtml(username);
    const key = getFriendKeyFromItem(friend);
    const selected = isFriendSelected(username);
    const memo = escapeHtml(state.friendMemos[key] || '');
    const category = escapeHtml(state.friendCategories[key] || DEFAULT_CATEGORIES[0]);
    const name = escapeHtml(friend.displayName || username);
    const bio = escapeHtml(friend.bio || '');
    const profile = escapeHtml(friend.profileUrl || '#');
    const avatar = escapeHtml(friend.avatar || '');
    const fallback = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="30" r="18" fill="%23131e38"/><path fill="%23131e38" d="M12 74c0-14 10.7-26 28-26s28 12 28 26"/><text x="50%" y="92%" font-size="12" fill="%2399aec9" text-anchor="middle" font-family="Arial">@</text></svg>'
    );
    return `
      <article class="friend-card${selected ? ' is-selected' : ''}">
        <label class="item-select-wrap">
          <input type="checkbox" class="friend-item-select" data-friend-username="${safeUser}" ${selected ? 'checked' : ''} />
          선택
        </label>
        <img class="friend-avatar" src="${avatar || fallback}" alt="${safeUser}" onerror="this.src='${fallback}'" loading="lazy" />
        <div class="friend-body">
          <a class="friend-title text-link" href="${profile}" target="_blank" rel="noreferrer">${name}</a>
          <div class="meta">@${safeUser}</div>
          <div class="meta">${bio || '소개 없음'}</div>
          <div class="row">
            <select class="friend-category-select" data-friend-username="${safeUser}">
              ${state.friendCategoryList.map((cat) => `<option value="${escapeHtml(cat)}"${cat === category ? ' selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
            </select>
          </div>
          <textarea class="memo" data-friend-memo="${safeUser}" placeholder="메모를 입력하세요.">${memo}</textarea>
        </div>
      </article>
    `;
  }).join('');
  syncSelectionButtons();
  renderSummary(getFilteredPosts(), friends);
}

function setViewMode(nextView) {
  state.ui.activeView = nextView === 'friends' ? 'friends' : 'posts';
  if (state.ui.activeView === 'posts') {
    el.postsPanel.classList.remove('hidden');
    el.friendsPanel.classList.add('hidden');
    el.viewPosts.classList.add('active');
    el.viewPosts.classList.remove('ghost');
    el.viewFriends.classList.remove('active');
    el.viewFriends.classList.add('ghost');
    renderPosts();
  } else {
    el.postsPanel.classList.add('hidden');
    el.friendsPanel.classList.remove('hidden');
    el.viewPosts.classList.remove('active');
    el.viewPosts.classList.add('ghost');
    el.viewFriends.classList.add('active');
    el.viewFriends.classList.remove('ghost');
    renderFriends();
  }
  saveUiState();
}

function addCategory(listKey, value) {
  const cleaned = cleanText(value);
  if (!cleaned || cleaned === DEFAULT_CATEGORIES[0]) {
    return;
  }
  const normalized = dedupeCategoryList([...state[listKey], cleaned]);
  if (listKey === 'postCategoryList') {
    state.postCategoryList = normalized;
  } else {
    state.friendCategoryList = normalized;
  }
  saveUiState();
}

function setPostCategory(postId, category) {
  const key = cleanText(postId);
  const value = cleanText(category) || DEFAULT_CATEGORIES[0];
  if (!key) {
    return;
  }
  state.postCategories[key] = value;
  saveUiState();
  renderPosts();
}

function setFriendCategory(username, category) {
  const key = cleanText(username).toLowerCase();
  const value = cleanText(category) || DEFAULT_CATEGORIES[0];
  if (!key) {
    return;
  }
  state.friendCategories[key] = value;
  saveUiState();
  renderFriends();
}

function setFriendMemo(username, memo) {
  const key = cleanText(username).toLowerCase();
  const text = sanitizeMemo(memo);
  if (!key) {
    return;
  }
  if (!text) {
    delete state.friendMemos[key];
    delete state.friendMemoUpdatedAt[key];
  } else {
    state.friendMemos[key] = text;
    state.friendMemoUpdatedAt[key] = Date.now();
  }
  saveUiState();
  renderFriends();
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'local-viewer',
    savedPosts: state.savedPosts,
    friends: state.friends,
    postCategories: state.postCategories,
    friendCategoryAssignments: state.friendCategories,
    friendMemos: state.friendMemos,
    friendMemoUpdatedAt: state.friendMemoUpdatedAt
  };
  return JSON.stringify(payload, null, 2);
}

function handleLoadFromText() {
  const text = cleanText(el.pasteArea.value);
  if (!text) {
    setStatus('붙여넣기 텍스트가 비어있습니다.');
    return;
  }

  const result = loadPayloadFromJson(text);
  if (!result.ok) {
    setStatus(result.error);
    return;
  }
  saveUiState();
  renderAll();
  setStatus(`불러오기 완료: 저장글 ${state.savedPosts.length}개, 팔로워 ${state.friends.length}명`);
}

function handleFileLoad(file) {
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    el.pasteArea.value = String(reader.result || '');
    handleLoadFromText();
  };
  reader.onerror = () => setStatus('파일 읽기 실패');
  reader.readAsText(file, 'utf-8');
}

function handlePasteFromClipboard() {
  if (!navigator.clipboard?.readText) {
    setStatus('클립보드 API를 사용할 수 없습니다.');
    return;
  }
  navigator.clipboard.readText()
    .then((text) => {
      el.pasteArea.value = text || '';
      setStatus(text ? '클립보드에서 붙여넣었습니다.' : '클립보드에 텍스트가 없습니다.');
    })
    .catch((error) => {
      setStatus(`클립보드 불러오기 실패: ${error.message || error}`);
    });
}

function handleCopyCurrentData() {
  try {
    navigator.clipboard.writeText(exportData());
    setStatus('현재 상태 JSON을 클립보드에 복사했습니다.');
  } catch (error) {
    setStatus(`복사 실패: ${error.message || error}`);
  }
}

function handleDownloadCurrentData() {
  const blob = new Blob([exportData()], { type: 'application/json;charset=utf-8' });
  const anchor = document.createElement('a');
  const fileName = `ig-organizer-view-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
  setStatus(`현재 상태를 파일로 저장했습니다. (${fileName})`);
}

function bindEvents() {
  el.fileInput?.addEventListener('change', (event) => {
    const file = event.target.files ? event.target.files[0] : null;
    handleFileLoad(file);
    event.target.value = '';
  });

  el.pasteBtn?.addEventListener('click', handlePasteFromClipboard);
  el.applyBtn?.addEventListener('click', handleLoadFromText);
  el.copyBtn?.addEventListener('click', handleCopyCurrentData);
  el.downloadBtn?.addEventListener('click', handleDownloadCurrentData);
  el.clearBtn?.addEventListener('click', () => {
    state.savedPosts = [];
    state.friends = [];
    state.postCategoryList = ['기타'];
    state.friendCategoryList = ['기타'];
    state.postCategories = {};
    state.friendCategories = {};
    state.friendMemos = {};
    state.friendMemoUpdatedAt = {};
    el.pasteArea.value = '';
    saveUiState();
    renderAll();
    setStatus('모든 로컬 데이터가 초기화되었습니다.');
  });

  el.viewPosts?.addEventListener('click', () => setViewMode('posts'));
  el.viewFriends?.addEventListener('click', () => setViewMode('friends'));

  el.postSearchInput?.addEventListener('input', (event) => {
    state.ui.postQuery = String(event.target.value || '');
    renderPosts();
  });
  el.postCategoryFilter?.addEventListener('change', (event) => {
    state.ui.postCategory = String(event.target.value || 'all');
    renderPosts();
  });
  el.postSort?.addEventListener('change', (event) => {
    state.ui.postSort = String(event.target.value || 'savedAtDesc');
    renderPosts();
  });
  el.postSize?.addEventListener('change', (event) => {
    state.ui.postSize = String(event.target.value || 'medium');
    renderPosts();
  });
  el.addPostCategoryBtn?.addEventListener('click', () => {
    addCategory('postCategoryList', el.newPostCategory.value || '');
    el.newPostCategory.value = '';
    renderPosts();
  });

  el.friendSearchInput?.addEventListener('input', (event) => {
    state.ui.friendQuery = String(event.target.value || '');
    renderFriends();
  });
  el.friendCategoryFilter?.addEventListener('change', (event) => {
    state.ui.friendCategory = String(event.target.value || 'all');
    renderFriends();
  });
  el.friendSort?.addEventListener('change', (event) => {
    state.ui.friendSort = String(event.target.value || 'crawlOrder');
    renderFriends();
  });
  el.friendMemoOnly?.addEventListener('change', (event) => {
    state.ui.friendMemoOnly = !!event.target.checked;
    renderFriends();
  });
  el.addFriendCategoryBtn?.addEventListener('click', () => {
    addCategory('friendCategoryList', el.newFriendCategory.value || '');
    el.newFriendCategory.value = '';
    renderFriends();
  });

  el.postList?.addEventListener('change', (event) => {
    const select = event.target;
    if (select.classList.contains('post-category-select')) {
      const postId = select.dataset.postId || '';
      setPostCategory(postId, select.value);
      return;
    }
    if (select.classList.contains('post-item-select')) {
      const postId = select.dataset.postId || '';
      setPostSelection(postId, select.checked);
      const card = select.closest('.post-card');
      if (card) {
        card.classList.toggle('is-selected', select.checked);
      }
      syncSelectionButtons();
      renderSummary(getFilteredPosts(), getFilteredFriends());
    }
  });
  el.friendList?.addEventListener('change', (event) => {
    const select = event.target;
    if (select.classList.contains('friend-category-select')) {
      const username = select.dataset.friendUsername || '';
      setFriendCategory(username, select.value);
      return;
    }
    if (select.classList.contains('friend-item-select')) {
      const username = select.dataset.friendUsername || '';
      setFriendSelection(username, select.checked);
      const card = select.closest('.friend-card');
      if (card) {
        card.classList.toggle('is-selected', select.checked);
      }
      syncSelectionButtons();
      renderSummary(getFilteredPosts(), getFilteredFriends());
    }
  });
  el.friendList?.addEventListener('input', (event) => {
    const area = event.target;
    if (area.classList.contains('memo')) {
      const username = area.dataset.friendMemo || '';
      setFriendMemo(username, area.value);
    }
  });
  el.selectAllPostsBtn?.addEventListener('click', () => {
    selectAllVisiblePosts();
    renderPosts();
    setStatus(`저장글 ${state.selectedPostIds.size}개 선택`);
  });
  el.clearPostSelectionBtn?.addEventListener('click', () => {
    clearPostSelection();
    renderPosts();
    setStatus('저장글 선택이 해제되었습니다.');
  });
  el.applyPostBulkCategoryBtn?.addEventListener('click', () => {
    const category = cleanText(el.postBulkCategory?.value || '');
    if (!category) {
      setStatus('일괄 분류할 저장글 카테고리를 선택하세요.');
      return;
    }
    const count = applyBulkSelectionToPosts(category);
    saveUiState();
    renderPosts();
    if (!count) {
      setStatus('적용할 저장글을 선택하세요.');
      return;
    }
    setStatus(`선택한 저장글 ${count}개를 "${category}"로 분류했습니다.`);
  });
  el.selectAllFriendsBtn?.addEventListener('click', () => {
    selectAllVisibleFriends();
    renderFriends();
    setStatus(`팔로워 ${state.selectedFriendNames.size}명 선택`);
  });
  el.clearFriendSelectionBtn?.addEventListener('click', () => {
    clearFriendSelection();
    renderFriends();
    setStatus('팔로워 선택이 해제되었습니다.');
  });
  el.applyFriendBulkCategoryBtn?.addEventListener('click', () => {
    const category = cleanText(el.friendBulkCategory?.value || '');
    if (!category) {
      setStatus('일괄 분류할 팔로워 카테고리를 선택하세요.');
      return;
    }
    const count = applyBulkSelectionToFriends(category);
    saveUiState();
    renderFriends();
    if (!count) {
      setStatus('적용할 팔로워를 선택하세요.');
      return;
    }
    setStatus(`선택한 팔로워 ${count}명을 "${category}"로 분류했습니다.`);
  });

  window.addEventListener('error', (event) => {
    setStatus(`오류: ${event.message || 'Unknown'}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'Promise 오류';
    setStatus(`비동기 오류: ${reason}`);
  });
}

function renderAll() {
  renderSummary(getFilteredPosts(), getFilteredFriends());
  if (state.ui.activeView === 'friends') {
    renderFriends();
  } else {
    renderPosts();
  }
  saveUiState();
}

function init() {
  loadUiState();
  bindEvents();

  if (el.viewPosts && el.viewFriends) {
    setViewMode(state.ui.activeView || 'posts');
  }
  setStatus('준비됨');
}

init();
