'use strict';

const STORY_UNIT_MIN = 150;
const STORY_UNIT_MAX = 200;
const SUBMISSION_TAG_LIMIT = 3;
const DEMO_STORY_STORAGE_KEY = 'fail-forward-demo-stories-v1';
const DEMO_MODERATION_DELAY_MS = 900;
const LANGUAGE_CONFIG = window.FFG_I18N || {
  defaultLanguage: 'zh',
  supportedLanguages: ['zh', 'en'],
  storageKey: 'fail-forward-interface-language-v1',
  documentTitles: { zh: document.title, en: document.title },
  zhByEnglish: {}
};

const FOLLOW_UP_STATUS_OPTIONS = [
  { value: 'still-difficult', label: 'Still difficult', labelZh: '仍然很困难' },
  { value: 'no-major-change', label: 'No major change', labelZh: '没有明显变化' },
  { value: 'small-steps', label: 'Taking small steps', labelZh: '正在尝试一些小行动' },
  { value: 'better-than-before', label: 'Better than before', labelZh: '比之前好一些' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say', labelZh: '不想回答' }
];

const filterState = {
  board: 'all',
  tags: new Set(),
  search: '',
  commentMode: 'all'
};

const archiveTagState = {
  expanded: false,
  resizeTimer: null
};

const submitTagState = {
  board: '',
  selected: new Set()
};

const tagUiState = {
  language: LANGUAGE_CONFIG.defaultLanguage
};

const languageTextSources = new WeakMap();
const languageAttributeSources = new WeakMap();

const appState = {
  initialised: false,
  activeStoryId: null,
  lastStoryTrigger: null,
  lastSubmittedStoryId: null,
  adviceRendered: false
};

const myStoriesState = {
  initialised: false,
  loading: false,
  stories: [],
  comments: [],
  errorCode: null,
  requestVersion: 0
};

// Inline withdraw confirmations and appeal forms in "My stories", keyed by
// `${contentType}:${id}` so re-renders keep whichever panel is open.
const ownerControlState = {
  confirmingWithdrawKey: null,
  appealingKey: null,
  busyKey: null,
  messageKey: null,
  message: ''
};

const NOTIFICATION_POLL_MS = 60 * 1000;
const notificationState = {
  items: [],
  unreadCount: 0,
  loading: false,
  pollTimer: null
};

const RANKING_TABS = [
  { key: 'trending', zh: '正在受到关注', en: 'Getting attention', hintZh: '近 3 天的阅读与回应，越新的权重越高。', hintEn: 'Reading and responses over the last 3 days, newest weighted most.' },
  { key: 'mostRead', zh: '阅读最多', en: 'Most read', hintZh: '按去重阅读排序，同一位读者每天只计一次。', hintEn: 'Unique readers; each person counts once a day.' },
  { key: 'mostDiscussed', zh: '讨论最多', en: 'Most discussed', hintZh: '只统计通过审核的回应，不含“不接收评论”的故事。', hintEn: 'Approved responses only; stories closed to responses are not included.' },
  { key: 'recommended', zh: '审核团队推荐', en: 'Team picks', hintZh: '审核团队挑选，并写明推荐理由。', hintEn: 'Chosen by the review team, with their reason.' }
];
const rankingState = {
  data: null,
  tab: 'trending',
  readWindow: 'day',
  loading: false,
  errorCode: null,
  refreshTimer: null,
  recommendFormOpen: false,
  recommendMessage: ''
};

// policies.json drives the rules and privacy pages and the versions people agree to.
const policyState = {
  policies: null
};

const teamState = {
  data: null,
  loading: false,
  errorCode: null,
  message: '',
  confirmingRevokeId: null
};
const STAFF_ROLE_LABELS = Object.freeze({
  member: ['成员', 'Member'],
  moderator: ['审核员', 'Reviewer'],
  administrator: ['管理员', 'Administrator']
});

// The one report form open in the story dialog, keyed `${contentType}:${id}`.
const reportState = {
  targetKey: null,
  messageKey: null,
  message: ''
};

const REPORT_REASON_OPTIONS = [
  { value: 'personal-information', zh: '泄露了个人信息', en: 'Shares personal information' },
  { value: 'harassment', zh: '攻击或骚扰', en: 'Attacks or harasses someone' },
  { value: 'encourages-harm', zh: '鼓励伤害行为', en: 'Encourages harmful behaviour' },
  { value: 'spam', zh: '广告或灌水', en: 'Advertising or spam' },
  { value: 'outside-boundary', zh: '不符合作者选择的回应方式', en: 'Ignores the author’s chosen response type' },
  { value: 'safety-concern', zh: '作者可能处于危险中', en: 'The author may be in danger' },
  { value: 'other', zh: '其他原因', en: 'Something else' }
];

const APPEAL_REASON_OPTIONS = [
  { value: 'context-misunderstood', zh: '审核误解了内容的语境', en: 'The reviewer misunderstood the context' },
  { value: 'no-identifying-details', zh: '内容没有包含可识别的个人信息', en: 'The content does not identify anyone' },
  { value: 'within-guidelines', zh: '内容符合社区规范', en: 'The content follows the community guidelines' },
  { value: 'other', zh: '其他原因', en: 'Another reason' }
];

const publicStoriesState = {
  loading: false,
  requestVersion: 0
};

const moderationState = {
  initialised: false,
  loading: false,
  loaded: false,
  // Each entry is { contentType: 'story' | 'comment' | 'follow-up', item }.
  items: [],
  errorCode: null,
  message: '',
  actionContentId: null,
  requestVersion: 0
};

const MODERATION_ACTIONS = Object.freeze({
  story: 'decideStory',
  comment: 'decideComment',
  'follow-up': 'decideFollowUp',
  appeal: 'decideAppeal',
  report: 'decideReportedContent',
  held: 'decideHeldContent'
});
const MODERATION_DECISIONS = Object.freeze({
  story: ['approve', 'reject', 'safety-hold'],
  comment: ['approve', 'reject', 'safety-hold'],
  'follow-up': ['approve', 'reject', 'safety-hold'],
  appeal: ['overturn', 'uphold'],
  report: ['remove', 'dismiss', 'safety-hold'],
  held: ['release', 'reject']
});
const RISK_SIGNAL_LABELS = Object.freeze({
  'self-harm': ['可能涉及自伤或轻生', 'May involve self-harm or suicide'],
  'harm-to-others': ['可能涉及伤害他人', 'May involve harming others']
});

const followUpState = {
  phase: 'idle',
  pendingFollowUp: null,
  lastPublishedId: null,
  moderationTimer: null
};

function initApp() {
  if (appState.initialised) return;

  appState.initialised = true;
  loadPolicies();
  loadPreferredLanguage();
  loadDemoStories();
  initNavigation();
  initSiteLanguage();
  initAuthService();
  initAuthUI();
  initMyStories();
  initArchive();
  initPublicStories();
  initModeration();
  initRankings();
  initTeam();
  initSubmitForm();
  initModal();
  showPage('home');
  applySiteLanguage();
  syncAuthUiLanguage();
  syncSubmissionModeUI();
}

function loadPreferredLanguage() {
  try {
    const storedLanguage = localStorage.getItem(LANGUAGE_CONFIG.storageKey);
    if (LANGUAGE_CONFIG.supportedLanguages.includes(storedLanguage)) {
      tagUiState.language = storedLanguage;
    }
  } catch (error) {
    console.warn('The saved interface language could not be restored.', error);
  }
}

function initSiteLanguage() {
  document.addEventListener('click', (event) => {
    const languageButton = event.target.closest('[data-site-language]');
    if (!languageButton) return;

    const nextLanguage = languageButton.dataset.siteLanguage;
    if (!['en', 'zh'].includes(nextLanguage) || nextLanguage === tagUiState.language) return;

    setSiteLanguage(nextLanguage);
  });

  syncSiteLanguageControls();
}

function setSiteLanguage(nextLanguage) {
  if (!LANGUAGE_CONFIG.supportedLanguages.includes(nextLanguage)) return;

  tagUiState.language = nextLanguage;
  try {
    localStorage.setItem(LANGUAGE_CONFIG.storageKey, nextLanguage);
  } catch (error) {
    console.warn('The interface language preference could not be saved.', error);
  }

  syncSiteLanguageControls();
  renderArchive();
  renderSubmissionTags(document.getElementById('story-board')?.value || '');
  updateStoryCount();
  appState.adviceRendered = false;
  renderAdvice();
  renderMyStories();
  renderNotifications();
  renderRankings();
  renderTeam();
  renderPolicyPages();
  moderationState.message = '';
  renderModeration();

  if (document.getElementById('modal-overlay')?.classList.contains('active')) {
    const story = findStoryById(appState.activeStoryId);
    if (story && followUpState.phase === 'idle') renderModalStory(story);
  }

  applySiteLanguage();
  syncAuthUiLanguage();
  syncSubmissionModeUI();
}

function syncSiteLanguageControls() {
  document.querySelectorAll('[data-site-language]').forEach((button) => {
    const isActive = button.dataset.siteLanguage === tagUiState.language;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function getTranslatedText(englishText) {
  if (tagUiState.language === 'en') return englishText;
  return LANGUAGE_CONFIG.zhByEnglish[englishText] || englishText;
}

function localizeTextNode(node) {
  if (!languageTextSources.has(node)) languageTextSources.set(node, node.nodeValue);
  const source = languageTextSources.get(node);
  const trimmedSource = source.trim();
  if (!trimmedSource) return;

  const leadingWhitespace = source.match(/^\s*/)?.[0] || '';
  const trailingWhitespace = source.match(/\s*$/)?.[0] || '';
  const translated = getTranslatedText(trimmedSource);
  node.nodeValue = `${leadingWhitespace}${translated}${trailingWhitespace}`;
}

function applySiteLanguage(root = document.body) {
  document.documentElement.lang = tagUiState.language === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.interfaceLanguage = tagUiState.language;
  document.title = LANGUAGE_CONFIG.documentTitles[tagUiState.language] || document.title;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, [data-no-translate]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let currentNode = walker.nextNode();
  while (currentNode) {
    localizeTextNode(currentNode);
    currentNode = walker.nextNode();
  }

  const elements = [
    ...(root.matches?.('[placeholder], [aria-label], [title]') ? [root] : []),
    ...root.querySelectorAll('[placeholder], [aria-label], [title]')
  ];
  elements.forEach((element) => {
    let sources = languageAttributeSources.get(element);
    if (!sources) {
      sources = {};
      languageAttributeSources.set(element, sources);
    }

    ['placeholder', 'aria-label', 'title'].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      if (!(attribute in sources)) sources[attribute] = element.getAttribute(attribute);
      element.setAttribute(attribute, getTranslatedText(sources[attribute]));
    });
  });

  syncSiteLanguageControls();
}

function getTagDefinition(tagValue) {
  return storyTagCatalog.find((tag) => tag.value === tagValue);
}

function getTagLabel(tagValue) {
  const definition = getTagDefinition(tagValue);
  if (!definition) return `#${tagValue}`;
  return tagUiState.language === 'zh' ? definition.labelZh : definition.labelEn;
}

function findStoryById(storyId) {
  return stories.find((story) => String(story.id) === String(storyId));
}

function normaliseStoredDemoStory(story) {
  if (!story || typeof story !== 'object') return null;
  if (!String(story.id || '').startsWith('demo-story-')) return null;
  if (!['academic', 'job', 'social'].includes(story.board)) return null;
  if (typeof story.title !== 'string' || typeof story.text !== 'string') return null;
  if (!['none', 'encouragement', 'similar', 'advice'].includes(story.commentMode)) return null;

  const tags = Array.isArray(story.tags)
    ? story.tags.filter((tag) => {
        const definition = getTagDefinition(tag);
        return definition?.boards.includes(story.board);
      }).slice(0, SUBMISSION_TAG_LIMIT)
    : [];

  return {
    id: String(story.id),
    title: story.title.slice(0, 100),
    board: story.board,
    tags: [...new Set(tags)],
    commentMode: story.commentMode,
    commentModeLabel: formatCommentType(story.commentMode),
    text: story.text,
    attribution: 'Anonymous demo author · 本地演示投稿',
    comments: [],
    followUps: [],
    createdAt: story.createdAt || '',
    source: 'demo-submission'
  };
}

function loadDemoStories() {
  try {
    const storedStories = JSON.parse(localStorage.getItem(DEMO_STORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(storedStories)) return;

    storedStories.map(normaliseStoredDemoStory).filter(Boolean).forEach((story) => {
      if (!findStoryById(story.id)) stories.push(story);
    });
  } catch (error) {
    console.warn('Local demo stories could not be restored.', error);
  }
}

function normalisePublishedStory(story) {
  if (!story || typeof story !== 'object') return null;
  if (!String(story.id || '').trim()) return null;
  if (!['academic', 'job', 'social'].includes(story.board)) return null;
  if (!['none', 'encouragement', 'similar', 'advice'].includes(story.responsePreference)) return null;

  return {
    id: String(story.id),
    title: String(story.title || '').slice(0, 100),
    board: story.board,
    tags: Array.isArray(story.tags) ? [...new Set(story.tags.map(String))].slice(0, 3) : [],
    commentMode: story.responsePreference,
    commentModeLabel: formatCommentType(story.responsePreference),
    text: String(story.content || ''),
    attribution: 'Anonymous member / 匿名成员',
    comments: (Array.isArray(story.comments) ? story.comments : []).map((comment) => ({
      id: String(comment.id),
      type: comment.responseType,
      author: 'Anonymous',
      text: String(comment.content || '')
    })),
    followUps: (Array.isArray(story.followUps) ? story.followUps : []).map((followUp) => ({
      id: `follow-up-${followUp.id}`,
      day: daysBetween(story.publishedAt, followUp.publishedAt),
      status: followUp.status,
      text: String(followUp.content || ''),
      support: String(followUp.support || ''),
      visibility: 'public',
      reviewStatus: 'approved',
      publishedAt: followUp.publishedAt,
      serverId: String(followUp.id),
      source: 'server-published'
    })),
    createdAt: story.publishedAt || '',
    source: 'server-published'
  };
}

// Follow-up cards are labelled by days since the story was published, as in the samples.
function daysBetween(startValue, endValue) {
  const elapsed = new Date(endValue).getTime() - new Date(startValue).getTime();
  if (!Number.isFinite(elapsed)) return 1;
  return Math.max(1, Math.round(elapsed / (24 * 60 * 60 * 1000)));
}

function isServerStory(story) {
  return story?.source === 'server-published' && Boolean(window.FFG_CONTENT_API?.enabled);
}

function isSignedIn() {
  return window.FFG_AUTH?.getSnapshot()?.status === window.FFG_AUTH?.STATUS.AUTHENTICATED;
}

// The public API never says who wrote a story; ownership is known only from
// the signed-in author's private "My stories" list.
function isOwnedStory(story) {
  return isServerStory(story)
    && isSignedIn()
    && myStoriesState.stories.some((ownedStory) => ownedStory.id === story.id);
}

function replacePublishedStories(publishedStories) {
  for (let index = stories.length - 1; index >= 0; index -= 1) {
    if (stories[index].source === 'server-published') stories.splice(index, 1);
  }

  const safeStories = publishedStories.map(normalisePublishedStory).filter(Boolean);
  stories.unshift(...safeStories);

  const availableTags = new Set(getAvailableTags(filterState.board));
  filterState.tags = new Set([...filterState.tags].filter((tag) => availableTags.has(tag)));
  renderArchive();
}

function initPublicStories() {
  if (!window.FFG_CONTENT_API?.enabled) return;
  loadPublishedStories();
}

async function loadPublishedStories() {
  if (!window.FFG_CONTENT_API?.enabled || publicStoriesState.loading) return;

  const requestVersion = publicStoriesState.requestVersion + 1;
  publicStoriesState.requestVersion = requestVersion;
  publicStoriesState.loading = true;
  try {
    const publishedStories = await window.FFG_CONTENT_API.listPublishedStories();
    if (requestVersion === publicStoriesState.requestVersion) {
      replacePublishedStories(publishedStories);
    }
  } catch (error) {
    console.warn('Published stories could not be refreshed.', error);
  } finally {
    if (requestVersion === publicStoriesState.requestVersion) {
      publicStoriesState.loading = false;
    }
  }
}

function getDemoStories() {
  return stories.filter((story) => story.source === 'demo-submission');
}

function persistDemoStories() {
  try {
    localStorage.setItem(DEMO_STORY_STORAGE_KEY, JSON.stringify(getDemoStories()));
    return true;
  } catch (error) {
    console.warn('Local demo stories could not be saved.', error);
    return false;
  }
}

function resetDemoStories() {
  const activeStory = findStoryById(appState.activeStoryId);
  if (activeStory?.source === 'demo-submission') closeModal();

  for (let index = stories.length - 1; index >= 0; index -= 1) {
    if (stories[index].source === 'demo-submission') stories.splice(index, 1);
  }

  try {
    localStorage.removeItem(DEMO_STORY_STORAGE_KEY);
  } catch (error) {
    console.warn('Local demo storage could not be cleared.', error);
  }

  const availableTags = new Set(getAvailableTags(filterState.board));
  filterState.tags = new Set([...filterState.tags].filter((tag) => availableTags.has(tag)));
  appState.lastSubmittedStoryId = null;
  renderArchive();
  syncDemoStoryResetButton();
}

function syncDemoStoryResetButton() {
  const resetButton = document.getElementById('reset-demo-stories');
  if (resetButton) resetButton.disabled = getDemoStories().length === 0;
}

function initNavigation() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  document.addEventListener('click', (event) => {
    const consentButton = event.target.closest('[data-consent-action]');
    if (consentButton) acceptPolicyFromPage(consentButton.dataset.consentAction);
  });

  document.addEventListener('click', (event) => {
    const pageTrigger = event.target.closest('[data-page]');
    if (!pageTrigger) return;

    const pageName = pageTrigger.dataset.page;
    if (!document.getElementById(`page-${pageName}`)) return;

    event.preventDefault();
    showPage(pageName);

    if (navLinks && navToggle) {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }
}

function showPage(pageName) {
  const targetPage = document.getElementById(`page-${pageName}`);
  if (!targetPage) return;

  document.querySelectorAll('.page').forEach((page) => {
    const isTarget = page === targetPage;
    page.classList.toggle('active', isTarget);
    page.hidden = !isTarget;
  });

  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    const isCurrent = link.dataset.page === pageName;
    link.classList.toggle('active', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  // Review decisions happen elsewhere, so server-backed pages refresh on each visit.
  if (pageName === 'archive') {
    renderArchive();
    loadPublishedStories();
  }
  if (pageName === 'advice') renderAdvice();
  if (pageName === 'rankings') loadRankings();
  if (pageName === 'team') loadTeam();
  if (pageName === 'account' && isSignedIn()) {
    loadMyStories();
    loadNotifications();
  }
  if (pageName === 'moderation') {
    renderModeration();
    if (window.FFG_AUTH?.can('review-content') && !moderationState.loading) {
      loadModerationStories();
    }
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initArchive() {
  const boardFilters = document.getElementById('board-filters');
  const commentModeFilters = document.getElementById('comment-mode-filters');
  const tagFilters = document.getElementById('tag-filters');
  const searchInput = document.getElementById('story-search');
  const clearButton = document.getElementById('clear-filters');
  const storyGrid = document.getElementById('story-grid');
  const tagToggle = document.getElementById('tag-toggle');

  boardFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-board]');
    if (!button) return;

    filterState.board = button.dataset.board;
    const availableTags = new Set(getAvailableTags(filterState.board));
    filterState.tags = new Set(
      [...filterState.tags].filter((tag) => availableTags.has(tag))
    );
    renderArchive();
  });

  commentModeFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-comment-filter]');
    if (!button) return;

    filterState.commentMode = button.dataset.commentFilter;
    renderArchive();
  });

  tagFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tag]');
    if (!button) return;

    const tag = button.dataset.tag;
    if (filterState.tags.has(tag)) {
      filterState.tags.delete(tag);
    } else {
      filterState.tags.add(tag);
    }
    renderArchive();
  });

  searchInput?.addEventListener('input', (event) => {
    filterState.search = event.target.value.trim().toLocaleLowerCase();
    renderArchive();
  });

  clearButton?.addEventListener('click', clearAllFilters);

  storyGrid?.addEventListener('click', (event) => {
    const clearTrigger = event.target.closest('[data-clear-empty]');
    if (clearTrigger) {
      clearAllFilters();
      return;
    }

    const trigger = event.target.closest('[data-story-id]');
    if (!trigger) return;

    openStoryModal(trigger.dataset.storyId, trigger);
  });

  tagToggle?.addEventListener('click', () => {
    archiveTagState.expanded = !archiveTagState.expanded;
    renderArchiveTags();
  });

  window.addEventListener('resize', () => {
    if (archiveTagState.resizeTimer) window.clearTimeout(archiveTagState.resizeTimer);
    archiveTagState.resizeTimer = window.setTimeout(() => {
      archiveTagState.resizeTimer = null;
      syncArchiveTagDisclosure();
    }, 120);
  });

  renderArchive();
}

function clearAllFilters() {
  filterState.board = 'all';
  filterState.tags.clear();
  filterState.search = '';
  filterState.commentMode = 'all';
  renderArchive();
}

function getAvailableTags(board) {
  const relevantStories = board === 'all'
    ? stories
    : stories.filter((story) => story.board === board);

  return [...new Set(relevantStories.flatMap((story) => story.tags))]
    .sort((a, b) => a.localeCompare(b));
}

function getFilteredStories() {
  return stories.filter((story) => {
    const matchesBoard = filterState.board === 'all'
      || story.board === filterState.board;
    const matchesTags = [...filterState.tags]
      .every((tag) => story.tags.includes(tag));
    const matchesCommentMode = filterState.commentMode === 'all'
      || story.commentMode === filterState.commentMode;
    const searchHaystack = [
      story.title,
      story.text,
      story.attribution,
      story.tags.join(' '),
      story.tags.map((tag) => getTagDefinition(tag)?.labelZh || '').join(' ')
    ].join(' ').toLocaleLowerCase();
    const matchesSearch = !filterState.search
      || searchHaystack.includes(filterState.search);

    return matchesBoard && matchesTags && matchesCommentMode && matchesSearch;
  });
}

function renderArchive() {
  const storyGrid = document.getElementById('story-grid');
  if (!storyGrid) return;

  renderArchiveTags();
  const filteredStories = getFilteredStories();

  if (filteredStories.length === 0) {
    storyGrid.innerHTML = `
      <div class="empty-state" role="status">
        <h2>No stories match these filters yet.</h2>
        <p>Try removing a tag, changing the response type, or clearing the search.</p>
        <button type="button" class="btn btn-secondary" data-clear-empty>
          Clear all filters
        </button>
      </div>
    `;
  } else {
    storyGrid.innerHTML = filteredStories.map(createStoryCard).join('');
  }

  syncArchiveUI(filteredStories.length);
  applySiteLanguage(storyGrid);
}

function renderArchiveTags() {
  const tagFilters = document.getElementById('tag-filters');
  if (!tagFilters) return;

  const availableTags = getAvailableTags(filterState.board);
  if (!archiveTagState.expanded) {
    availableTags.sort((first, second) => {
      const selectionOrder = Number(filterState.tags.has(second)) - Number(filterState.tags.has(first));
      return selectionOrder || first.localeCompare(second);
    });
  }

  tagFilters.classList.toggle('is-expanded', archiveTagState.expanded);
  tagFilters.classList.toggle('is-collapsed', !archiveTagState.expanded);
  tagFilters.innerHTML = availableTags.map((tag) => {
    const isSelected = filterState.tags.has(tag);
    return `
      <button
        type="button"
        class="tag-filter${isSelected ? ' active' : ''}"
        data-tag="${escapeHtml(tag)}"
        aria-pressed="${isSelected}"
      >
        <span aria-hidden="true">${isSelected ? '✓ ' : ''}</span>${escapeHtml(getTagLabel(tag))}
      </button>
    `;
  }).join('');

  window.requestAnimationFrame(syncArchiveTagDisclosure);
}

function getArchiveTagToggleText(totalTags, selectedTags) {
  const selectedText = selectedTags
    ? tagUiState.language === 'zh'
      ? ` · 已选择${selectedTags}个`
      : ` · ${selectedTags} selected`
    : '';

  if (archiveTagState.expanded) {
    return tagUiState.language === 'zh'
      ? `收起标签${selectedText}`
      : `Collapse tags${selectedText}`;
  }

  return tagUiState.language === 'zh'
    ? `展开全部${totalTags}个标签${selectedText}`
    : `Show all ${totalTags} tags${selectedText}`;
}

function syncArchiveTagDisclosure() {
  const tagFilters = document.getElementById('tag-filters');
  const tagToggle = document.getElementById('tag-toggle');
  if (!tagFilters || !tagToggle) return;

  const buttons = [...tagFilters.querySelectorAll('.tag-filter')];
  const rowTops = [];
  buttons.forEach((button) => {
    const top = Math.round(button.getBoundingClientRect().top);
    if (!rowTops.some((rowTop) => Math.abs(rowTop - top) <= 1)) rowTops.push(top);
  });
  rowTops.sort((first, second) => first - second);

  const rowLimit = window.matchMedia('(max-width: 768px)').matches ? 1 : 2;
  const hasOverflow = rowTops.length > rowLimit;
  const selectedCount = filterState.tags.size;
  const label = getArchiveTagToggleText(buttons.length, selectedCount);

  tagToggle.hidden = !hasOverflow;
  tagToggle.textContent = label;
  tagToggle.setAttribute('aria-label', label);
  tagToggle.setAttribute('aria-expanded', String(archiveTagState.expanded));

  if (!hasOverflow) {
    tagFilters.style.maxHeight = 'none';
    return;
  }

  if (archiveTagState.expanded) {
    tagFilters.style.maxHeight = `${tagFilters.scrollHeight}px`;
    return;
  }

  const lastVisibleRowTop = rowTops[rowLimit - 1];
  const containerTop = tagFilters.getBoundingClientRect().top;
  const visibleButtons = buttons.filter((button) => (
    Math.abs(Math.round(button.getBoundingClientRect().top) - lastVisibleRowTop) <= 1
  ));
  const collapsedBottom = Math.max(
    ...visibleButtons.map((button) => button.getBoundingClientRect().bottom - containerTop)
  );
  tagFilters.style.maxHeight = `${Math.ceil(collapsedBottom)}px`;
}

function syncArchiveUI(resultCount) {
  document.querySelectorAll('#board-filters [data-board]').forEach((button) => {
    const isSelected = button.dataset.board === filterState.board;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });

  document.querySelectorAll('#comment-mode-filters [data-comment-filter]')
    .forEach((button) => {
      const isSelected = button.dataset.commentFilter === filterState.commentMode;
      button.classList.toggle('active', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });

  const searchInput = document.getElementById('story-search');
  if (searchInput && searchInput.value.toLocaleLowerCase() !== filterState.search) {
    searchInput.value = filterState.search;
  }

  const hasFilters = filterState.board !== 'all'
    || filterState.tags.size > 0
    || Boolean(filterState.search)
    || filterState.commentMode !== 'all';
  const clearButton = document.getElementById('clear-filters');
  if (clearButton) clearButton.disabled = !hasFilters;

  const summary = document.getElementById('filter-summary');
  if (summary) {
    const selectedTagLabels = [...filterState.tags].map(getTagLabel).join('、');
    if (tagUiState.language === 'zh') {
      const tagText = selectedTagLabels ? `；标签：${selectedTagLabels}` : '';
      summary.textContent = `当前显示 ${resultCount} 篇故事${tagText}。`;
    } else {
      const storyWord = resultCount === 1 ? 'story' : 'stories';
      const tagText = selectedTagLabels ? `; tags: ${selectedTagLabels}` : '';
      summary.textContent = `${resultCount} ${storyWord} shown${tagText}.`;
    }
  }
}

function createStoryCard(story) {
  const followUpCount = getPublishedFollowUps(story).length;
  const responseCountText = tagUiState.language === 'zh'
    ? `${story.comments.length} 条回应`
    : `${story.comments.length} ${story.comments.length === 1 ? 'response' : 'responses'}`;
  const followUpCountText = tagUiState.language === 'zh'
    ? `${followUpCount} 条后续`
    : `${followUpCount} ${followUpCount === 1 ? 'follow-up' : 'follow-ups'}`;
  const readStoryLabel = tagUiState.language === 'zh' ? '阅读故事' : 'Read story';

  return `
    <article class="story-card">
      <button
        type="button"
        class="story-card-button"
        data-story-id="${escapeHtml(story.id)}"
        aria-haspopup="dialog"
        aria-label="${readStoryLabel}: ${escapeHtml(story.title)}"
      >
        <span class="story-board">${escapeHtml(formatBoardName(story.board))}</span>
        <h2>${escapeHtml(story.title)}</h2>
        <p>${escapeHtml(truncateText(story.text, 180))}</p>
        <span class="story-tags">
          ${story.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
        </span>
        <span class="story-meta">
          <span>${escapeHtml(formatCommentType(story.commentMode))}</span>
          <span>${responseCountText}</span>
          ${followUpCount
            ? `<span class="story-follow-up-count">${followUpCountText}</span>`
            : ''}
        </span>
      </button>
    </article>
  `;
}

function initModal() {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal');
  const closeButton = document.getElementById('modal-close');
  const content = document.getElementById('modal-content');

  closeButton?.addEventListener('click', closeModal);

  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  content?.addEventListener('click', (event) => {
    // Page links inside the dialog (such as "Sign in to respond") leave the story.
    if (event.target.closest('[data-page]')) {
      closeModal();
      return;
    }

    const recommendButton = event.target.closest('[data-recommend-action]');
    if (recommendButton) {
      handleRecommendAction(recommendButton.dataset.recommendAction);
      return;
    }

    const reportButton = event.target.closest('[data-report-action]');
    if (reportButton) {
      handleReportAction(reportButton);
      return;
    }

    const actionButton = event.target.closest('[data-followup-action]');
    if (!actionButton) return;

    const story = findStoryById(appState.activeStoryId);
    if (!story) return;

    const action = actionButton.dataset.followupAction;
    if (action === 'open') {
      renderFollowUpForm(story);
      document.getElementById('modal-title')?.focus();
    } else if (action === 'back-to-story') {
      resetFollowUpFlow();
      renderModalStory(story);
      document.querySelector('[data-followup-action="open"]')?.focus();
    } else if (action === 'approve') {
      approvePendingFollowUp(story);
    } else if (action === 'view-story') {
      const publishedId = followUpState.lastPublishedId;
      resetFollowUpFlow({ keepPublishedId: true });
      renderModalStory(story);
      document.getElementById(publishedId)?.focus();
    } else if (action === 'reset-demo') {
      resetDemoFollowUps(story);
    }
  });

  content?.addEventListener('submit', (event) => {
    if (event.target.closest('[data-recommend-form]')) {
      event.preventDefault();
      handleRecommendAction('submit');
      return;
    }

    const reportForm = event.target.closest('[data-report-form]');
    if (reportForm) {
      event.preventDefault();
      submitReport(reportForm);
      return;
    }

    const followUpForm = event.target.closest('.follow-up-form');
    if (followUpForm) {
      event.preventDefault();
      const activeStory = findStoryById(appState.activeStoryId);
      if (isServerStory(activeStory)) submitFollowUpToServer(followUpForm, activeStory);
      else submitFollowUpForDemo(followUpForm);
      return;
    }

    const commentForm = event.target.closest('.comment-form');
    if (!commentForm) return;

    event.preventDefault();
    const story = findStoryById(appState.activeStoryId);
    if (!story || story.commentMode === 'none') return;
    if (isServerStory(story)) {
      submitCommentToServer(commentForm, story);
      return;
    }

    const textarea = commentForm.querySelector('textarea');
    const commentText = textarea?.value.trim();
    if (!commentText) return;

    story.comments.push({
      type: story.commentMode,
      author: 'Anonymous demo visitor',
      text: commentText
    });
    renderModalStory(story);
    document.getElementById('comment-prototype-note')?.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (!overlay?.classList.contains('active')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key === 'Tab') trapModalFocus(event, modal);
  });
}

function openStoryModal(storyId, trigger) {
  const story = findStoryById(storyId);
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal');
  if (!story || !overlay || !modal) return;

  resetFollowUpFlow();
  resetReportState();
  rankingState.recommendFormOpen = false;
  rankingState.recommendMessage = '';
  appState.activeStoryId = storyId;
  if (isServerStory(story)) {
    window.FFG_CONTENT_API.recordStoryView(story.id).catch(() => {});
  }
  appState.lastStoryTrigger = trigger;
  renderModalStory(story);

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  modal.focus();
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay?.classList.contains('active')) return;

  resetFollowUpFlow();
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  appState.activeStoryId = null;

  const trigger = appState.lastStoryTrigger;
  appState.lastStoryTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}

function trapModalFocus(event, modal) {
  if (!modal) return;

  const focusable = [...modal.querySelectorAll(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'
  )].filter((element) => !element.hidden && element.offsetParent !== null);

  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const activeElement = document.activeElement;

  if (event.shiftKey && (activeElement === first || activeElement === modal)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderModalStory(story) {
  const content = document.getElementById('modal-content');
  if (!content) return;

  content.innerHTML = `
    <article class="story-detail">
      <span class="story-board">${escapeHtml(formatBoardName(story.board))}</span>
      <h2 id="modal-title">${escapeHtml(story.title)}</h2>
      <p class="story-full-text">${escapeHtml(story.text)}</p>
      <p class="story-attribution">${escapeHtml(story.attribution)}</p>
      <div class="story-tags">
        ${story.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
      </div>
      ${isServerStory(story) && !isOwnedStory(story) ? renderReportControl('story', story.id) : ''}
    </article>
    ${renderRecommendationControl(story)}
    ${renderFollowUpInvite(story)}
    ${renderFollowUpTimeline(story)}
    ${renderComments(story)}
  `;
  applySiteLanguage(content);
}

function renderFollowUpInvite(story) {
  const serverStory = isServerStory(story);
  if (serverStory && !isOwnedStory(story)) return '';

  const copy = tagUiState.language === 'zh'
    ? {
        badge: serverStory ? '你的故事 · 仅你可见' : '原作者视图（原型）',
        heading: '故事仍可继续',
        body: '你的故事不必停留在这里，你可以回来分享后来发生了什么。',
        action: '添加后续'
      }
    : {
        badge: serverStory ? 'Your story · only you see this' : 'Prototype author view',
        heading: 'Your story can continue',
        body: 'Your story does not have to end here. You can return and share what happened next.',
        action: 'Add a Follow-up'
      };
  return `
    <section class="follow-up-invite" aria-labelledby="follow-up-invite-heading">
      <div>
        <span class="prototype-badge">${copy.badge}</span>
        <h3 id="follow-up-invite-heading">${copy.heading}</h3>
        <p>${copy.body}</p>
      </div>
      <button type="button" class="btn btn-primary follow-up-open-button" data-followup-action="open">
        ${copy.action}
      </button>
    </section>
  `;
}

function getPublishedFollowUps(story) {
  return (story.followUps || []).filter((followUp) => followUp.reviewStatus === 'approved');
}

function getFollowUpStatus(statusValue) {
  return FOLLOW_UP_STATUS_OPTIONS.find((option) => option.value === statusValue)
    || FOLLOW_UP_STATUS_OPTIONS[FOLLOW_UP_STATUS_OPTIONS.length - 1];
}

function getNextFollowUpDay(story) {
  const latestDay = Math.max(0, ...(story.followUps || []).map((followUp) => followUp.day || 0));
  return latestDay + 30;
}

function renderFollowUpTimeline(story) {
  const followUps = getPublishedFollowUps(story);
  if (followUps.length === 0) return '';

  const hasDemoFollowUp = followUps.some((followUp) => followUp.source === 'demo-created');
  const useChinese = tagUiState.language === 'zh';

  return `
    <section class="follow-up-timeline-section" aria-labelledby="follow-up-timeline-heading">
      <div class="continuation-statement">
        <span class="continuation-mark" aria-hidden="true">↳</span>
        <div>
          <h3 id="follow-up-timeline-heading">${useChinese ? '失败不是一个固定的结局。' : 'Failure is not a fixed ending.'}</h3>
          <p>${useChinese ? '故事可能继续、发生变化，也可能暂时没有答案。' : 'Stories can continue, change, or remain unresolved.'}</p>
        </div>
      </div>

      <div class="follow-up-timeline">
        <article class="timeline-event timeline-original">
          <span class="timeline-dot" aria-hidden="true"></span>
          <p class="timeline-kicker">${useChinese ? '原始故事' : 'ORIGINAL STORY'}</p>
          <h4>${escapeHtml(story.title)}</h4>
          <p class="timeline-date">${story.source === 'server-published'
            ? `${useChinese ? '发布于' : 'Published'} ${escapeHtml(formatOwnedStoryDate(story.createdAt))}`
            : (useChinese ? '发布于30天前' : 'Published 30 days ago')}</p>
        </article>
        ${followUps.map(renderFollowUpCard).join('')}
      </div>

      ${hasDemoFollowUp ? `
        <div class="follow-up-demo-reset">
          <button type="button" class="btn btn-ghost btn-sm" data-followup-action="reset-demo">
            ${useChinese ? '重置后续演示' : 'Reset Demo'}
          </button>
          <span>${useChinese ? '只移除当前浏览器会话中创建的后续。' : 'Removes only follow-ups created during this browser demo.'}</span>
        </div>
      ` : ''}
    </section>
  `;
}

function renderFollowUpCard(followUp) {
  const status = getFollowUpStatus(followUp.status);
  const isPrivate = followUp.visibility === 'private';
  const useChinese = tagUiState.language === 'zh';

  return `
    <article
      class="timeline-event follow-up-card${isPrivate ? ' is-private' : ''}"
      id="${escapeHtml(followUp.id)}"
      tabindex="-1"
    >
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="follow-up-card-header">
        <p class="timeline-kicker">${useChinese ? `后续 · 第 ${followUp.day} 天` : `FOLLOW-UP · DAY ${followUp.day}`}</p>
        ${isPrivate
          ? `<span class="visibility-badge">${useChinese ? '仅作者可见' : 'Private author view'}</span>`
          : `<span class="visibility-badge">${useChinese ? '匿名公开' : 'Published anonymously'}</span>`}
      </div>
      <p class="follow-up-status">
        <span>${escapeHtml(useChinese ? status.labelZh : status.label)}</span>
      </p>
      ${followUp.text ? `
        <blockquote>
          <p>${escapeHtml(useChinese && followUp.textZh ? followUp.textZh : followUp.text)}</p>
        </blockquote>
      ` : `
        <p class="follow-up-no-details">${useChinese ? '未补充更多内容。' : 'No additional details shared.'}</p>
      `}
      ${followUp.support ? `
        <div class="follow-up-support">
          <strong>${useChinese ? '帮助与仍需的支持' : 'What helped or is still needed'}</strong>
          <p>${escapeHtml(useChinese && followUp.supportZh ? followUp.supportZh : followUp.support)}</p>
        </div>
      ` : ''}
      <footer>
        <span>${escapeHtml(followUp.source === 'server-published'
          ? `${useChinese ? '发布于' : 'Published'} ${formatOwnedStoryDate(followUp.publishedAt)}`
          : useChinese
            ? followUp.publishedLabelZh || '刚刚发布 · 原型'
            : followUp.publishedLabel || 'Published just now · Prototype')}</span>
        <span>${useChinese ? '来自原匿名作者的更新' : 'Update from the original anonymous author'}</span>
      </footer>
      ${followUp.source === 'server-published' && !isOwnedStory(findStoryById(appState.activeStoryId))
        ? renderReportControl('follow_up', followUp.serverId)
        : ''}
    </article>
  `;
}

function renderFollowUpForm(story) {
  const content = document.getElementById('modal-content');
  if (!content) return;

  followUpState.phase = 'composing';
  const useChinese = tagUiState.language === 'zh';
  const serverStory = isServerStory(story);
  const statusOptions = FOLLOW_UP_STATUS_OPTIONS.map((option) => `
    <label class="follow-up-choice">
      <input
        type="radio"
        name="follow-up-status"
        value="${option.value}"
        required
      >
      <span>
        <strong>${escapeHtml(useChinese ? option.labelZh : option.label)}</strong>
      </span>
    </label>
  `).join('');

  content.innerHTML = `
    <div class="follow-up-form-view">
      ${serverStory ? '' : `<span class="prototype-label">${useChinese ? '后续更新原型' : 'Prototype follow-up'}</span>`}
      <h2 id="modal-title" tabindex="-1">${useChinese ? '最近怎么样？' : 'How are things now?'}</h2>
      <p class="follow-up-form-intro">
        ${useChinese
          ? '你的后续不需要是积极的，也不需要证明情况已经变好。'
          : 'Your follow-up does not need to be positive. There is no pressure to prove that things have improved.'}
      </p>
      <p class="valid-update-note">
        <strong>${useChinese ? '即使没有变化，也是一种真实而有效的更新。' : 'No change is still a valid update.'}</strong>
      </p>
      <p class="follow-up-story-reference">${useChinese ? '正在更新：' : 'Updating:'} <strong>${escapeHtml(story.title)}</strong></p>

      <form class="follow-up-form" novalidate>
        <fieldset class="follow-up-fieldset">
          <legend>${useChinese ? '你会怎样描述目前的情况？' : 'How would you describe things now?'}</legend>
          <div class="follow-up-choice-grid">${statusOptions}</div>
        </fieldset>

        <div class="form-group">
          <label for="follow-up-text">
            ${useChinese ? '如果愿意，可以说说后来发生了什么变化。' : 'What has changed, if anything?'}
          </label>
          <textarea
            id="follow-up-text"
            name="follow-up-text"
            rows="6"
            maxlength="2000"
            placeholder="${useChinese
              ? '你可以分享一个微小的变化、对你有帮助的事情，或者仍然困扰你的问题。'
              : 'You may share a small change, something that helped, or something you are still struggling with.'}"
          ></textarea>
          <p class="form-help">${serverStory
            ? (useChinese ? '建议长度：50–200词，最多2000个字符。' : 'Suggested length: 50–200 words, up to 2,000 characters.')
            : (useChinese ? '建议长度：50–200词。当前版本不作严格限制。' : 'Suggested length: 50–200 words. This prototype does not enforce a strict word limit.')}</p>
        </div>

        <div class="form-group">
          <label for="follow-up-support">
            ${useChinese ? '什么对你有所帮助？或者你现在仍然需要什么支持？' : 'What helped—or what support do you still need?'}
          </label>
          <textarea id="follow-up-support" name="follow-up-support" rows="3" maxlength="1200"></textarea>
        </div>

        <fieldset class="follow-up-fieldset">
          <legend>${useChinese ? '谁可以看到这条更新？' : 'Who can see this update?'}</legend>
          <div class="visibility-choice-grid">
            <label class="visibility-choice">
              <input type="radio" name="follow-up-visibility" value="public" checked>
              <span>
                <strong>${useChinese ? '匿名公开' : 'Publish anonymously'}</strong>
              </span>
            </label>
            <label class="visibility-choice">
              <input type="radio" name="follow-up-visibility" value="private">
              <span>
                <strong>${useChinese ? '仅自己可见' : 'Keep private'}</strong>
              </span>
            </label>
          </div>
          <p class="form-help">${useChinese ? '匿名公开的内容仍需经过审核后才会发布。' : 'Anonymous public updates still enter review before publication.'}</p>
        </fieldset>

        <aside class="follow-up-safety-note">
          <strong>${useChinese ? '当前审核原则' : 'Current safety approach'}</strong>
          <ul>
            <li>${useChinese ? '未发现明显风险的内容仍需进入人工审核。' : 'Content with no clear risk still enters human review.'}</li>
            <li>${useChinese ? '攻击、讽刺或鼓动伤害行为的内容不会公开。' : 'Attacks, ridicule, or encouragement of harmful behaviour are not published.'}</li>
            <li>${useChinese ? '含义模糊或高风险内容转交人工审核。' : 'Ambiguous or high-risk content is routed to a human moderator.'}</li>
            <li>${useChinese ? '涉及紧急危险的内容不会公开，正式平台将展示经过核验的地区支持资源。' : 'Immediate-danger content is not made public; the live platform will show verified regional support.'}</li>
          </ul>
        </aside>

        ${serverStory ? '' : `<details class="demo-controls">
          <summary>${useChinese ? '原型审核状态控制' : 'Prototype moderation controls'}</summary>
          <label for="demo-moderation-scenario">${useChinese ? '模拟审核结果' : 'Simulated moderation outcome'}</label>
          <select id="demo-moderation-scenario" name="demo-moderation-scenario">
            <option value="safe">${useChinese ? '常规流程 → 等待人工审核' : 'Standard flow → Pending Review'}</option>
            <option value="human">${useChinese ? '需要人工重点复核' : 'Needs Human Review example'}</option>
            <option value="care">${useChinese ? '紧急安全关怀示例' : 'Immediate safety-care example'}</option>
            <option value="reject">${useChinese ? '违规或攻击性内容被拒绝' : 'Unsafe / abusive content rejected'}</option>
          </select>
          <p>${useChinese ? '这是正式审核接口接入前的原型控制项，正式平台不会向普通用户开放。' : 'This prototype control will be removed when the real moderation service is connected.'}</p>
        </details>`}

        <p class="follow-up-form-status" data-follow-up-status role="status" aria-live="polite"></p>

        <div class="follow-up-form-actions">
          <button type="button" class="btn btn-secondary" data-followup-action="back-to-story">
            ${useChinese ? '返回故事' : 'Back to story'}
          </button>
          <button type="submit" class="btn btn-primary">
            ${useChinese ? '提交后续' : 'Submit Follow-up'}
          </button>
        </div>
      </form>
    </div>
  `;
  applySiteLanguage(content);
}

function submitFollowUpForDemo(form) {
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const story = findStoryById(appState.activeStoryId);
  if (!story) return;

  const formData = new FormData(form);
  followUpState.pendingFollowUp = {
    id: `demo-follow-up-${Date.now()}`,
    day: getNextFollowUpDay(story),
    status: formData.get('follow-up-status'),
    text: String(formData.get('follow-up-text') || '').trim(),
    support: String(formData.get('follow-up-support') || '').trim(),
    visibility: formData.get('follow-up-visibility') || 'public',
    demoScenario: formData.get('demo-moderation-scenario') || 'safe',
    reviewStatus: 'checking',
    publishedLabel: 'Published just now · Prototype',
    publishedLabelZh: '刚刚发布 · 原型',
    source: 'demo-created'
  };
  followUpState.phase = 'checking';
  renderFollowUpReviewState(story);

  followUpState.moderationTimer = mockModerateFollowUp(
    followUpState.pendingFollowUp,
    (nextPhase) => {
      if (!followUpState.pendingFollowUp || String(appState.activeStoryId) !== String(story.id)) return;
      followUpState.phase = nextPhase;
      followUpState.pendingFollowUp.reviewStatus = nextPhase;
      followUpState.moderationTimer = null;
      renderFollowUpReviewState(story);
      document.getElementById('follow-up-review-status')?.focus();
    }
  );
}

async function submitFollowUpToServer(form, story) {
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const formData = new FormData(form);
  const status = form.querySelector('[data-follow-up-status]');
  const submitButton = form.querySelector('button[type="submit"]');
  const visibility = formData.get('follow-up-visibility') === 'private' ? 'private' : 'anonymous-public';
  submitButton.disabled = true;
  status.textContent = tagUiState.language === 'zh' ? '正在提交……' : 'Submitting...';

  let created;
  try {
    created = await window.FFG_CONTENT_API.createFollowUp(story.id, {
      status: formData.get('follow-up-status'),
      content: String(formData.get('follow-up-text') || '').trim(),
      support: String(formData.get('follow-up-support') || '').trim(),
      visibility
    });
  } catch (error) {
    submitButton.disabled = false;
    status.textContent = getResponseErrorMessage(error.code);
    return;
  }

  loadMyStories();
  if (String(appState.activeStoryId) !== String(story.id)) return;
  followUpState.pendingFollowUp = { visibility, careSuggested: created.careSuggested };
  followUpState.phase = visibility === 'private' ? 'saved-private' : 'submitted-for-review';
  renderFollowUpReviewState(story);
  document.getElementById('follow-up-review-status')?.focus();
}

function getResponseErrorMessage(errorCode) {
  const useChinese = tagUiState.language === 'zh';
  const messages = {
    'authentication-required': {
      zh: '登录已失效，请重新登录后再提交。',
      en: 'Your session has ended. Sign in again before submitting.'
    },
    'comments-closed': {
      zh: '作者选择不接收回应。',
      en: 'The author chose not to receive responses.'
    },
    'invalid-comment': {
      zh: '请填写1–1000个字符的回应。',
      en: 'Write a response between 1 and 1,000 characters.'
    },
    'cannot-report-own-content': {
      zh: '这是你自己的内容，可以在“我的故事”中直接撤回。',
      en: 'This is your own content. You can withdraw it from My stories.'
    },
    'already-reported': {
      zh: '你已经举报过这条内容，审核员会处理。',
      en: 'You have already reported this. A reviewer will handle it.'
    },
    'report-rate-limited': {
      zh: '你最近提交的举报较多，请稍后再试。',
      en: 'You have sent several reports recently. Please try again later.'
    },
    'invalid-report-details': {
      zh: '补充说明最多500个字符；选择“其他原因”时请简单说明。',
      en: 'Details can be up to 500 characters; “Something else” needs a short description.'
    },
    'content-not-found': {
      zh: '找不到这条内容，可能已经被撤回。',
      en: 'This contribution could not be found. It may already be withdrawn.'
    },
    'appeal-not-available': {
      zh: '只有未通过审核的内容可以申诉。',
      en: 'Only contributions that were not approved can be appealed.'
    },
    'appeal-already-submitted': {
      zh: '这个审核决定已经申诉过一次。',
      en: 'This decision has already been appealed once.'
    },
    'invalid-appeal-explanation': {
      zh: '请用10–1000个字符说明申诉理由。',
      en: 'Explain the appeal in 10–1,000 characters.'
    },
    'follow-up-rate-limited': {
      zh: '你最近添加的后续较多，请过一会儿再试。',
      en: 'You have added several follow-ups recently. Please try again later.'
    },
    'too-many-pending-follow-ups': {
      zh: '你还有几条后续在等待审核，请等审核结果出来后再添加。',
      en: 'Several of your follow-ups are still awaiting review. Please wait for decisions first.'
    },
    'comment-rate-limited': {
      zh: '你最近发送的回应较多，请过几分钟再试。',
      en: 'You have sent several responses recently. Please try again in a few minutes.'
    },
    'too-many-pending-comments': {
      zh: '你还有多条回应在等待审核，请等审核结果出来后再发送。',
      en: 'Several of your responses are still awaiting review. Please wait for decisions first.'
    },
    'duplicate-comment': {
      zh: '你已经向这篇故事发送过相同的回应。',
      en: 'You have already sent this response to this story.'
    },
    'follow-up-author-only': {
      zh: '只有原匿名作者可以添加后续。',
      en: 'Only the original anonymous author can add a follow-up.'
    },
    'invalid-follow-up-status': {
      zh: '请选择目前的情况。',
      en: 'Choose how things are now.'
    },
    'invalid-follow-up': {
      zh: '后续内容最多2000个字符，支持说明最多1200个字符。',
      en: 'Keep the update within 2,000 characters and the support note within 1,200.'
    },
    'story-not-found': {
      zh: '这篇故事目前无法回应。',
      en: 'This story is not available for responses.'
    },
    'network-error': {
      zh: '暂时无法连接服务，你的内容没有提交，请稍后重试。',
      en: 'The service could not be reached. Nothing was submitted; please try again.'
    }
  };
  return messages[errorCode]?.[useChinese ? 'zh' : 'en']
    || (useChinese ? '暂时无法提交，请重试。' : 'This could not be submitted. Please try again.');
}

// DEMO-ONLY moderation adapter.
// Replace this function with a real API call in a future pilot. It deliberately
// does not analyse or rewrite a person's words; the roadshow control selects
// a transparent example outcome.
function mockModerateFollowUp(draft, onComplete) {
  const outcomes = {
    safe: 'pending-review',
    human: 'needs-human-review',
    care: 'safety-care',
    reject: 'rejected'
  };

  return window.setTimeout(() => {
    onComplete(outcomes[draft.demoScenario] || outcomes.safe);
  }, DEMO_MODERATION_DELAY_MS);
}

function renderFollowUpReviewState(story) {
  const content = document.getElementById('modal-content');
  const draft = followUpState.pendingFollowUp;
  if (!content || !draft) return;
  const useChinese = tagUiState.language === 'zh';

  const phaseContent = {
    checking: `
      <div class="review-state-card is-checking">
        <span class="review-spinner" aria-hidden="true"></span>
        <h3>${useChinese ? '正在检查你的后续内容……' : 'Checking your follow-up…'}</h3>
        <p>${useChinese ? '当前版本使用短暂的模拟检查；正式接口接入后将由服务器端执行。' : 'The current version uses a short simulated check until the server-side service is connected.'}</p>
      </div>
    `,
    'pending-review': `
      <div class="review-state-card is-pending">
        <h3>${useChinese ? '已提交审核' : 'Submitted for review'}</h3>
        <p>${useChinese ? '所有公开内容都必须由人工批准；模糊或敏感内容会进入重点复核。' : 'All public content requires human approval; ambiguous or sensitive content receives additional review.'}</p>
        <button type="button" class="btn btn-primary demo-approve-button" data-followup-action="approve">
          <span class="demo-only-label">${useChinese ? '原型控制' : 'PROTOTYPE CONTROL'}</span>
          ${useChinese ? '模拟人工批准并发布' : 'Simulate human approval'}
        </button>
      </div>
    `,
    'needs-human-review': `
      <div class="review-state-card is-human">
        <h3>${useChinese ? '需要人工重点复核' : 'Needs Human Review'}</h3>
        <p>${useChinese ? '由于内容可能较模糊或敏感，流程已暂停公开；内容不会被自动改写。' : 'Publication is paused because the content may be ambiguous or sensitive. It has not been rewritten or made public.'}</p>
      </div>
    `,
    'safety-care': `
      <div class="review-state-card is-care">
        <h3>${useChinese ? '暂不公开——安全与支持优先' : 'Not published — support comes first'}</h3>
        <p>${useChinese ? '正式平台会暂停公开，并根据用户所在地区提供经过核验的关怀与求助资源。当前版本不会编造热线信息。' : 'The live platform will pause publication and offer caring, verified resources appropriate to the person’s region. This version does not invent hotline details.'}</p>
      </div>
    `,
    rejected: `
      <div class="review-state-card is-rejected">
        <h3>${useChinese ? '不符合公开要求' : 'Not eligible for publication'}</h3>
        <p>${useChinese ? '攻击、讽刺或鼓动伤害行为的内容不会公开；系统不会把原文自动改写成“更积极”的版本。' : 'Attacks, ridicule, or encouragement of harmful behaviour are not published. The system does not rewrite the content into a more positive version.'}</p>
      </div>
    `,
    'submitted-for-review': `
      <div class="review-state-card is-pending">
        <h3>${useChinese ? '已提交人工审核' : 'Submitted for human review'}</h3>
        <p>${useChinese
          ? '审核员批准后，这条更新会以“来自原匿名作者的更新”出现在故事下方。你可以在“我的故事”中查看审核状态。'
          : 'Once a reviewer approves it, this update will appear under the story as an update from the original anonymous author. You can follow its status in My stories.'}</p>
      </div>
    `,
    'saved-private': `
      <div class="review-state-card is-approved">
        <h3>${useChinese ? '已私密保存' : 'Saved privately'}</h3>
        <p>${useChinese
          ? '这条更新只有你能在“我的故事”中看到，不会公开。即使没有变化，也是一种真实而有效的更新。'
          : 'Only you can see this update in My stories; it will not be published. No change is still a valid update.'}</p>
      </div>
    `,
    approved: `
      <div class="review-state-card is-approved">
        <h3>${draft.visibility === 'public'
          ? useChinese ? '已批准并公开' : 'Approved and published'
          : useChinese ? '已批准并仅自己可见' : 'Approved and saved privately'}</h3>
        <p>${useChinese ? '即使没有变化，也是一种真实而有效的更新。' : 'No change is still a valid update.'}</p>
        <button type="button" class="btn btn-primary" data-followup-action="view-story">
          ${useChinese ? '查看故事时间线' : 'View story timeline'}
        </button>
      </div>
    `
  };

  // The real service has no AI step yet, so the simulated workflow is not shown for it.
  const serverPhase = ['submitted-for-review', 'saved-private'].includes(followUpState.phase);
  content.innerHTML = `
    <div class="follow-up-review-view">
      ${serverPhase ? '' : `<span class="prototype-label">${useChinese ? '模拟审核' : 'Simulated review'}</span>`}
      <h2 id="modal-title">${useChinese ? '后续审核状态' : 'Follow-up review status'}</h2>
      ${serverPhase ? '' : renderFollowUpWorkflow(followUpState.phase)}
      <div id="follow-up-review-status" role="status" aria-live="polite" tabindex="-1">
        ${phaseContent[followUpState.phase] || phaseContent.checking}
      </div>
      ${serverPhase && draft.careSuggested ? renderCarePanel() : ''}
      ${!['checking', 'approved'].includes(followUpState.phase) ? `
        <button type="button" class="btn btn-secondary review-back-button" data-followup-action="back-to-story">
          ${useChinese ? '返回故事' : 'Back to story'}
        </button>
      ` : ''}
    </div>
  `;
  applySiteLanguage(content);
}

function renderFollowUpWorkflow(phase) {
  const steps = [
    { key: 'submitted', label: 'Submit Follow-up', labelZh: '提交后续' },
    { key: 'checking', label: 'AI Safety Check', labelZh: '安全检查' },
    { key: 'pending', label: 'Pending Review', labelZh: '等待审核' },
    { key: 'approved', label: 'Approved and Published', labelZh: '批准并发布' }
  ];
  const activeIndex = {
    checking: 1,
    'pending-review': 2,
    'needs-human-review': 2,
    'safety-care': 1,
    rejected: 1,
    approved: 3
  }[phase] ?? 0;
  const useChinese = tagUiState.language === 'zh';

  return `
    <ol class="review-workflow" aria-label="${useChinese ? '后续审核流程' : 'Follow-up review workflow'}">
      ${steps.map((step, index) => {
        const stateClass = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : '';
        return `
          <li class="${stateClass}" ${index === activeIndex ? 'aria-current="step"' : ''}>
            <span class="workflow-marker">${index < activeIndex ? '✓' : index + 1}</span>
            <span>
              <strong>${useChinese ? step.labelZh : step.label}</strong>
            </span>
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

function approvePendingFollowUp(story) {
  const draft = followUpState.pendingFollowUp;
  if (!draft || followUpState.phase !== 'pending-review') return;

  const { demoScenario, ...publishedFollowUp } = draft;
  publishedFollowUp.reviewStatus = 'approved';
  story.followUps = [...(story.followUps || []), publishedFollowUp];

  followUpState.phase = 'approved';
  followUpState.lastPublishedId = publishedFollowUp.id;
  renderArchive();
  renderFollowUpReviewState(story);
  document.getElementById('follow-up-review-status')?.focus();
}

function resetDemoFollowUps(story) {
  story.followUps = (story.followUps || []).filter(
    (followUp) => followUp.source !== 'demo-created'
  );
  resetFollowUpFlow();
  renderArchive();
  renderModalStory(story);
  document.querySelector('[data-followup-action="open"]')?.focus();
}

function resetFollowUpFlow(options = {}) {
  if (followUpState.moderationTimer) {
    window.clearTimeout(followUpState.moderationTimer);
  }

  followUpState.phase = 'idle';
  followUpState.pendingFollowUp = null;
  followUpState.moderationTimer = null;
  if (!options.keepPublishedId) followUpState.lastPublishedId = null;
}

function renderComments(story) {
  if (story.commentMode === 'none') {
    const heading = tagUiState.language === 'zh' ? '不接收评论' : 'No Comments';
    const boundaryNote = tagUiState.language === 'zh'
      ? '作者选择让这个故事被看见，但不接收回应。请尊重这条边界。'
      : 'The author chose to have this story witnessed without receiving responses. Please respect that boundary.';
    return `
      <section class="comments-section no-comment-notice" aria-labelledby="response-heading">
        <h3 id="response-heading">${heading}</h3>
        <p>${boundaryNote}</p>
      </section>
    `;
  }

  const commentItems = story.comments.length
    ? story.comments.map((comment) => `
        <article class="comment-item">
          <strong>${escapeHtml(tagUiState.language === 'zh' && comment.author.startsWith('Anonymous') ? '匿名用户' : comment.author)}</strong>
          <span class="comment-type">${escapeHtml(formatCommentType(comment.type))}</span>
          <p>${escapeHtml(comment.text)}</p>
          ${isServerStory(story) ? renderReportControl('comment', comment.id) : ''}
        </article>
      `).join('')
    : `<p>${tagUiState.language === 'zh'
      ? '暂时还没有回应。你可以在作者选择的回应边界内留下第一条评论。'
      : 'No responses yet. You can leave the first one within the author’s chosen mode.'}</p>`;

  if (isServerStory(story)) {
    return `
      <section class="comments-section" aria-labelledby="response-heading">
        <h3 id="response-heading">${escapeHtml(formatCommentType(story.commentMode))}</h3>
        <div class="comment-list">${commentItems}</div>
        ${renderServerCommentForm(story)}
      </section>
    `;
  }

  const responseLabel = tagUiState.language === 'zh' ? '你的回应' : 'Your response';
  const placeholder = tagUiState.language === 'zh'
    ? `请按照“${formatCommentType(story.commentMode)}”的边界友善回应……`
    : `Respond with ${formatCommentType(story.commentMode).toLowerCase()}...`;
  const addResponseLabel = tagUiState.language === 'zh' ? '添加本地回应' : 'Add demo response';
  const prototypeNote = tagUiState.language === 'zh'
    ? '原型提示：这条回应仅存在于当前浏览器会话中，不会发送或保存到服务器。'
    : 'Prototype preview: this response stays only in this browser session and is not transmitted or stored.';

  return `
    <section class="comments-section" aria-labelledby="response-heading">
      <h3 id="response-heading">${escapeHtml(formatCommentType(story.commentMode))}</h3>
      <div class="comment-list">${commentItems}</div>
      <form class="comment-form">
        <label for="comment-text">${responseLabel}</label>
        <textarea
          id="comment-text"
          rows="3"
          maxlength="1000"
          required
          placeholder="${escapeHtml(placeholder)}"
        ></textarea>
        <button type="submit" class="btn btn-primary">${addResponseLabel}</button>
        <p class="comment-prototype-note" id="comment-prototype-note" tabindex="-1">
          ${prototypeNote}
        </p>
      </form>
    </section>
  `;
}

function initTeam() {
  const panel = document.getElementById('team-panel');
  if (!panel || !window.FFG_AUTH) return;

  panel.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-appoint-form]');
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    await updateTeam(() => window.FFG_CONTENT_API.appointStaff({
      phone: String(formData.get('staff-phone') || ''),
      label: String(formData.get('staff-label') || '').trim(),
      role: String(formData.get('staff-role') || '')
    }), tagUiState.language === 'zh' ? '已保存。对方用这个手机号登录后即拥有相应权限。' : 'Saved. They have this role as soon as they sign in with that number.');
  });

  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-staff-action]');
    if (!button) return;
    const { staffAction, accountId, role } = button.dataset;
    if (staffAction === 'revoke') {
      teamState.confirmingRevokeId = accountId;
      teamState.message = '';
      renderTeam();
      document.querySelector('[data-staff-action="confirm-revoke"]')?.focus();
      return;
    }
    if (staffAction === 'cancel') {
      teamState.confirmingRevokeId = null;
      renderTeam();
      return;
    }
    const nextRole = staffAction === 'confirm-revoke' ? 'member' : role;
    await updateTeam(
      () => window.FFG_CONTENT_API.changeStaffRole(accountId, nextRole),
      tagUiState.language === 'zh' ? '权限已更新，立即生效。' : 'Role updated; it applies immediately.'
    );
  });

  window.FFG_AUTH.subscribe(() => {
    if (!window.FFG_AUTH.can('manage-staff')) {
      teamState.data = null;
      teamState.message = '';
    }
    renderTeam();
  });
}

async function loadTeam() {
  if (!window.FFG_AUTH?.can('manage-staff') || teamState.loading) {
    renderTeam();
    return;
  }
  teamState.loading = true;
  try {
    teamState.data = await window.FFG_CONTENT_API.listTeam();
    teamState.errorCode = null;
  } catch (error) {
    teamState.errorCode = error.code || 'request-failed';
  } finally {
    teamState.loading = false;
    renderTeam();
  }
}

async function updateTeam(request, successMessage) {
  try {
    teamState.data = await request();
    teamState.errorCode = null;
    teamState.message = successMessage;
    teamState.confirmingRevokeId = null;
  } catch (error) {
    teamState.message = getTeamErrorMessage(error.code);
  }
  renderTeam();
  document.querySelector('.team-status')?.focus();
}

function getTeamErrorMessage(errorCode) {
  const useChinese = tagUiState.language === 'zh';
  const messages = {
    'invalid-phone': ['请输入有效的中国大陆手机号。', 'Enter a valid mainland China mobile number.'],
    'invalid-staff-label': ['请填写 2–40 个字符的名称。', 'Enter a name of 2–40 characters.'],
    'invalid-role': ['请选择审核员或管理员。', 'Choose reviewer or administrator.'],
    'cannot-change-own-role': ['不能修改自己的角色，请让另一位管理员操作。', 'You cannot change your own role; ask another administrator.'],
    'staff-not-found': ['找不到这位团队成员，列表已刷新。', 'This team member was not found; the list was refreshed.'],
    'administrator-required': ['只有管理员可以管理团队。', 'Only administrators can manage the team.']
  };
  const message = messages[errorCode] || ['操作没有成功，请稍后重试。', 'That did not work. Please try again.'];
  return message[useChinese ? 0 : 1];
}

function formatStaffRole(role) {
  return STAFF_ROLE_LABELS[role]?.[tagUiState.language === 'zh' ? 0 : 1] || role;
}

function renderTeam() {
  const panel = document.getElementById('team-panel');
  if (!panel) return;
  const useChinese = tagUiState.language === 'zh';

  if (!window.FFG_AUTH?.can('manage-staff')) {
    panel.innerHTML = `<p class="team-empty">${useChinese ? '只有管理员可以管理审核团队。' : 'Only administrators can manage the review team.'}</p>`;
    return;
  }
  if (!teamState.data) {
    panel.innerHTML = `<p class="team-empty">${teamState.errorCode
      ? (useChinese ? '暂时无法加载团队信息，请稍后重试。' : 'The team could not be loaded. Please try again.')
      : (useChinese ? '正在加载团队……' : 'Loading the team…')}</p>`;
    return;
  }

  const date = (value) => (value ? formatOwnedStoryDate(value) : '');
  panel.innerHTML = `
    <section class="team-card" aria-labelledby="appoint-heading">
      <h2 id="appoint-heading">${useChinese ? '任命团队成员' : 'Appoint a team member'}</h2>
      <p class="form-help">${useChinese
        ? '对方不需要提前登录：用这个手机号第一次登录时就会拥有权限。手机号只用于找到对应账户，不会被保存或显示。已在团队中的号码会更新名称和角色。'
        : 'They do not need to sign in first: the role is waiting when they sign in with this number. The number only locates their account and is never stored or shown. A number already on the team updates its name and role.'}</p>
      <form class="appoint-form" data-appoint-form>
        <label>${useChinese ? '手机号' : 'Mobile number'}
          <input name="staff-phone" type="tel" inputmode="numeric" maxlength="13" autocomplete="off" required>
        </label>
        <label>${useChinese ? '名称（团队内可见）' : 'Name (visible to the team)'}
          <input name="staff-label" type="text" minlength="2" maxlength="40" autocomplete="off" required>
        </label>
        <label>${useChinese ? '角色' : 'Role'}
          <select name="staff-role">
            <option value="moderator">${formatStaffRole('moderator')}</option>
            <option value="administrator">${formatStaffRole('administrator')}</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primary">${useChinese ? '保存' : 'Save'}</button>
      </form>
      ${teamState.message ? `<p class="team-status" role="status" tabindex="-1">${escapeHtml(teamState.message)}</p>` : ''}
    </section>

    <section class="team-card" aria-labelledby="team-heading">
      <h2 id="team-heading">${useChinese ? '当前团队' : 'Current team'}</h2>
      <ul class="team-list">
        ${teamState.data.staff.map((member) => {
          const id = escapeHtml(member.accountId);
          const actions = member.isYou
            ? `<span class="team-you">${useChinese ? '你（角色需由其他管理员调整）' : 'You (another administrator changes your role)'}</span>`
            : teamState.confirmingRevokeId === member.accountId
              ? `<span>${useChinese ? `撤销 ${escapeHtml(member.label)} 的权限？立即生效。` : `Remove ${escapeHtml(member.label)} from the team? This applies immediately.`}</span>
                 <button type="button" class="btn btn-reject btn-sm" data-staff-action="confirm-revoke" data-account-id="${id}">${useChinese ? '确认撤销' : 'Remove'}</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-staff-action="cancel">${useChinese ? '取消' : 'Cancel'}</button>`
              : `<button type="button" class="btn btn-secondary btn-sm" data-staff-action="change" data-account-id="${id}" data-role="${member.role === 'administrator' ? 'moderator' : 'administrator'}">
                   ${member.role === 'administrator' ? (useChinese ? '改为审核员' : 'Make reviewer') : (useChinese ? '设为管理员' : 'Make administrator')}
                 </button>
                 <button type="button" class="btn btn-ghost btn-sm" data-staff-action="revoke" data-account-id="${id}">${useChinese ? '撤销权限' : 'Remove from team'}</button>`;
          return `
            <li class="team-member">
              <div>
                <strong>${escapeHtml(member.label || (useChinese ? '（未命名）' : '(unnamed)'))}</strong>
                <span class="review-status">${escapeHtml(formatStaffRole(member.role))}</span>
                ${member.since ? `<small>${useChinese ? '自' : 'Since'} ${escapeHtml(date(member.since))}</small>` : ''}
              </div>
              <div class="owner-control-actions">${actions}</div>
            </li>
          `;
        }).join('')}
      </ul>
    </section>

    <section class="team-card" aria-labelledby="changes-heading">
      <h2 id="changes-heading">${useChinese ? '最近的权限变更' : 'Recent role changes'}</h2>
      ${teamState.data.changes.length ? `
        <ul class="team-changes">
          ${teamState.data.changes.map((change) => {
            const actor = change.byServerOperator
              ? (useChinese ? '服务器管理员' : 'A server operator')
              : (change.changedByLabel || (useChinese ? '一位管理员' : 'An administrator'));
            return `
              <li>
                <span>${escapeHtml(useChinese
                  ? `${actor} 将 ${change.label || '（未命名）'} 从${formatStaffRole(change.previousRole)}改为${formatStaffRole(change.newRole)}`
                  : `${actor} changed ${change.label || '(unnamed)'} from ${formatStaffRole(change.previousRole)} to ${formatStaffRole(change.newRole)}`)}</span>
                <small>${escapeHtml(date(change.createdAt))}</small>
              </li>
            `;
          }).join('')}
        </ul>
      ` : `<p class="form-help">${useChinese ? '还没有权限变更记录。' : 'No role changes yet.'}</p>`}
    </section>
  `;
}

function initRankings() {
  if (!window.FFG_CONTENT_API?.enabled) return;
  document.querySelectorAll('[data-server-only]').forEach((element) => { element.hidden = false; });

  document.getElementById('rankings-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-ranking-tab]');
    if (!tab) return;
    rankingState.tab = tab.dataset.rankingTab;
    renderRankings();
    document.querySelector(`[data-ranking-tab="${rankingState.tab}"]`)?.focus();
  });

  document.getElementById('rankings-content')?.addEventListener('click', (event) => {
    const windowButton = event.target.closest('[data-ranking-window]');
    if (windowButton) {
      rankingState.readWindow = windowButton.dataset.rankingWindow;
      renderRankings();
      return;
    }
    const trigger = event.target.closest('[data-story-id]');
    if (trigger) openRankedStory(trigger.dataset.storyId, trigger);
  });

  // Rankings refresh every minute while the page is open, matching the server cache.
  rankingState.refreshTimer = window.setInterval(() => {
    const onPage = document.getElementById('page-rankings')?.classList.contains('active');
    if (onPage && document.visibilityState === 'visible') loadRankings();
  }, 60 * 1000);
  loadRankings();
}

async function loadRankings() {
  if (!window.FFG_CONTENT_API?.enabled || rankingState.loading) return;
  rankingState.loading = true;
  try {
    rankingState.data = await window.FFG_CONTENT_API.getRankings();
    rankingState.errorCode = null;
  } catch (error) {
    rankingState.errorCode = error.code || 'request-failed';
  } finally {
    rankingState.loading = false;
    renderRankings();
  }
}

// Ranked stories may be older than the archive's latest 100, so add them on demand.
function openRankedStory(storyId, trigger) {
  if (!findStoryById(storyId)) {
    const ranked = rankingState.data?.stories.find((story) => story.id === storyId);
    const story = ranked && normalisePublishedStory(ranked);
    if (!story) return;
    stories.push(story);
  }
  openStoryModal(storyId, trigger);
}

function getRankedEntries() {
  const rankings = rankingState.data?.rankings;
  if (!rankings) return [];
  const ids = {
    trending: rankings.trending,
    mostRead: rankingState.readWindow === 'week' ? rankings.mostReadWeek : rankings.mostReadDay,
    mostDiscussed: rankings.mostDiscussed,
    recommended: rankings.recommended.map(({ storyId }) => storyId)
  }[rankingState.tab] || [];
  return ids.map((storyId) => ({
    story: rankingState.data.stories.find((story) => story.id === storyId),
    reason: rankings.recommended.find((entry) => entry.storyId === storyId)?.reason || ''
  })).filter(({ story }) => story);
}

function renderRankings() {
  const tabs = document.getElementById('rankings-tabs');
  const content = document.getElementById('rankings-content');
  if (!tabs || !content) return;
  const useChinese = tagUiState.language === 'zh';

  tabs.innerHTML = RANKING_TABS.map((tab) => `
    <button type="button" role="tab" class="ranking-tab${tab.key === rankingState.tab ? ' is-active' : ''}"
      aria-selected="${tab.key === rankingState.tab}" data-ranking-tab="${tab.key}">
      ${escapeHtml(useChinese ? tab.zh : tab.en)}
    </button>
  `).join('');

  const activeTab = RANKING_TABS.find((tab) => tab.key === rankingState.tab) || RANKING_TABS[0];
  if (rankingState.errorCode && !rankingState.data) {
    content.innerHTML = `<p class="rankings-empty">${useChinese ? '暂时无法加载榜单，请稍后再试。' : 'Rankings could not be loaded. Please try again later.'}</p>`;
    return;
  }

  const entries = getRankedEntries();
  const windowToggle = activeTab.key === 'mostRead' ? `
    <div class="ranking-window" role="group" aria-label="${useChinese ? '时间范围' : 'Time range'}">
      ${[['day', '24 小时', 'Past 24 hours'], ['week', '7 天', 'Past 7 days']].map(([value, zh, en]) => `
        <button type="button" class="ranking-window-button${rankingState.readWindow === value ? ' is-active' : ''}"
          aria-pressed="${rankingState.readWindow === value}" data-ranking-window="${value}">${useChinese ? zh : en}</button>
      `).join('')}
    </div>
  ` : '';
  const updatedAt = rankingState.data?.generatedAt
    ? `${useChinese ? '每分钟更新 · 更新于' : 'Refreshed every minute · updated'} ${formatOwnedStoryDate(rankingState.data.generatedAt)}`
    : '';

  content.innerHTML = `
    <div class="ranking-heading">
      <p class="ranking-hint">${escapeHtml(useChinese ? activeTab.hintZh : activeTab.hintEn)}</p>
      ${windowToggle}
    </div>
    ${entries.length ? `
      <ol class="ranking-list">
        ${entries.map(({ story, reason }, index) => `
          <li>
            <button type="button" class="ranking-entry" data-story-id="${escapeHtml(story.id)}" aria-haspopup="dialog">
              <span class="ranking-position" aria-hidden="true">${index + 1}</span>
              <span class="ranking-body">
                <span class="story-board">${escapeHtml(formatBoardName(story.board))}</span>
                <strong>${escapeHtml(story.title)}</strong>
                <span class="ranking-excerpt">${escapeHtml(truncateText(story.content, 110))}</span>
                ${reason ? `<span class="ranking-reason">${useChinese ? '推荐理由：' : 'Why we picked it: '}${escapeHtml(reason)}</span>` : ''}
              </span>
            </button>
          </li>
        `).join('')}
      </ol>
    ` : `<p class="rankings-empty">${activeTab.key === 'recommended'
      ? (useChinese ? '审核团队还没有推荐故事。' : 'The review team has not picked any stories yet.')
      : (useChinese ? '还没有足够的阅读和回应来形成这个榜单。' : 'There is not enough reading or discussion for this list yet.')}</p>`}
    <p class="ranking-updated">${escapeHtml(updatedAt)}</p>
  `;
}

function renderRecommendationControl(story) {
  // Reviewers cannot feature their own stories, so the tool is not offered.
  if (!isServerStory(story) || !isReviewerSession() || isOwnedStory(story)) return '';
  const useChinese = tagUiState.language === 'zh';
  const current = rankingState.data?.rankings.recommended.find((entry) => entry.storyId === story.id);
  const message = rankingState.recommendMessage
    ? `<p class="report-status" role="status">${escapeHtml(rankingState.recommendMessage)}</p>`
    : '';

  if (rankingState.recommendFormOpen) {
    return `
      <form class="recommend-panel report-panel" data-recommend-form>
        <label for="recommend-reason">${useChinese ? '推荐理由（会公开显示，8–300个字符）' : 'Reason (shown publicly, 8–300 characters)'}</label>
        <textarea id="recommend-reason" name="recommend-reason" rows="2" minlength="8" maxlength="300" required></textarea>
        <div class="owner-control-actions">
          <button type="submit" class="btn btn-primary btn-sm">${useChinese ? '推荐到榜单' : 'Add to team picks'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-recommend-action="cancel">${useChinese ? '取消' : 'Cancel'}</button>
        </div>
        ${message}
      </form>
    `;
  }
  return `
    <section class="recommend-panel">
      <span class="prototype-badge">${useChinese ? '审核员工具' : 'Reviewer tool'}</span>
      ${current
        ? `<p>${useChinese ? '已在“审核团队推荐”中：' : 'In team picks: '}${escapeHtml(current.reason)}</p>
           <button type="button" class="btn btn-ghost btn-sm" data-recommend-action="remove">${useChinese ? '取消推荐' : 'Remove from team picks'}</button>`
        : `<button type="button" class="btn btn-secondary btn-sm" data-recommend-action="open">${useChinese ? '推荐到榜单' : 'Recommend for team picks'}</button>`}
      ${message}
    </section>
  `;
}

async function handleRecommendAction(action) {
  const story = findStoryById(appState.activeStoryId);
  if (!story) return;
  const useChinese = tagUiState.language === 'zh';
  rankingState.recommendMessage = '';

  if (action === 'open' || action === 'cancel') {
    rankingState.recommendFormOpen = action === 'open';
    renderModalStory(story);
    document.getElementById('recommend-reason')?.focus();
    return;
  }

  try {
    if (action === 'submit') {
      const reason = document.getElementById('recommend-reason')?.value.trim() || '';
      if (reason.length < 8) {
        rankingState.recommendMessage = useChinese ? '请写 8–300 个字符的推荐理由。' : 'Write a reason of 8–300 characters.';
        renderModalStory(story);
        return;
      }
      await window.FFG_CONTENT_API.recommendStory(story.id, reason);
      rankingState.recommendMessage = useChinese ? '已加入“审核团队推荐”。' : 'Added to team picks.';
    } else if (action === 'remove') {
      await window.FFG_CONTENT_API.unrecommendStory(story.id);
      rankingState.recommendMessage = useChinese ? '已从“审核团队推荐”中移除。' : 'Removed from team picks.';
    }
    rankingState.recommendFormOpen = false;
    await loadRankings();
  } catch (error) {
    rankingState.recommendMessage = useChinese ? '操作没有成功，请稍后重试。' : 'That did not work. Please try again.';
  }
  if (findStoryById(appState.activeStoryId) === story) renderModalStory(story);
}

// Figures are private to the author; public pages only show ranking order.
// Shown when someone's own words suggest they may be in danger. It does not
// diagnose or judge; it points to people who can help. Resources come only from
// the team-verified list in care-resources.js; emergency numbers are mainland China's.
function renderCarePanel() {
  const useChinese = tagUiState.language === 'zh';
  const resources = window.FFG_CARE_RESOURCES?.resources || [];
  return `
    <aside class="care-panel" role="note">
      <strong>${useChinese ? '你不必一个人扛着' : 'You do not have to carry this alone'}</strong>
      <p>${useChinese
        ? '从你写下的内容里，我们感觉你可能正经历很艰难的时刻。如果你有伤害自己的想法，或觉得自己可能有危险，请尽快联系身边信任的人、学校心理健康中心或辅导员。'
        : 'What you wrote suggests you may be going through a very hard time. If you are thinking about hurting yourself or feel you may be in danger, please reach out soon to someone you trust, your university counselling centre, or a tutor.'}</p>
      <p>${useChinese
        ? '如果情况紧急，请立即拨打 120（急救）或 110（报警）。'
        : 'If it is an emergency, call your local emergency number now (in mainland China: 120 for medical help, 110 for police).'}</p>
      ${resources.length ? `
        <ul class="care-resources">
          ${resources.map((resource) => `
            <li>
              <strong>${escapeHtml(useChinese ? resource.name : resource.nameEn || resource.name)}</strong>
              <span>${escapeHtml(resource.contact)}${resource.hours ? ` · ${escapeHtml(useChinese ? resource.hours : resource.hoursEn || resource.hours)}` : ''}</span>
              ${resource.note ? `<small>${escapeHtml(useChinese ? resource.note : resource.noteEn || resource.note)}</small>` : ''}
            </li>
          `).join('')}
        </ul>
      ` : ''}
      <small>${useChinese
        ? 'Fail Forward Gallery 是同伴支持平台，不能代替专业帮助或紧急救援。'
        : 'Fail Forward Gallery offers peer support; it cannot replace professional help or emergency services.'}</small>
    </aside>
  `;
}

function renderOwnerStats(story) {
  if (!story.stats || !['approved', 'withdrawn', 'rejected'].includes(story.moderationStatus)) return '';
  if (story.moderationStatus !== 'approved' && story.stats.totalViews === 0) return '';
  const useChinese = tagUiState.language === 'zh';
  const { totalViews, weekViews, approvedComments } = story.stats;
  return `
    <p class="owner-stats">
      ${useChinese
        ? `累计 ${totalViews} 位读者 · 近 7 天 ${weekViews} 位 · ${approvedComments} 条公开回应`
        : `${totalViews} readers in total · ${weekViews} in the past 7 days · ${approvedComments} public responses`}
      <span>${useChinese ? '仅你可见' : 'Only visible to you'}</span>
    </p>
  `;
}

function resetReportState() {
  reportState.targetKey = null;
  reportState.messageKey = null;
  reportState.message = '';
}

function renderReportControl(contentType, contentId) {
  const useChinese = tagUiState.language === 'zh';
  const key = `${contentType}:${contentId}`;
  const dataAttributes = `data-content-type="${escapeHtml(contentType)}" data-content-id="${escapeHtml(contentId)}"`;

  if (reportState.messageKey === key) {
    return `<p class="report-status" role="status" tabindex="-1">${escapeHtml(reportState.message)}</p>`;
  }
  if (reportState.targetKey !== key) {
    return `<button type="button" class="report-link" data-report-action="open" ${dataAttributes}>${useChinese ? '举报' : 'Report'}</button>`;
  }
  if (!isSignedIn()) {
    return `
      <div class="report-panel">
        <p>${useChinese ? '登录后才能举报，这样可以防止举报被滥用。你的身份不会告诉作者。' : 'Sign in to report; this keeps reports from being misused. Authors never learn who reported.'}</p>
        <div class="owner-control-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-page="account">${useChinese ? '去登录' : 'Sign in'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-report-action="cancel">${useChinese ? '取消' : 'Cancel'}</button>
        </div>
      </div>
    `;
  }

  const fieldId = `report-${key.replace(/[^A-Za-z0-9-]/g, '-')}`;
  return `
    <form class="report-panel" data-report-form ${dataAttributes}>
      <label for="${fieldId}-reason">${useChinese ? '举报原因' : 'Why should a reviewer look at this?'}</label>
      <select id="${fieldId}-reason" name="report-reason" required>
        <option value="">${useChinese ? '请选择' : 'Choose one'}</option>
        ${REPORT_REASON_OPTIONS.map((option) => `<option value="${option.value}">${escapeHtml(useChinese ? option.zh : option.en)}</option>`).join('')}
      </select>
      <label for="${fieldId}-details">${useChinese ? '补充说明（选填，选“其他原因”时必填）' : 'Details (optional; required for “Something else”)'}</label>
      <textarea id="${fieldId}-details" name="report-details" rows="2" maxlength="500"></textarea>
      <p class="form-help">${useChinese ? '审核员会复查这条内容，作者不会知道是谁举报的。' : 'A reviewer will look again. The author is never told who reported.'}</p>
      <div class="owner-control-actions">
        <button type="submit" class="btn btn-primary btn-sm">${useChinese ? '提交举报' : 'Send report'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-report-action="cancel">${useChinese ? '取消' : 'Cancel'}</button>
      </div>
      <p class="report-error" role="status" aria-live="polite"></p>
    </form>
  `;
}

function handleReportAction(button) {
  const story = findStoryById(appState.activeStoryId);
  if (!story) return;
  resetReportState();
  if (button.dataset.reportAction === 'open') {
    reportState.targetKey = `${button.dataset.contentType}:${button.dataset.contentId}`;
  }
  renderModalStory(story);
  document.querySelector('.report-panel select, .report-panel button')?.focus();
}

async function submitReport(form) {
  const { contentType, contentId } = form.dataset;
  const reasonCode = form.querySelector('[name="report-reason"]').value;
  const details = form.querySelector('[name="report-details"]').value.trim();
  const error = form.querySelector('.report-error');
  if (!reasonCode || (reasonCode === 'other' && details.length < 5)) {
    error.textContent = tagUiState.language === 'zh'
      ? '请选择举报原因；选择“其他原因”时请简单说明。'
      : 'Choose a reason; “Something else” needs a short description.';
    return;
  }

  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    await window.FFG_CONTENT_API.reportContent(contentType, contentId, { reasonCode, details });
    resetReportState();
    reportState.messageKey = `${contentType}:${contentId}`;
    reportState.message = tagUiState.language === 'zh'
      ? '已收到举报，审核员会尽快复查。处理结果会出现在你的通知里。'
      : 'Report received. A reviewer will look soon; the outcome will appear in your notifications.';
    const story = findStoryById(appState.activeStoryId);
    if (story) renderModalStory(story);
    document.querySelector('.report-status')?.focus();
  } catch (requestError) {
    form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    error.textContent = getResponseErrorMessage(requestError.code);
  }
}

function renderServerCommentForm(story) {
  const useChinese = tagUiState.language === 'zh';
  if (!isSignedIn()) {
    return `
      <div class="comment-sign-in">
        <p>${useChinese
          ? '登录后可以回应。你的手机号不会公开，回应会以匿名身份显示，并在人工审核通过后出现。'
          : 'Sign in to respond. Your mobile number stays private; responses appear anonymously after human review.'}</p>
        <button type="button" class="btn btn-secondary" data-page="account">${useChinese ? '登录后回应' : 'Sign in to respond'}</button>
      </div>
    `;
  }

  const placeholder = useChinese
    ? `请按照“${formatCommentType(story.commentMode)}”的边界友善回应……`
    : `Respond with ${formatCommentType(story.commentMode).toLowerCase()}...`;
  return `
    <form class="comment-form" data-server-comment-form>
      <label for="comment-text">${useChinese ? '你的回应' : 'Your response'}</label>
      <textarea
        id="comment-text"
        name="comment-text"
        rows="3"
        maxlength="1000"
        required
        placeholder="${escapeHtml(placeholder)}"
      ></textarea>
      <button type="submit" class="btn btn-primary">${useChinese ? '提交回应' : 'Submit response'}</button>
      <p class="comment-prototype-note" id="comment-prototype-note" data-comment-status role="status" aria-live="polite" tabindex="-1">
        ${useChinese
          ? '回应会匿名显示，并在人工审核通过后公开。你可以在“我的故事”中查看审核状态。'
          : 'Responses appear anonymously after a human reviewer approves them. You can follow the status in My stories.'}
      </p>
    </form>
  `;
}

async function submitCommentToServer(form, story) {
  const textarea = form.querySelector('textarea');
  const status = form.querySelector('[data-comment-status]');
  const submitButton = form.querySelector('button[type="submit"]');
  const content = textarea?.value.trim();
  if (!content) {
    form.reportValidity();
    return;
  }

  submitButton.disabled = true;
  status.textContent = tagUiState.language === 'zh' ? '正在提交……' : 'Submitting...';
  try {
    const created = await window.FFG_CONTENT_API.createComment(story.id, { content });
    textarea.value = '';
    status.textContent = tagUiState.language === 'zh'
      ? '已提交人工审核。通过后会匿名显示在这里；你可以在“我的故事”中查看状态。'
      : 'Submitted for human review. Once approved it will appear here anonymously; you can follow the status in My stories.';
    form.querySelector('.care-panel')?.remove();
    if (created.careSuggested) status.insertAdjacentHTML('afterend', renderCarePanel());
    loadMyStories();
  } catch (error) {
    status.textContent = getResponseErrorMessage(error.code);
  } finally {
    submitButton.disabled = false;
    status.focus();
  }
}

function renderAdvice() {
  const grid = document.getElementById('advice-grid');
  if (!grid || appState.adviceRendered) return;

  grid.innerHTML = adviceArticles.map((article) => {
    const useChinese = tagUiState.language === 'zh';
    const title = useChinese && article.titleZh ? article.titleZh : article.title;
    const summary = useChinese && article.summaryZh ? article.summaryZh : article.summary;
    const steps = useChinese && article.stepsZh ? article.stepsZh : article.steps;

    return `
      <article class="advice-card">
        <span class="story-board">${escapeHtml(formatBoardName(article.board))}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(summary)}</p>
        <details>
          <summary>${useChinese ? '查看具体建议' : 'View practical steps'}</summary>
          <ol>
            ${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
          </ol>
        </details>
        <div class="story-tags">
          ${article.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
        </div>
      </article>
    `;
  }).join('');

  appState.adviceRendered = true;
  applySiteLanguage(grid);
}

function isReviewerSession(authState = window.FFG_AUTH?.getSnapshot()) {
  return authState?.status === window.FFG_AUTH?.STATUS.AUTHENTICATED
    && ['moderator', 'administrator'].includes(authState.account?.role);
}

function getModerationErrorMessage(errorCode) {
  const useChinese = tagUiState.language === 'zh';
  const messages = {
    'own-content': {
      zh: '不能审核自己写的内容，需要由其他审核员处理。',
      en: 'You cannot review your own content; another reviewer will handle it.'
    },
    'moderator-required': {
      zh: '当前账户没有审核权限。',
      en: 'This account does not have reviewer access.'
    },
    'invalid-review-reason': {
      zh: '请填写8–500个字符的审核理由。',
      en: 'Provide a review reason between 8 and 500 characters.'
    },
    'review-conflict': {
      zh: '这篇故事已由其他审核操作处理，队列将重新加载。',
      en: 'This story was already reviewed elsewhere. The queue will be refreshed.'
    },
    'network-error': {
      zh: '暂时无法连接审核服务，请稍后重试。',
      en: 'The moderation service could not be reached. Try again later.'
    }
  };
  return messages[errorCode]?.[useChinese ? 'zh' : 'en']
    || (useChinese ? '审核操作暂时无法完成，请重试。' : 'The moderation action could not be completed. Try again.');
}

function initModeration() {
  if (moderationState.initialised || !window.FFG_AUTH) return;
  moderationState.initialised = true;

  document.getElementById('refresh-moderation')?.addEventListener('click', () => {
    moderationState.loaded = false;
    moderationState.message = '';
    loadModerationStories();
  });

  document.getElementById('moderation-list')?.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-moderation-form]');
    if (!form) return;
    event.preventDefault();

    const decision = event.submitter?.dataset.reviewDecision;
    const contentType = form.dataset.contentType;
    const contentId = form.dataset.contentId;
    const reasonInput = form.querySelector('[name="review-reason"]');
    const status = form.querySelector('[data-review-status]');
    const reason = String(reasonInput?.value || '').trim();
    if (!MODERATION_DECISIONS[contentType]?.includes(decision)) return;

    if (reason.length < 8 || reason.length > 500) {
      if (status) status.textContent = getModerationErrorMessage('invalid-review-reason');
      reasonInput?.focus();
      return;
    }

    moderationState.actionContentId = contentId;
    form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    if (status) {
      status.textContent = tagUiState.language === 'zh'
        ? '正在记录审核决定……'
        : 'Recording the review decision...';
    }

    try {
      await window.FFG_CONTENT_API[MODERATION_ACTIONS[contentType]](contentId, { decision, reason });
      moderationState.items = moderationState.items.filter(({ item }) => item.id !== contentId);
      moderationState.errorCode = null;
      moderationState.message = getModerationDecisionMessage(contentType, decision);
      renderModeration();
      await Promise.allSettled([loadPublishedStories(), loadMyStories()]);
    } catch (error) {
      const actionErrorCode = error.code || 'request-failed';
      moderationState.message = getModerationErrorMessage(actionErrorCode);
      if (status) status.textContent = moderationState.message;
      form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      if (error.code === 'review-conflict') {
        moderationState.loaded = false;
        await loadModerationStories();
      }
    } finally {
      moderationState.actionContentId = null;
    }
  });

  window.FFG_AUTH.subscribe((authState) => {
    if (isReviewerSession(authState) && window.FFG_CONTENT_API?.enabled) {
      renderModeration(authState);
      if (!moderationState.loaded && !moderationState.loading) loadModerationStories();
      return;
    }

    moderationState.requestVersion += 1;
    moderationState.loading = false;
    moderationState.loaded = false;
    moderationState.items = [];
    moderationState.errorCode = null;
    moderationState.message = '';
    renderModeration(authState);
  });
}

async function loadModerationStories() {
  const authState = window.FFG_AUTH?.getSnapshot();
  if (!isReviewerSession(authState) || !window.FFG_CONTENT_API?.enabled) {
    renderModeration(authState);
    return;
  }

  const requestVersion = moderationState.requestVersion + 1;
  moderationState.requestVersion = requestVersion;
  moderationState.loading = true;
  moderationState.errorCode = null;
  moderationState.message = '';
  renderModeration(authState);

  try {
    const [storyQueue, commentQueue, followUpQueue, appealQueue, reportQueue, heldQueue] = await Promise.all([
      window.FFG_CONTENT_API.listModerationStories(),
      window.FFG_CONTENT_API.listModerationComments(),
      window.FFG_CONTENT_API.listModerationFollowUps(),
      window.FFG_CONTENT_API.listModerationAppeals(),
      window.FFG_CONTENT_API.listReportedContent(),
      window.FFG_CONTENT_API.listHeldContent()
    ]);
    if (requestVersion !== moderationState.requestVersion) return;
    // Safety concerns first; otherwise oldest first across all types, so nothing
    // waits behind a busy type.
    moderationState.items = [
      ...storyQueue.map((item) => ({ contentType: 'story', item })),
      ...commentQueue.map((item) => ({ contentType: 'comment', item })),
      ...followUpQueue.map((item) => ({ contentType: 'follow-up', item })),
      ...appealQueue.map((item) => ({ contentType: 'appeal', item })),
      ...reportQueue.map((item) => ({ contentType: 'report', item })),
      ...heldQueue.map((item) => ({ contentType: 'held', item }))
    ].sort((first, second) => (
      Number(isUrgentModerationItem(second.item)) - Number(isUrgentModerationItem(first.item))
      || first.item.createdAt.localeCompare(second.item.createdAt)
    ));
    moderationState.loaded = true;
  } catch (error) {
    if (requestVersion !== moderationState.requestVersion) return;
    moderationState.errorCode = error.code || 'request-failed';
    moderationState.loaded = false;
    // A revoked reviewer's page still shows reviewer tools until the role is re-read.
    if (['moderator-required', 'authentication-required'].includes(error.code)) {
      window.FFG_AUTH.restoreSession().catch(() => {});
    }
  } finally {
    if (requestVersion === moderationState.requestVersion) {
      moderationState.loading = false;
      renderModeration();
    }
  }
}

function renderModeration(authState = window.FFG_AUTH?.getSnapshot()) {
  const locked = document.getElementById('moderation-locked');
  const loading = document.getElementById('moderation-loading');
  const error = document.getElementById('moderation-error');
  const empty = document.getElementById('moderation-empty');
  const list = document.getElementById('moderation-list');
  const status = document.getElementById('moderation-page-status');
  const refresh = document.getElementById('refresh-moderation');
  if (!locked || !loading || !error || !empty || !list || !status || !refresh) return;

  const canReview = isReviewerSession(authState) && Boolean(window.FFG_CONTENT_API?.enabled);
  locked.hidden = canReview;
  loading.hidden = !canReview || !moderationState.loading;
  error.hidden = !canReview || moderationState.loading || !moderationState.errorCode;
  empty.hidden = !canReview
    || moderationState.loading
    || Boolean(moderationState.errorCode)
    || !moderationState.loaded
    || moderationState.items.length > 0;
  list.hidden = !canReview
    || moderationState.loading
    || Boolean(moderationState.errorCode)
    || moderationState.items.length === 0;
  refresh.disabled = !canReview || moderationState.loading;

  const useChinese = tagUiState.language === 'zh';
  if (!canReview) {
    const signedIn = authState?.status === window.FFG_AUTH?.STATUS.AUTHENTICATED;
    locked.querySelector('h3').textContent = signedIn
      ? (useChinese ? '当前账户没有审核权限' : 'This account does not have reviewer access')
      : (useChinese ? '需要审核员权限' : 'Moderator access is required');
    locked.querySelector('p').textContent = signedIn
      ? (useChinese ? '投稿与个人账户功能仍可正常使用。' : 'Story submission and private account features remain available.')
      : (useChinese ? '请使用获授权的审核员账户登录，才能查看私密投稿。' : 'Sign in with an authorised reviewer account to see private submissions.');
  }

  status.textContent = moderationState.message
    || (canReview && moderationState.loaded
      ? (useChinese
        ? `当前有 ${moderationState.items.length} 项内容等待人工审核。`
        : `${moderationState.items.length} ${moderationState.items.length === 1 ? 'item is' : 'items are'} awaiting human review.`)
      : '');

  if (list.hidden) {
    list.replaceChildren();
    return;
  }

  list.innerHTML = moderationState.items.map(renderModerationItem).join('');
}

function getModerationDecisionMessage(contentType, decision) {
  const useChinese = tagUiState.language === 'zh';
  const messages = {
    story: {
      approve: ['故事已通过人工审核，并进入匿名公开归档。', 'The story was approved by a human and added to the anonymous public archive.'],
      reject: ['故事未获发布批准，审核理由已保存给作者查看。', 'The story was not approved for publication. The reason is saved for the author.']
    },
    comment: {
      approve: ['回应已通过人工审核，并匿名显示在故事下方。', 'The response was approved and now appears anonymously under the story.'],
      reject: ['回应未获发布批准，审核理由已保存给回应者查看。', 'The response was not approved. The reason is saved for the person who wrote it.']
    },
    'follow-up': {
      approve: ['后续已通过人工审核，并显示在故事时间线中。', 'The follow-up was approved and now appears on the story timeline.'],
      reject: ['后续未获发布批准，审核理由已保存给作者查看。', 'The follow-up was not approved. The reason is saved for the author.']
    },
    appeal: {
      overturn: ['已撤销原决定，内容现已公开。', 'The original decision was reversed and the content is now public.'],
      uphold: ['已维持原决定，复核理由已保存给作者查看。', 'The original decision was upheld. The reason is saved for the author.']
    },
    report: {
      remove: ['内容已移除，作者和举报人都会收到通知；作者可以申诉。', 'The content was removed. The author and reporters are notified, and the author may appeal.'],
      dismiss: ['已保留内容，举报人会收到处理结果。', 'The content stays public. Reporters are told the outcome.'],
      'safety-hold': ['内容已暂停公开并转入安全保留，作者会看到关怀说明。', 'The content is unpublished and held for safety; the author sees a caring message.']
    },
    held: {
      release: ['已解除保留，内容现已公开。', 'The hold was released and the content is now public.'],
      reject: ['已转为不予发布，作者会看到理由并可以申诉。', 'The content will not be published; the author sees the reason and may appeal.']
    }
  };
  if (decision === 'safety-hold' && !messages[contentType]?.[decision]) {
    return useChinese
      ? '内容已转入安全保留，不会公开；作者会看到关怀说明，你可以稍后在队列中继续跟进。'
      : 'The content is held for safety and will not be published. The author sees a caring message; follow up from this queue later.';
  }
  return messages[contentType][decision][useChinese ? 0 : 1];
}

function renderModerationItem({ contentType, item }) {
  if (contentType === 'appeal') return renderAppealModerationItem(item);
  if (contentType === 'report') return renderReportModerationItem(item);
  if (contentType === 'held') return renderHeldModerationItem(item);
  const useChinese = tagUiState.language === 'zh';
  const reasonId = `review-reason-${contentType}-${item.id}`;
  const automatedLabel = item.automatedReviewStatus === 'not-configured' || !item.automatedReviewStatus
    ? (useChinese ? 'AI 安全筛查：未配置' : 'AI safety check: not configured')
    : (useChinese ? `AI 安全筛查：${item.automatedReviewStatus}` : `AI safety check: ${item.automatedReviewStatus}`);
  const approveLabel = {
    story: useChinese ? '批准并匿名发布' : 'Approve and publish anonymously',
    comment: useChinese ? '批准并匿名显示' : 'Approve and show anonymously',
    'follow-up': useChinese ? '批准并加入时间线' : 'Approve and add to timeline'
  }[contentType];

  let kicker;
  let heading;
  let body;
  if (contentType === 'comment') {
    kicker = `${useChinese ? '回应' : 'Response'} · ${formatCommentType(item.responseType)}`;
    heading = `${useChinese ? '回应：' : 'On: '}${item.storyTitle}`;
    body = `
      <p class="moderation-story-body">${escapeHtml(item.content)}</p>
      <details class="moderation-context">
        <summary>${useChinese ? '查看被回应的故事' : 'Show the story being answered'}</summary>
        <p>${escapeHtml(item.storyContent)}</p>
      </details>
    `;
  } else if (contentType === 'follow-up') {
    const status = getFollowUpStatus(item.status);
    kicker = useChinese ? '原作者后续' : 'Author follow-up';
    heading = `${useChinese ? '后续：' : 'Follow-up to: '}${item.storyTitle}`;
    body = `
      <p class="follow-up-status"><span>${escapeHtml(useChinese ? status.labelZh : status.label)}</span></p>
      ${item.content
        ? `<p class="moderation-story-body">${escapeHtml(item.content)}</p>`
        : `<p class="follow-up-no-details">${useChinese ? '未补充更多内容。' : 'No additional details shared.'}</p>`}
      ${item.support ? `
        <div class="follow-up-support">
          <strong>${useChinese ? '帮助与仍需的支持' : 'What helped or is still needed'}</strong>
          <p>${escapeHtml(item.support)}</p>
        </div>
      ` : ''}
    `;
  } else {
    kicker = formatBoardName(item.board);
    heading = item.title;
    body = `
      <p class="moderation-story-body">${escapeHtml(item.content)}</p>
      <div class="story-tags">
        ${item.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
      </div>
    `;
  }

  return `
    <article class="moderation-item${item.riskSignal ? ' is-safety' : ''}">
      <div class="moderation-item-heading">
        <div>
          <span class="story-board">${escapeHtml(kicker)}</span>
          <h3>${escapeHtml(heading)}</h3>
        </div>
        <span class="review-status">${useChinese ? '待人工审核' : 'Pending human review'}</span>
      </div>
      ${renderRiskSignalNote(item.riskSignal)}
      ${body}
      <dl class="my-story-meta">
        ${contentType === 'story'
          ? `<div><dt>${useChinese ? '回应偏好' : 'Response preference'}</dt><dd>${escapeHtml(formatCommentType(item.responsePreference))}</dd></div>`
          : ''}
        <div><dt>${useChinese ? '提交时间' : 'Submitted'}</dt><dd>${escapeHtml(formatOwnedStoryDate(item.createdAt))}</dd></div>
      </dl>
      <p class="automated-review-state">${escapeHtml(automatedLabel)}</p>
      <form class="moderation-decision-form" data-moderation-form data-content-type="${escapeHtml(contentType)}" data-content-id="${escapeHtml(item.id)}">
        <label for="${escapeHtml(reasonId)}">${useChinese ? '给作者的审核理由（必填）' : 'Review reason for the author (required)'}</label>
        <textarea id="${escapeHtml(reasonId)}" name="review-reason" rows="3" minlength="8" maxlength="500" required placeholder="${useChinese ? '清楚说明批准依据，或需要修改的隐私与规范问题。' : 'Explain the approval basis or the privacy and guideline changes needed.'}"></textarea>
        <div class="moderation-actions">
          <button type="submit" class="btn btn-primary" data-review-decision="approve">${approveLabel}</button>
          <button type="submit" class="btn btn-reject" data-review-decision="reject">${useChinese ? '拒绝发布' : 'Reject publication'}</button>
          <button type="submit" class="btn btn-care" data-review-decision="safety-hold">${useChinese ? '安全保留' : 'Hold for safety'}</button>
        </div>
        <p class="moderation-card-status" data-review-status role="status" aria-live="polite"></p>
      </form>
    </article>
  `;
}

function renderModerationContentBody(contentType, content) {
  const useChinese = tagUiState.language === 'zh';
  if (contentType === 'follow_up') {
    const status = getFollowUpStatus(content.status);
    return `
      <p class="follow-up-status"><span>${escapeHtml(useChinese ? status.labelZh : status.label)}</span></p>
      ${content.content ? `<p class="moderation-story-body">${escapeHtml(content.content)}</p>` : ''}
      ${content.support ? `<p class="moderation-story-body">${escapeHtml(content.support)}</p>` : ''}
    `;
  }
  return `<p class="moderation-story-body">${escapeHtml(content.content)}</p>`;
}

function getContentHeading(contentType, content) {
  const useChinese = tagUiState.language === 'zh';
  return contentType === 'story'
    ? content.title
    : `${useChinese ? '所属故事：' : 'On: '}${content.storyTitle}`;
}

function getContentTypeLabel(contentType) {
  const useChinese = tagUiState.language === 'zh';
  return {
    story: useChinese ? '故事' : 'Story',
    comment: useChinese ? '回应' : 'Response',
    follow_up: useChinese ? '后续' : 'Follow-up'
  }[contentType];
}

function isUrgentModerationItem(item) {
  return Boolean(item.hasSafetyConcern || item.riskSignal || item.content?.riskSignal);
}

function renderRiskSignalNote(riskSignal) {
  if (!riskSignal) return '';
  const useChinese = tagUiState.language === 'zh';
  const labels = riskSignal.split(',')
    .map((code) => RISK_SIGNAL_LABELS[code]?.[useChinese ? 0 : 1])
    .filter(Boolean);
  return `
    <p class="appeal-self-review-note risk-signal-note">
      ${escapeHtml(useChinese ? `危险信号提示：${labels.join('、')}。` : `Danger signal: ${labels.join('; ')}.`)}
      ${useChinese
        ? '这是关键词提示，可能误报，请结合上下文判断；如果作者可能处于危险中，请选择“安全保留”。'
        : 'This is a keyword hint and may be wrong. Judge in context; if the writer may be in danger, hold it for safety.'}
    </p>
  `;
}

// Held content waits here until a reviewer releases it or declines to publish it.
function renderHeldModerationItem(entry) {
  const useChinese = tagUiState.language === 'zh';
  const { contentType, content } = entry;
  const reasonId = `review-reason-held-${entry.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
  return `
    <article class="moderation-item is-held">
      <div class="moderation-item-heading">
        <div>
          <span class="story-board">${escapeHtml(`${useChinese ? '安全保留中' : 'Held for safety'} · ${getContentTypeLabel(contentType)}`)}</span>
          <h3>${escapeHtml(getContentHeading(contentType, content))}</h3>
        </div>
        <span class="review-status">${useChinese ? '待跟进' : 'Needs follow-up'}</span>
      </div>
      ${renderRiskSignalNote(content.riskSignal)}
      ${renderModerationContentBody(contentType, content)}
      <div class="review-reason">
        <strong>${useChinese ? '保留说明（仅审核团队可见）' : 'Hold note (review team only)'}</strong>
        <p>${escapeHtml(content.decisionReason || '')}</p>
        ${content.decidedAt ? `<small>${escapeHtml(formatOwnedStoryDate(content.decidedAt))}</small>` : ''}
      </div>
      <form class="moderation-decision-form" data-moderation-form data-content-type="held" data-content-id="${escapeHtml(entry.id)}">
        <label for="${escapeHtml(reasonId)}">${useChinese ? '跟进说明（必填；转为不予发布时会显示给作者）' : 'Follow-up note (required; shown to the author if not published)'}</label>
        <textarea id="${escapeHtml(reasonId)}" name="review-reason" rows="3" minlength="8" maxlength="500" required></textarea>
        <div class="moderation-actions">
          <button type="submit" class="btn btn-primary" data-review-decision="release">${useChinese ? '解除保留并发布' : 'Release and publish'}</button>
          <button type="submit" class="btn btn-reject" data-review-decision="reject">${useChinese ? '转为不予发布' : 'Do not publish'}</button>
        </div>
        <p class="moderation-card-status" data-review-status role="status" aria-live="polite"></p>
      </form>
    </article>
  `;
}

// Reports on one item are shown together, without reporter identities.
function renderReportModerationItem(group) {
  const useChinese = tagUiState.language === 'zh';
  const reasonId = `review-reason-report-${group.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
  return `
    <article class="moderation-item is-report${group.hasSafetyConcern ? ' is-safety' : ''}">
      <div class="moderation-item-heading">
        <div>
          <span class="story-board">${escapeHtml(`${useChinese ? '举报' : 'Report'} · ${getContentTypeLabel(group.contentType)} · ${group.reportCount}`)}</span>
          <h3>${escapeHtml(getContentHeading(group.contentType, group.content))}</h3>
        </div>
        <span class="review-status">${useChinese ? '已公开 · 待复查' : 'Public · needs re-review'}</span>
      </div>
      ${group.hasSafetyConcern ? `
        <p class="appeal-self-review-note">${useChinese
          ? '有人认为作者可能处于危险中，请优先处理。正式版本会提供经过核验的地区求助资源；当前版本不会编造热线信息。'
          : 'Someone thinks the author may be in danger. Handle this first. The live platform will offer verified regional support; this version does not invent hotline details.'}</p>
      ` : ''}
      ${renderModerationContentBody(group.contentType, group.content)}
      <ul class="report-reasons">
        ${group.reports.map((report) => {
          const reason = REPORT_REASON_OPTIONS.find((option) => option.value === report.reasonCode);
          return `
            <li>
              <strong>${escapeHtml(reason ? (useChinese ? reason.zh : reason.en) : report.reasonCode)}</strong>
              ${report.details ? `<p>${escapeHtml(report.details)}</p>` : ''}
              <small>${escapeHtml(formatOwnedStoryDate(report.createdAt))}</small>
            </li>
          `;
        }).join('')}
      </ul>
      <form class="moderation-decision-form" data-moderation-form data-content-type="report" data-content-id="${escapeHtml(group.id)}">
        <label for="${escapeHtml(reasonId)}">${useChinese ? '处理理由（必填，移除时会显示给作者）' : 'Reason (required; shown to the author if removed)'}</label>
        <textarea id="${escapeHtml(reasonId)}" name="review-reason" rows="3" minlength="8" maxlength="500" required></textarea>
        <div class="moderation-actions">
          <button type="submit" class="btn btn-reject" data-review-decision="remove">${useChinese ? '移除内容' : 'Remove content'}</button>
          <button type="submit" class="btn btn-secondary" data-review-decision="dismiss">${useChinese ? '保留内容' : 'Keep content'}</button>
          <button type="submit" class="btn btn-care" data-review-decision="safety-hold">${useChinese ? '安全保留' : 'Hold for safety'}</button>
        </div>
        <p class="moderation-card-status" data-review-status role="status" aria-live="polite"></p>
      </form>
    </article>
  `;
}

// An appeal shows the rejected content, the original reason, and the author's
// structured appeal side by side, so the reviewer can judge the decision itself.
function renderAppealModerationItem(appeal) {
  const useChinese = tagUiState.language === 'zh';
  const content = appeal.content;
  const typeLabel = getContentTypeLabel(appeal.contentType);
  const heading = getContentHeading(appeal.contentType, content);
  const reason = APPEAL_REASON_OPTIONS.find((option) => option.value === appeal.reasonCode);
  const reasonId = `review-reason-appeal-${appeal.id}`;

  return `
    <article class="moderation-item is-appeal">
      <div class="moderation-item-heading">
        <div>
          <span class="story-board">${escapeHtml(`${useChinese ? '申诉' : 'Appeal'} · ${typeLabel}`)}</span>
          <h3>${escapeHtml(heading)}</h3>
        </div>
        <span class="review-status">${useChinese ? '待复核' : 'Awaiting re-review'}</span>
      </div>
      ${renderModerationContentBody(appeal.contentType, content)}
      <div class="review-reason">
        <strong>${useChinese ? '原审核决定：拒绝' : 'Original decision: rejected'}</strong>
        <p>${escapeHtml(appeal.originalDecisionReason || '')}</p>
        ${appeal.originalDecidedAt ? `<small>${escapeHtml(formatOwnedStoryDate(appeal.originalDecidedAt))}</small>` : ''}
      </div>
      <div class="review-reason appeal-claim">
        <strong>${useChinese ? '作者的申诉理由：' : 'Author’s reason: '}${escapeHtml(reason ? (useChinese ? reason.zh : reason.en) : appeal.reasonCode)}</strong>
        <p>${escapeHtml(appeal.explanation)}</p>
        <small>${escapeHtml(formatOwnedStoryDate(appeal.createdAt))}</small>
      </div>
      ${appeal.originalDecisionByYou ? `
        <p class="appeal-self-review-note">${useChinese
          ? '原决定是你作出的。如果团队里有其他审核员，建议交给他们复核。'
          : 'You made the original decision. If another reviewer is available, consider handing this appeal to them.'}</p>
      ` : ''}
      <form class="moderation-decision-form" data-moderation-form data-content-type="appeal" data-content-id="${escapeHtml(appeal.id)}">
        <label for="${escapeHtml(reasonId)}">${useChinese ? '给作者的复核理由（必填）' : 'Re-review reason for the author (required)'}</label>
        <textarea id="${escapeHtml(reasonId)}" name="review-reason" rows="3" minlength="8" maxlength="500" required></textarea>
        <div class="moderation-actions">
          <button type="submit" class="btn btn-primary" data-review-decision="overturn">${useChinese ? '撤销原决定并发布' : 'Reverse and publish'}</button>
          <button type="submit" class="btn btn-reject" data-review-decision="uphold">${useChinese ? '维持原决定' : 'Uphold decision'}</button>
        </div>
        <p class="moderation-card-status" data-review-status role="status" aria-live="polite"></p>
      </form>
    </article>
  `;
}

function initMyStories() {
  if (myStoriesState.initialised || !window.FFG_AUTH) return;
  myStoriesState.initialised = true;

  document.getElementById('retry-my-stories')?.addEventListener('click', () => {
    loadMyStories();
  });

  const workspace = document.getElementById('my-stories-card');
  workspace?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-owner-action]');
    if (button) handleOwnerAction(button);
  });
  document.getElementById('notifications-panel')?.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-notification-action="read-all"]')) return;
    try {
      applyNotifications(await window.FFG_CONTENT_API.markNotificationsRead());
    } catch (error) {
      console.warn('Notifications could not be marked as read.', error);
    }
  });

  workspace?.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-appeal-form]');
    if (!form) return;
    event.preventDefault();
    submitAppeal(form);
  });

  window.FFG_AUTH.subscribe((authState) => {
    syncSubmissionModeUI(authState);
    if (authState.status === window.FFG_AUTH.STATUS.AUTHENTICATED) {
      loadMyStories();
      startNotificationPolling();
      return;
    }

    stopNotificationPolling();

    myStoriesState.requestVersion += 1;
    myStoriesState.loading = false;
    myStoriesState.stories = [];
    myStoriesState.comments = [];
    myStoriesState.errorCode = null;
    resetOwnerControls();
    renderMyStories(authState);
  });
}

async function loadMyStories() {
  const authState = window.FFG_AUTH?.getSnapshot();
  if (
    authState?.status !== window.FFG_AUTH.STATUS.AUTHENTICATED
    || !window.FFG_CONTENT_API?.enabled
  ) {
    renderMyStories(authState);
    return;
  }

  const requestVersion = myStoriesState.requestVersion + 1;
  myStoriesState.requestVersion = requestVersion;
  myStoriesState.loading = true;
  myStoriesState.errorCode = null;
  renderMyStories(authState);

  try {
    const [ownedStories, ownComments] = await Promise.all([
      window.FFG_CONTENT_API.listMyStories(),
      window.FFG_CONTENT_API.listMyComments()
    ]);
    if (requestVersion !== myStoriesState.requestVersion) return;
    myStoriesState.stories = [...ownedStories];
    myStoriesState.comments = [...ownComments];
  } catch (error) {
    if (requestVersion !== myStoriesState.requestVersion) return;
    myStoriesState.errorCode = error.code || 'request-failed';
    if (error.code === 'authentication-required') {
      window.FFG_AUTH.restoreSession().catch(() => {});
    }
  } finally {
    if (requestVersion === myStoriesState.requestVersion) {
      myStoriesState.loading = false;
      renderMyStories();
    }
  }
}

function formatOwnedStoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(
    tagUiState.language === 'zh' ? 'zh-CN' : 'en',
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(date);
}

function getReviewStatusLabel(moderationStatus) {
  const useChinese = tagUiState.language === 'zh';
  const labels = {
    approved: { zh: '已通过并发布', en: 'Approved and published' },
    rejected: { zh: '审核未通过', en: 'Not approved' },
    withdrawn: { zh: '已撤回', en: 'Withdrawn' },
    private: { zh: '仅自己可见', en: 'Private to you' },
    'safety-hold': { zh: '暂缓公开 · 关怀优先', en: 'Not public for now · care first' },
    'pending-human-review': { zh: '待人工审核', en: 'Pending human review' }
  };
  const label = labels[moderationStatus] || labels['pending-human-review'];
  return useChinese ? label.zh : label.en;
}

function renderReviewNote(item) {
  if (!item.decisionReason) return '';
  const useChinese = tagUiState.language === 'zh';
  return `
    <div class="review-reason">
      <strong>${useChinese ? '人工审核说明' : 'Human review note'}</strong>
      <p>${escapeHtml(item.decisionReason)}</p>
      ${item.decidedAt ? `<small>${escapeHtml(formatOwnedStoryDate(item.decidedAt))}</small>` : ''}
    </div>
  `;
}

function startNotificationPolling() {
  if (!window.FFG_CONTENT_API?.enabled) return;
  loadNotifications();
  if (notificationState.pollTimer) return;
  notificationState.pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && isSignedIn()) loadNotifications();
  }, NOTIFICATION_POLL_MS);
}

function stopNotificationPolling() {
  window.clearInterval(notificationState.pollTimer);
  notificationState.pollTimer = null;
  applyNotifications({ notifications: [], unreadCount: 0 });
}

async function loadNotifications() {
  if (!window.FFG_CONTENT_API?.enabled || !isSignedIn() || notificationState.loading) return;
  notificationState.loading = true;
  try {
    applyNotifications(await window.FFG_CONTENT_API.listNotifications());
  } catch (error) {
    console.warn('Notifications could not be refreshed.', error);
  } finally {
    notificationState.loading = false;
  }
}

function applyNotifications({ notifications, unreadCount }) {
  notificationState.items = [...notifications];
  notificationState.unreadCount = unreadCount;
  renderNotifications();
}

function getNotificationText(notification) {
  const useChinese = tagUiState.language === 'zh';
  const title = notification.storyTitle;
  const subject = {
    story: useChinese ? `你的故事《${title}》` : `Your story “${title}”`,
    comment: useChinese ? `你对《${title}》的回应` : `Your response to “${title}”`,
    follow_up: useChinese ? `你在《${title}》下的后续` : `Your follow-up to “${title}”`
  }[notification.contentType] || title;
  if (['report-actioned', 'report-dismissed'].includes(notification.kind)) {
    const reported = {
      story: useChinese ? `故事《${title}》` : `the story “${title}”`,
      comment: useChinese ? `《${title}》下的一条回应` : `a response to “${title}”`,
      follow_up: useChinese ? `《${title}》下的一条后续` : `a follow-up to “${title}”`
    }[notification.contentType];
    return notification.kind === 'report-actioned'
      ? (useChinese ? `你举报的${reported}已被移除。感谢你帮助维护社区。` : `You reported ${reported}; it has been removed. Thank you.`)
      : (useChinese ? `你举报的${reported}经复查后未发现违反社区规范，已保留。` : `You reported ${reported}; a reviewer found no rule was broken, so it stays.`);
  }
  const outcomes = {
    'safety-hold': ['暂时没有公开。我们想先确认你一切安好，请查看“我的账户”里的说明。', 'is not public for now. We want to check that you are okay first; see My account.'],
    removed: ['因被举报，经审核员复查后已从公开页面移除。可以在下方查看理由，或提交申诉。', 'was removed from public pages after a report. See the reason below, or appeal.'],
    approved: ['已通过审核并公开。', 'was approved and is now public.'],
    rejected: ['未通过审核。可以在下方查看审核说明，或提交申诉。', 'was not approved. See the review note below, or appeal.'],
    'appeal-overturned': ['申诉成功，原决定已撤销，内容已公开。', 'was published after your appeal was accepted.'],
    'appeal-upheld': ['的申诉经复核后维持原决定。', 'stays unpublished: the appeal upheld the original decision.']
  };
  const [zh, en] = outcomes[notification.kind] || ['有新的审核结果。', 'has a new review result.'];
  return useChinese ? `${subject}${zh}` : `${subject} ${en}`;
}

function renderNotifications() {
  const badge = document.getElementById('nav-notification-badge');
  const panel = document.getElementById('notifications-panel');
  const useChinese = tagUiState.language === 'zh';
  const unread = notificationState.unreadCount;

  if (badge) {
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.setAttribute('aria-label', useChinese ? `${unread} 条未读通知` : `${unread} unread notifications`);
  }
  if (!panel) return;

  panel.hidden = notificationState.items.length === 0;
  if (panel.hidden) {
    panel.replaceChildren();
    return;
  }
  panel.innerHTML = `
    <div class="notifications-heading">
      <div>
        <span class="account-eyebrow">${useChinese ? '仅你可见' : 'Only visible to you'}</span>
        <h2>${useChinese ? '审核通知' : 'Review notifications'}${unread ? ` <span class="notification-count">${unread}</span>` : ''}</h2>
      </div>
      ${unread ? `<button type="button" class="btn btn-ghost btn-sm" data-notification-action="read-all">${useChinese ? '全部标为已读' : 'Mark all as read'}</button>` : ''}
    </div>
    <ul class="notification-list">
      ${notificationState.items.map((notification) => `
        <li class="notification-item${notification.readAt ? '' : ' is-unread'}">
          <p>${escapeHtml(getNotificationText(notification))}</p>
          <small>${escapeHtml(formatOwnedStoryDate(notification.createdAt))}</small>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderAppealOutcome(item) {
  if (!item.appealStatus) return '';
  const useChinese = tagUiState.language === 'zh';
  const headings = {
    pending: ['申诉已提交，等待审核员复核', 'Appeal submitted and awaiting review'],
    overturned: ['申诉成功：原决定已撤销，内容已公开', 'Appeal accepted: the decision was reversed and the content is public'],
    upheld: ['复核后维持原决定', 'The original decision was upheld after review']
  };
  const [zh, en] = headings[item.appealStatus] || headings.pending;
  return `
    <div class="review-reason appeal-outcome appeal-outcome--${escapeHtml(item.appealStatus)}">
      <strong>${useChinese ? zh : en}</strong>
      ${item.appealDecisionReason ? `<p>${escapeHtml(item.appealDecisionReason)}</p>` : ''}
      ${item.appealDecidedAt ? `<small>${escapeHtml(formatOwnedStoryDate(item.appealDecidedAt))}</small>` : ''}
    </div>
  `;
}

function ownerControlKey(contentType, id) {
  return `${contentType}:${id}`;
}

function resetOwnerControls() {
  ownerControlState.confirmingWithdrawKey = null;
  ownerControlState.appealingKey = null;
  ownerControlState.busyKey = null;
  ownerControlState.messageKey = null;
  ownerControlState.message = '';
}

function getWithdrawWarning(moderationStatus) {
  const useChinese = tagUiState.language === 'zh';
  if (moderationStatus === 'approved') {
    return useChinese
      ? '撤下后，这条内容会立即从公开页面消失，且无法恢复。确定撤下吗？'
      : 'It will disappear from public pages immediately and cannot be restored. Withdraw it?';
  }
  if (moderationStatus === 'pending-human-review') {
    return useChinese
      ? '撤回后它不会再进入审核，且无法恢复。确定撤回吗？'
      : 'It will leave the review queue and cannot be restored. Withdraw it?';
  }
  return useChinese ? '撤回后无法恢复。确定撤回吗？' : 'This cannot be undone. Withdraw it?';
}

function renderOwnerControls(contentType, item) {
  const useChinese = tagUiState.language === 'zh';
  const key = ownerControlKey(contentType, item.id);
  const busy = ownerControlState.busyKey === key;
  const dataAttributes = `data-content-type="${escapeHtml(contentType)}" data-content-id="${escapeHtml(item.id)}"`;
  const message = ownerControlState.messageKey === key
    ? `<p class="owner-control-status" role="status" aria-live="polite" tabindex="-1">${escapeHtml(ownerControlState.message)}</p>`
    : '';

  if (ownerControlState.confirmingWithdrawKey === key) {
    return `
      <div class="owner-controls is-confirming">
        <p>${escapeHtml(getWithdrawWarning(item.moderationStatus))}</p>
        <div class="owner-control-actions">
          <button type="button" class="btn btn-reject btn-sm" data-owner-action="confirm-withdraw" ${dataAttributes} ${busy ? 'disabled' : ''}>${useChinese ? '确认撤回' : 'Withdraw'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-owner-action="cancel" ${busy ? 'disabled' : ''}>${useChinese ? '取消' : 'Cancel'}</button>
        </div>
        ${message}
      </div>
    `;
  }

  if (ownerControlState.appealingKey === key) {
    const reasonId = `appeal-reason-${key.replace(/[^A-Za-z0-9-]/g, '-')}`;
    const explanationId = `${reasonId}-explanation`;
    return `
      <form class="owner-controls appeal-form" data-appeal-form ${dataAttributes}>
        <p>${useChinese
          ? '每个审核决定只能申诉一次。申诉会交给审核员复核，他们会看到你的理由和原来的审核说明。'
          : 'Each review decision can be appealed once. A reviewer will read your reason alongside the original decision.'}</p>
        <label for="${reasonId}">${useChinese ? '申诉理由' : 'Reason for appeal'}</label>
        <select id="${reasonId}" name="appeal-reason" required>
          <option value="">${useChinese ? '请选择' : 'Choose one'}</option>
          ${APPEAL_REASON_OPTIONS.map((option) => `<option value="${option.value}">${escapeHtml(useChinese ? option.zh : option.en)}</option>`).join('')}
        </select>
        <label for="${explanationId}">${useChinese ? '补充说明（10–1000个字符）' : 'Explanation (10–1,000 characters)'}</label>
        <textarea id="${explanationId}" name="appeal-explanation" rows="3" minlength="10" maxlength="1000" required></textarea>
        <div class="owner-control-actions">
          <button type="submit" class="btn btn-primary btn-sm" ${busy ? 'disabled' : ''}>${useChinese ? '提交申诉' : 'Submit appeal'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-owner-action="cancel" ${busy ? 'disabled' : ''}>${useChinese ? '取消' : 'Cancel'}</button>
        </div>
        ${message}
      </form>
    `;
  }

  if (item.moderationStatus === 'withdrawn') return message;
  const canAppeal = item.moderationStatus === 'rejected' && !item.appealStatus;
  return `
    <div class="owner-controls">
      <div class="owner-control-actions">
        ${canAppeal ? `<button type="button" class="btn btn-secondary btn-sm" data-owner-action="appeal" ${dataAttributes}>${useChinese ? '申诉' : 'Appeal'}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-owner-action="withdraw" ${dataAttributes}>${useChinese ? '撤回' : 'Withdraw'}</button>
      </div>
      ${message}
    </div>
  `;
}

function handleOwnerAction(button) {
  const action = button.dataset.ownerAction;
  const key = ownerControlKey(button.dataset.contentType, button.dataset.contentId);
  if (action === 'confirm-withdraw') {
    withdrawOwnedContent(button.dataset.contentType, button.dataset.contentId);
    return;
  }

  resetOwnerControls();
  if (action === 'withdraw') ownerControlState.confirmingWithdrawKey = key;
  if (action === 'appeal') ownerControlState.appealingKey = key;
  renderMyStories();
  document.querySelector(
    '.owner-controls.is-confirming [data-owner-action="confirm-withdraw"], .appeal-form select'
  )?.focus();
}

async function withdrawOwnedContent(contentType, contentId) {
  const key = ownerControlKey(contentType, contentId);
  ownerControlState.busyKey = key;
  renderMyStories();
  try {
    await window.FFG_CONTENT_API.withdrawContent(contentType, contentId);
    resetOwnerControls();
    ownerControlState.messageKey = key;
    ownerControlState.message = tagUiState.language === 'zh'
      ? '已撤回。它不会再公开，也不会进入审核。'
      : 'Withdrawn. It will not be public or reviewed.';
    await Promise.allSettled([loadMyStories(), loadPublishedStories()]);
  } catch (error) {
    ownerControlState.busyKey = null;
    ownerControlState.messageKey = key;
    ownerControlState.message = getResponseErrorMessage(error.code);
    renderMyStories();
  }
  document.querySelector('.owner-control-status')?.focus();
}

async function submitAppeal(form) {
  const { contentType, contentId } = form.dataset;
  const key = ownerControlKey(contentType, contentId);
  const reasonCode = form.querySelector('[name="appeal-reason"]').value;
  const explanation = form.querySelector('[name="appeal-explanation"]').value.trim();
  if (!reasonCode || explanation.length < 10 || explanation.length > 1000) {
    form.reportValidity();
    return;
  }

  ownerControlState.busyKey = key;
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    await window.FFG_CONTENT_API.appealContent(contentType, contentId, { reasonCode, explanation });
    resetOwnerControls();
    ownerControlState.messageKey = key;
    ownerControlState.message = tagUiState.language === 'zh'
      ? '申诉已提交，审核员复核后结果会显示在这里。'
      : 'Appeal submitted. The outcome will appear here after review.';
    await loadMyStories();
  } catch (error) {
    ownerControlState.busyKey = null;
    form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    let status = form.querySelector('.owner-control-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'owner-control-status';
      status.setAttribute('role', 'status');
      status.tabIndex = -1;
      form.append(status);
    }
    status.textContent = getResponseErrorMessage(error.code);
  }
  document.querySelector('.owner-control-status')?.focus();
}

function renderOwnedFollowUps(followUps) {
  if (!followUps?.length) return '';
  const useChinese = tagUiState.language === 'zh';
  return `
    <div class="owned-follow-ups">
      <strong>${useChinese ? '我的后续' : 'My follow-ups'}</strong>
      ${followUps.map((followUp) => {
        const status = getFollowUpStatus(followUp.status);
        return `
          <article class="owned-follow-up">
            <div class="owned-follow-up-heading">
              <span>${escapeHtml(useChinese ? status.labelZh : status.label)}</span>
              <span class="review-status review-status--${escapeHtml(followUp.moderationStatus)}">${escapeHtml(getReviewStatusLabel(followUp.moderationStatus))}</span>
            </div>
            ${followUp.content ? `<p>${escapeHtml(truncateText(followUp.content, 200))}</p>` : ''}
            <small>${escapeHtml(formatOwnedStoryDate(followUp.createdAt))}</small>
            ${followUp.careSuggested ? renderCarePanel() : ''}
            ${renderReviewNote(followUp)}
            ${renderAppealOutcome(followUp)}
            ${renderOwnerControls('follow_up', followUp)}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderMyComments(signedIn) {
  const container = document.getElementById('my-comments');
  if (!container) return;

  container.hidden = !signedIn
    || myStoriesState.loading
    || Boolean(myStoriesState.errorCode)
    || myStoriesState.comments.length === 0;
  if (container.hidden) {
    container.replaceChildren();
    return;
  }

  const useChinese = tagUiState.language === 'zh';
  container.innerHTML = `
    <h3>${useChinese ? '我的回应' : 'My responses'}</h3>
    ${myStoriesState.comments.map((comment) => `
      <article class="my-comment-item">
        <div class="my-story-heading">
          <div>
            <span class="comment-type">${escapeHtml(formatCommentType(comment.responseType))}</span>
            <p class="my-comment-story">${useChinese ? '回应：' : 'On: '}${escapeHtml(comment.storyTitle)}</p>
          </div>
          <span class="review-status review-status--${escapeHtml(comment.moderationStatus)}">${escapeHtml(getReviewStatusLabel(comment.moderationStatus))}</span>
        </div>
        <p class="my-story-excerpt">${escapeHtml(truncateText(comment.content, 260))}</p>
        <small>${escapeHtml(formatOwnedStoryDate(comment.createdAt))}</small>
        ${comment.careSuggested ? renderCarePanel() : ''}
        ${renderReviewNote(comment)}
        ${renderAppealOutcome(comment)}
        ${renderOwnerControls('comment', comment)}
      </article>
    `).join('')}
  `;
}

function renderMyStories(authState = window.FFG_AUTH?.getSnapshot()) {
  const locked = document.getElementById('my-stories-locked');
  const empty = document.getElementById('my-stories-empty');
  const loading = document.getElementById('my-stories-loading');
  const error = document.getElementById('my-stories-error');
  const list = document.getElementById('my-stories-list');
  if (!locked || !empty || !loading || !error || !list || !window.FFG_AUTH) return;

  const signedIn = authState?.status === window.FFG_AUTH.STATUS.AUTHENTICATED;
  locked.hidden = signedIn;
  loading.hidden = !signedIn || !myStoriesState.loading;
  error.hidden = !signedIn || myStoriesState.loading || !myStoriesState.errorCode;
  empty.hidden = !signedIn
    || myStoriesState.loading
    || Boolean(myStoriesState.errorCode)
    || myStoriesState.stories.length > 0;
  list.hidden = !signedIn
    || myStoriesState.loading
    || Boolean(myStoriesState.errorCode)
    || myStoriesState.stories.length === 0;

  const useChinese = tagUiState.language === 'zh';
  loading.querySelector('h3').textContent = useChinese ? '正在加载你的故事……' : 'Loading your stories...';
  loading.querySelector('p').textContent = useChinese ? '正在刷新你的私密工作区。' : 'Your private workspace is being refreshed.';
  error.querySelector('h3').textContent = useChinese ? '暂时无法加载你的故事' : 'Could not load your stories';
  error.querySelector('p').textContent = useChinese
    ? '你的公开匿名状态不受影响，请稍后重试。'
    : 'Your public identity is not affected. Please try again.';
  error.querySelector('button').textContent = useChinese ? '重试' : 'Try again';
  renderMyComments(signedIn);

  if (list.hidden) {
    list.replaceChildren();
    return;
  }

  list.innerHTML = myStoriesState.stories.map((story) => {
    const statusLabel = getReviewStatusLabel(story.moderationStatus);
    const moderationNote = story.moderationStatus === 'pending-human-review'
      ? story.automatedReviewStatus === 'not-configured'
        ? (useChinese
          ? 'AI 安全筛查尚未接入；内容只有在人工审核通过后才会公开。'
          : 'AI safety screening is not connected yet. The story stays private until a human approves it.')
        : (useChinese
          ? '自动安全检查已经记录结果，内容仍需人工审核通过后才会公开。'
          : 'The automated safety result is recorded, but a human must still approve publication.')
      : story.moderationStatus === 'approved'
        ? (useChinese
          ? '人工审核已经完成，故事已匿名进入公开归档。'
          : 'Human review is complete and the story is now in the anonymous public archive.')
        : story.moderationStatus === 'rejected'
          ? (useChinese
            ? '人工审核已经完成，这篇故事目前不会公开。'
            : 'Human review is complete and this story is not public.')
          : story.moderationStatus === 'safety-hold'
            ? (useChinese
              ? '审核员暂时没有公开这篇故事。这不是因为你写错了什么——我们想先确认你现在一切安好。你可以随时撤回它。'
              : 'A reviewer has not published this story for now. You did nothing wrong; we want to check that you are okay first. You can withdraw it at any time.')
          : story.moderationStatus === 'withdrawn'
            ? (useChinese
              ? '你已撤回这篇故事，它不会再公开或进入审核。'
              : 'You withdrew this story. It will not be published or reviewed.')
            : (useChinese ? '这里显示的是与你的私密账户关联的审核记录。' : 'This review record is linked only to your private account.');

    return `
      <article class="my-story-item">
        <div class="my-story-heading">
          <div>
            <span class="story-board">${escapeHtml(formatBoardName(story.board))}</span>
            <h3>${escapeHtml(story.title)}</h3>
          </div>
          <span class="review-status review-status--${escapeHtml(story.moderationStatus)}">${escapeHtml(statusLabel)}</span>
        </div>
        <p class="my-story-excerpt">${escapeHtml(truncateText(story.content, 260))}</p>
        <div class="story-tags">
          ${story.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
        </div>
        <dl class="my-story-meta">
          <div><dt>${useChinese ? '回应偏好' : 'Response preference'}</dt><dd>${escapeHtml(formatCommentType(story.responsePreference))}</dd></div>
          <div><dt>${useChinese ? '提交时间' : 'Submitted'}</dt><dd>${escapeHtml(formatOwnedStoryDate(story.createdAt))}</dd></div>
        </dl>
        <p class="moderation-note">${escapeHtml(moderationNote)}</p>
        ${renderOwnerStats(story)}
        ${story.careSuggested ? renderCarePanel() : ''}
        ${renderReviewNote(story)}
        ${renderAppealOutcome(story)}
        ${renderOwnerControls('story', story)}
        ${renderOwnedFollowUps(story.followUps)}
      </article>
    `;
  }).join('');
}

function loadPolicies() {
  window.FFG_POLICIES_READY = fetch('policies.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  window.FFG_POLICIES_READY.then((policies) => {
    policyState.policies = policies;
    renderPolicyPages();
    syncConsentUI();
  });
}

function localised(text) {
  return text?.[tagUiState.language === 'zh' ? 'zh' : 'en'] || '';
}

function renderPolicyPages() {
  [['community', 'policy-community'], ['privacy', 'policy-privacy']].forEach(([name, elementId]) => {
    const container = document.getElementById(elementId);
    const policy = policyState.policies?.[name];
    if (!container || !policy) return;
    const useChinese = tagUiState.language === 'zh';
    container.innerHTML = `
      <header class="policy-header">
        <span class="prototype-badge">${escapeHtml(`${useChinese ? '版本' : 'Version'} ${policy.version}`)}</span>
        <h1>${escapeHtml(localised(policy.title))}</h1>
        <p>${escapeHtml(localised(policy.intro))}</p>
        ${policy.status === 'draft' ? `
          <p class="policy-draft">${useChinese
            ? '草案：正式试点前将由团队审阅；标有【待团队补充】的内容尚未确定。'
            : 'Draft: the team will review this before the pilot. Items marked "To be completed by the team" are not settled yet.'}</p>
        ` : ''}
      </header>
      ${policy.summary ? `
        <section class="policy-summary">
          <h2>${useChinese ? '动笔之前' : 'Before you write'}</h2>
          <ul>${policy.summary.map((item) => `<li>${escapeHtml(localised(item))}</li>`).join('')}</ul>
        </section>
      ` : ''}
      ${policy.sections.map((section) => `
        <section>
          <h2>${escapeHtml(localised(section.heading))}</h2>
          <ul>${section.items.map((item) => `<li>${escapeHtml(localised(item))}</li>`).join('')}</ul>
        </section>
      `).join('')}
    `;
  });
}

// Writers confirm the current community rules once per version, and signed-in
// people re-agree to a changed privacy notice. Both are recorded on the server.
function syncConsentUI(authState = window.FFG_AUTH?.getSnapshot()) {
  const gate = document.getElementById('community-gate');
  const form = document.getElementById('submit-form');
  const privacyUpdate = document.getElementById('privacy-update');
  const policies = policyState.policies;
  const signedIn = authState?.status === window.FFG_AUTH?.STATUS.AUTHENTICATED;
  const consents = authState?.account?.consents;
  const serverMode = Boolean(window.FFG_CONTENT_API?.enabled);
  const useChinese = tagUiState.language === 'zh';

  const needsGate = Boolean(serverMode && signedIn && policies && consents && !consents.community.accepted);
  // The older static notice repeats the gate's heading, so only one is shown.
  const staticNotice = document.querySelector('#page-submit .safety-note');
  if (staticNotice) staticNotice.hidden = needsGate;
  if (gate && form) {
    gate.hidden = !needsGate;
    if (needsGate) {
      form.hidden = true;
      form.dataset.gated = 'true';
      gate.innerHTML = `
        <h2 id="community-gate-title">${useChinese ? '动笔之前' : 'Before you write'}</h2>
        <p>${useChinese
          ? `开始写之前，请先读一读这几条（社区规则 ${escapeHtml(policies.community.version)} 版）。规则有重要变化时，我们会请你再确认一次。`
          : `Before you start, please read these points (community rules, version ${escapeHtml(policies.community.version)}). If the rules change materially, we will ask again.`}</p>
        <ul>${policies.community.summary.map((item) => `<li>${escapeHtml(localised(item))}</li>`).join('')}</ul>
        <p><a href="#" data-page="rules">${useChinese ? '阅读完整的社区规则' : 'Read the full community rules'}</a></p>
        <label class="consent-check">
          <input type="checkbox" id="community-consent">
          <span>${useChinese ? '我已阅读并知晓' : 'I have read and understand these points'}</span>
        </label>
        <button type="button" class="btn btn-primary" data-consent-action="community">${useChinese ? '开始写故事' : 'Start writing'}</button>
        <p class="report-error" id="community-gate-status" role="status" aria-live="polite"></p>
      `;
    } else if (form.dataset.gated === 'true') {
      form.hidden = false;
      delete form.dataset.gated;
    }
  }

  const needsPrivacy = Boolean(serverMode && signedIn && policies && consents && !consents.privacy.accepted);
  if (privacyUpdate) {
    privacyUpdate.hidden = !needsPrivacy;
    privacyUpdate.innerHTML = needsPrivacy ? `
      <span class="account-eyebrow">${useChinese ? '需要你确认' : 'Your confirmation is needed'}</span>
      <h2>${useChinese ? '请阅读最新的隐私说明' : 'Please read the current privacy notice'}</h2>
      <p>${useChinese
        ? `隐私说明（${escapeHtml(policies.privacy.version)} 版）有更新，或你还没有确认过。`
        : `The privacy notice (version ${escapeHtml(policies.privacy.version)}) has changed, or you have not agreed to it yet.`}
        <a href="#" data-page="privacy">${useChinese ? '阅读隐私说明' : 'Read the privacy notice'}</a></p>
      <button type="button" class="btn btn-primary" data-consent-action="privacy">${useChinese ? '我已阅读并同意' : 'I have read and agree'}</button>
      <p class="report-error" id="privacy-update-status" role="status" aria-live="polite"></p>
    ` : '';
  }
}

async function acceptPolicyFromPage(policy) {
  const version = policyState.policies?.[policy]?.version;
  const status = document.getElementById(policy === 'community' ? 'community-gate-status' : 'privacy-update-status');
  const useChinese = tagUiState.language === 'zh';
  if (policy === 'community' && !document.getElementById('community-consent')?.checked) {
    if (status) status.textContent = useChinese ? '请先勾选“我已阅读并知晓”。' : 'Tick the box to confirm you have read these points.';
    document.getElementById('community-consent')?.focus();
    return;
  }
  try {
    await window.FFG_CONTENT_API.acceptPolicy(policy, version);
    await window.FFG_AUTH.restoreSession();
    if (policy === 'community') document.getElementById('story-title')?.focus();
  } catch (error) {
    if (status) {
      status.textContent = error.code === 'policy-version-outdated'
        ? (useChinese ? '规则刚刚更新了，请刷新页面阅读最新版本。' : 'The rules just changed. Refresh the page to read the current version.')
        : (useChinese ? '暂时无法保存你的确认，请稍后重试。' : 'Your confirmation could not be saved. Please try again.');
    }
  }
}

function syncSubmissionModeUI(authState = window.FFG_AUTH?.getSnapshot()) {
  syncConsentUI(authState);
  const submitButton = document.getElementById('submit-story-button');
  const tagHelp = document.getElementById('story-tags-help');
  const archiveModeLabel = document.getElementById('archive-mode-label');
  const archiveModeIntro = document.getElementById('archive-mode-intro');
  const modeLabel = document.getElementById('submit-mode-label');
  const modeIntro = document.getElementById('submit-mode-intro');
  const workflowBadge = document.getElementById('submission-workflow-badge');
  const workflowNote = document.getElementById('submission-workflow-note');
  const aboutModerationBadge = document.getElementById('about-moderation-badge');
  const aboutModerationCopy = document.getElementById('about-moderation-copy');
  const moderationModeBadge = document.getElementById('moderation-mode-badge');
  const accountModeBadge = document.getElementById('account-mode-badge');
  const serverMode = Boolean(window.FFG_CONTENT_API?.enabled);
  const signedIn = authState?.status === window.FFG_AUTH?.STATUS.AUTHENTICATED;
  const useChinese = tagUiState.language === 'zh';

  if (archiveModeLabel) {
    archiveModeLabel.textContent = serverMode
      ? (useChinese ? 'V0.2 · 匿名故事归档' : 'V0.2 · Anonymous story archive')
      : (useChinese ? '浏览器原型' : 'Browser prototype');
  }
  if (archiveModeIntro) {
    archiveModeIntro.textContent = serverMode
      ? (useChinese
        ? '这里展示匿名示例故事和已经人工审核通过的投稿；待审核与未通过内容不会公开。'
        : 'This archive contains anonymous sample stories and submissions approved by a human reviewer. Pending and rejected content stays private.')
      : (useChinese
        ? '当前静态版本展示匿名示例故事和保存在本浏览器中的原型投稿。'
        : 'This static version shows anonymous sample stories and prototype submissions stored in this browser.');
  }
  if (modeLabel) {
    modeLabel.textContent = serverMode
      ? (useChinese ? 'V0.2 · 内容归属' : 'V0.2 · Content ownership')
      : (useChinese ? '浏览器原型' : 'Browser prototype');
  }
  if (modeIntro) {
    modeIntro.textContent = serverMode
      ? (useChinese
        ? '登录后，投稿会保存到私密服务并与你的账户关联；公开页面仍只显示匿名作者。'
        : 'After sign-in, submissions are stored privately and linked to your account; public pages still show only an anonymous author.')
      : (useChinese
        ? '静态预览不会传输故事；路演投稿只保存在当前浏览器中。'
        : 'This static preview does not transmit stories. Roadshow submissions stay only in this browser.');
  }
  if (workflowBadge) {
    workflowBadge.textContent = serverMode
      ? (useChinese ? '当前审核流程' : 'Current review workflow')
      : (useChinese ? '计划中的正式流程' : 'Planned live workflow');
  }
  if (workflowNote) {
    workflowNote.textContent = serverMode
      ? (useChinese
        ? '投稿会进入受权限保护的人工审核队列，不会即时公开。AI 安全筛查与审核通知邮件尚未接入。'
        : 'Submissions enter a role-protected human review queue and are not published immediately. AI safety screening and review-notification email are not connected yet.')
      : (useChinese
        ? '正式版本将先进行匿名化与内容审核，再决定是否公开，并提供撤回与申诉控制。'
        : 'The live service will review and anonymise submissions before publication, with withdrawal and appeal controls.');
  }
  if (submitButton && submitButton.dataset.busy !== 'true') {
    submitButton.textContent = serverMode
      ? signedIn
        ? (useChinese ? '提交审核' : 'Submit for review')
        : (useChinese ? '登录后投稿' : 'Sign in to submit')
      : (useChinese ? '保存到当前浏览器' : 'Add to this browser demo');
  }
  if (tagHelp) {
    tagHelp.textContent = serverMode
      ? (useChinese
        ? '选择主题板块后可添加最多3个标签；标签会随投稿一起进入审核。'
        : 'Choose a board, then add up to three tags. Tags are included with the review submission.')
      : (useChinese
        ? '选择主题板块后可添加最多3个标签；内容只保存在当前浏览器。'
        : 'Choose a board, then add up to three tags. This browser-only demo stores them locally.');
  }
  if (aboutModerationBadge) {
    aboutModerationBadge.textContent = serverMode
      ? (useChinese ? 'V0.2 · 人工审核已连接' : 'V0.2 · Human review connected')
      : (useChinese ? 'V0.2 · 开发中' : 'V0.2 · In development');
  }
  if (aboutModerationCopy) {
    aboutModerationCopy.textContent = serverMode
      ? (useChinese
        ? '新投稿会保持私密，只有经过授权的人工审核员批准后才会匿名公开。AI 预筛查和审核通知邮件尚未接入。'
        : 'New submissions stay private until an authorised human reviewer approves anonymous publication. AI pre-screening and review-notification email are not connected yet.')
      : (useChinese
        ? '当前静态页面未连接审核服务。V0.2 本地服务已经实现人工审核基础；AI 预筛查和审核通知邮件尚未接入。'
        : 'This static page is not connected to the review service. The V0.2 local service includes the human-review foundation; AI pre-screening and review-notification email are not connected yet.');
  }
  if (moderationModeBadge) {
    moderationModeBadge.textContent = serverMode
      ? (useChinese ? 'V0.2 · 人工审核已连接' : 'V0.2 · Human review connected')
      : (useChinese ? 'V0.2 · 审核界面预览' : 'V0.2 · Review interface preview');
  }
  if (accountModeBadge) {
    accountModeBadge.textContent = serverMode
      ? (useChinese ? 'V0.2 · 私密账户已连接' : 'V0.2 · Private account connected')
      : (useChinese ? 'V0.2 · 账户界面预览' : 'V0.2 · Account interface preview');
  }
}

function setSubmissionBusy(isBusy) {
  const submitButton = document.getElementById('submit-story-button');
  if (!submitButton) return;
  submitButton.disabled = isBusy;
  submitButton.dataset.busy = String(isBusy);
  if (isBusy) {
    submitButton.textContent = tagUiState.language === 'zh' ? '正在提交……' : 'Submitting...';
  } else {
    syncSubmissionModeUI();
  }
}

function getSubmissionErrorMessage(error) {
  const useChinese = tagUiState.language === 'zh';
  const messages = {
    'story-rate-limited': {
      zh: '你最近投稿较多，请过一会儿再提交。你已经填写的内容不会被清空。',
      en: 'You have submitted several stories recently. Please try again later; your draft will stay on this page.'
    },
    'too-many-pending-stories': {
      zh: '你还有几篇故事在等待审核，请等审核结果出来后再提交。你已经填写的内容不会被清空。',
      en: 'Several of your stories are still awaiting review. Please wait for decisions; your draft will stay on this page.'
    },
    'community-consent-required': {
      zh: '社区规则已更新，请先阅读并确认“动笔之前”的内容。你已经填写的内容不会被清空。',
      en: 'The community rules have changed. Please confirm "Before you write" first; your draft will stay on this page.'
    },
    'authentication-required': {
      zh: '请先登录私密账户，再提交故事。你已经填写的内容不会被清空。',
      en: 'Sign in to your private account before submitting. Your draft will stay on this page.'
    },
    'invalid-story-length': {
      zh: '故事正文需包含150–200个英文单词与中日韩字符计数单位。',
      en: 'The story must contain 150–200 English words and CJK character units.'
    },
    'invalid-tags': {
      zh: '请选择不超过3个有效标签。',
      en: 'Choose no more than three valid tags.'
    },
    'network-error': {
      zh: '暂时无法连接投稿服务，请检查网络后重试。',
      en: 'The submission service could not be reached. Check your connection and try again.'
    }
  };
  return messages[error?.code]?.[useChinese ? 'zh' : 'en']
    || (useChinese ? '投稿暂时没有完成，请稍后重试。' : 'The submission could not be completed. Please try again.');
}

function showSubmissionSuccess({ mode, persisted = false, careSuggested = false }) {
  const care = document.getElementById('submit-care');
  if (care) {
    care.hidden = !careSuggested;
    care.innerHTML = careSuggested ? renderCarePanel() : '';
  }
  const form = document.getElementById('submit-form');
  const success = document.getElementById('submit-success');
  const badge = document.getElementById('submit-success-badge');
  const title = document.getElementById('submit-success-title');
  const lead = document.getElementById('submit-success-lead');
  const summary = document.getElementById('submit-success-summary');
  const viewButton = document.getElementById('view-submitted-story');
  const resetDemoButton = document.getElementById('reset-demo-stories');
  const useChinese = tagUiState.language === 'zh';

  if (mode === 'server') {
    badge.textContent = useChinese ? '已接收 · 待人工审核' : 'Received · Pending human review';
    title.textContent = useChinese ? '投稿已进入私密审核队列' : 'Your story is in the private review queue';
    lead.textContent = useChinese
      ? '故事已与当前私密账户关联，但尚未公开。'
      : 'The story is linked to your private account, but it is not public.';
    summary.textContent = useChinese
      ? 'AI 安全筛查尚未接入。故事已进入受权限保护的人工审核队列；只有人工批准后，故事才会匿名发布。'
      : 'AI safety screening is not connected yet. The story is in a role-protected human review queue; only a human approval can publish it anonymously.';
    viewButton.dataset.page = 'account';
    viewButton.textContent = useChinese ? '查看我的故事' : 'View my stories';
    resetDemoButton.hidden = true;
  } else {
    badge.textContent = useChinese ? '本地原型预览' : 'Local prototype preview';
    title.textContent = useChinese ? '故事已保存到当前版本' : 'Story added to this browser demo';
    lead.textContent = persisted
      ? (useChinese ? '内容只保存在当前浏览器，没有发送到服务器。' : 'Saved only in this browser; nothing was sent to a server.')
      : (useChinese ? '浏览器存储不可用，这篇故事只存在于当前页面会话。' : 'Browser storage was unavailable, so this story exists only in this page session.');
    summary.textContent = useChinese
      ? '你可以检查故事、标签和归档筛选效果；这不是正式审核决定。'
      : 'You can check the story, tags, and Archive filtering. This is not a moderation decision.';
    viewButton.dataset.page = 'archive';
    viewButton.textContent = useChinese ? '在故事归档中查看' : 'View in Story Archive';
    resetDemoButton.hidden = false;
  }

  form.hidden = true;
  success.hidden = false;
  success.focus();
}

function initSubmitForm() {
  const form = document.getElementById('submit-form');
  const boardSelect = document.getElementById('story-board');
  const storyTitle = document.getElementById('story-title');
  const storyText = document.getElementById('story-text');
  const tagContainer = document.getElementById('tag-checkboxes');
  const resetButton = document.getElementById('reset-prototype-form');
  const resetDemoButton = document.getElementById('reset-demo-stories');
  const viewSubmittedButton = document.getElementById('view-submitted-story');

  boardSelect?.addEventListener('change', () => {
    const nextBoard = boardSelect.value;
    const allowedTags = new Set(getAllowedSubmissionTags(nextBoard));
    submitTagState.selected = new Set(
      [...submitTagState.selected].filter((tag) => allowedTags.has(tag))
    );
    submitTagState.board = nextBoard;
    renderSubmissionTags(nextBoard);
  });

  tagContainer?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-submit-tag]');
    if (!button || button.disabled) return;

    const tag = button.dataset.submitTag;
    if (submitTagState.selected.has(tag)) {
      submitTagState.selected.delete(tag);
    } else if (submitTagState.selected.size < SUBMISSION_TAG_LIMIT) {
      submitTagState.selected.add(tag);
    }
    syncSubmissionTagUI();
  });

  storyText?.addEventListener('input', updateStoryCount);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const count = countStoryUnits(storyText?.value || '');
    const formError = document.getElementById('form-error');
    if (count.total < STORY_UNIT_MIN || count.total > STORY_UNIT_MAX) {
      if (formError) {
        formError.hidden = false;
        formError.textContent = tagUiState.language === 'zh'
          ? `当前故事共有 ${count.total} 个计数单位，请将英文单词与中日韩字符总数控制在 ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} 之间。`
          : `Your story has ${count.total} counted units. Please use ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} English words and CJK characters in total.`;
      }
      storyText?.focus();
      return;
    }

    if (!form?.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (formError) {
      formError.hidden = true;
      formError.textContent = '';
    }

    const serverMode = Boolean(window.FFG_CONTENT_API?.enabled);
    if (serverMode && !window.FFG_AUTH?.can('create-story')) {
      if (formError) {
        formError.hidden = false;
        formError.textContent = getSubmissionErrorMessage({ code: 'authentication-required' });
      }
      document.querySelector('.nav-account-link')?.focus();
      return;
    }

    setSubmissionBusy(true);
    try {
      if (serverMode) {
        const formData = new FormData(form);
        const story = await window.FFG_CONTENT_API.createStory({
          title: String(formData.get('story-title') || '').trim(),
          board: String(formData.get('story-board') || ''),
          content: String(formData.get('story-text') || '').trim(),
          tags: [...submitTagState.selected],
          responsePreference: String(formData.get('comment-mode') || ''),
          guidelinesAccepted: formData.get('guidelines-accept') === 'on'
        });
        myStoriesState.requestVersion += 1;
        myStoriesState.loading = false;
        myStoriesState.stories = [
          story,
          ...myStoriesState.stories.filter((item) => item.id !== story.id)
        ];
        myStoriesState.errorCode = null;
        renderMyStories();
        if (window.FFG_AUTH.can('review-content')) {
          moderationState.loaded = false;
          loadModerationStories();
        }
        showSubmissionSuccess({ mode: 'server', careSuggested: story.careSuggested });
      } else {
        const { story, persisted } = createDemoStory(form);
        appState.lastSubmittedStoryId = story.id;
        renderArchive();
        syncDemoStoryResetButton();
        showSubmissionSuccess({ mode: 'demo', persisted });
      }
    } catch (error) {
      if (formError) {
        formError.hidden = false;
        formError.textContent = getSubmissionErrorMessage(error);
        formError.focus();
      }
      // A rules change mid-session brings the "Before you write" step back.
      if (['authentication-required', 'community-consent-required'].includes(error.code)) {
        window.FFG_AUTH.restoreSession().catch(() => {});
      }
    } finally {
      setSubmissionBusy(false);
    }
  });

  viewSubmittedButton?.addEventListener('click', () => {
    if (viewSubmittedButton.dataset.page !== 'archive') return;
    const story = findStoryById(appState.lastSubmittedStoryId);
    if (!story) return;

    filterState.board = 'all';
    filterState.tags.clear();
    filterState.commentMode = 'all';
    filterState.search = story.title.toLocaleLowerCase();
    renderArchive();
  });

  resetButton?.addEventListener('click', () => {
    resetSubmissionForm({ focus: true });
  });

  resetDemoButton?.addEventListener('click', () => {
    resetDemoStories();
    resetSubmissionForm({ focus: true });
  });

  submitTagState.board = boardSelect?.value || '';
  renderSubmissionTags(submitTagState.board);
  updateStoryCount();
  syncDemoStoryResetButton();
  syncSubmissionModeUI();
}

function resetSubmissionForm(options = {}) {
  const form = document.getElementById('submit-form');
  const success = document.getElementById('submit-success');
  const storyTitle = document.getElementById('story-title');

  form?.reset();
  if (form) form.hidden = false;
  if (success) success.hidden = true;

  submitTagState.board = '';
  submitTagState.selected.clear();
  renderSubmissionTags('');
  updateStoryCount();
  syncDemoStoryResetButton();
  if (options.focus) storyTitle?.focus();
}

function createDemoStory(form) {
  const formData = new FormData(form);
  const commentMode = String(formData.get('comment-mode') || 'none');
  const story = {
    id: `demo-story-${Date.now()}`,
    title: String(formData.get('story-title') || '').trim(),
    board: String(formData.get('story-board') || ''),
    tags: [...submitTagState.selected],
    commentMode,
    commentModeLabel: formatCommentType(commentMode),
    text: String(formData.get('story-text') || '').trim(),
    attribution: 'Anonymous demo author · 本地演示投稿',
    comments: [],
    followUps: [],
    createdAt: new Date().toISOString(),
    source: 'demo-submission'
  };

  stories.push(story);
  return { story, persisted: persistDemoStories() };
}

function getSubmissionTagGroups(board) {
  if (!board || !storyTagsByBoard[board]) return [];

  const boardLabelZh = {
    academic: '学业挫折标签',
    job: '求职挫折标签',
    social: '社会融入标签'
  }[board];

  return [
    {
      label: tagUiState.language === 'zh' ? boardLabelZh : `${formatBoardName(board)} tags`,
      tags: storyTagsByBoard[board]
    },
    {
      label: tagUiState.language === 'zh' ? '跨板块通用标签' : 'Cross-board context tags',
      tags: crossBoardTags
    }
  ].filter((group) => group.tags.length > 0);
}

function getAllowedSubmissionTags(board) {
  return getSubmissionTagGroups(board).flatMap((group) => group.tags);
}

function renderSubmissionTags(board) {
  const container = document.getElementById('tag-checkboxes');
  if (!container) return;

  if (!board) {
    const prompt = tagUiState.language === 'zh'
      ? '请选择一个主题板块以查看相关标签。'
      : 'Choose a thematic board to see relevant tags.';
    const count = tagUiState.language === 'zh' ? '已选择 0/3' : '0/3 selected';
    container.innerHTML = `
      <p class="tag-empty-prompt">${prompt}</p>
      <p class="tag-selection-status" id="story-tags-selection-status" role="status" aria-live="polite">${count}</p>
    `;
    return;
  }

  container.innerHTML = `
    ${getSubmissionTagGroups(board).map((group) => `
      <fieldset class="tag-option-group">
        <legend>${escapeHtml(group.label)}</legend>
        <div class="tag-option-list">
          ${group.tags.map((tag) => `
            <button
              type="button"
              class="submit-tag-chip"
              data-submit-tag="${escapeHtml(tag)}"
              aria-pressed="false"
              aria-describedby="story-tags-selection-status"
            >${escapeHtml(getTagLabel(tag))}</button>
          `).join('')}
        </div>
      </fieldset>
    `).join('')}
    <div class="tag-selection-footer">
      <p class="tag-selection-status" id="story-tags-selection-status" role="status" aria-live="polite"></p>
      <p class="tag-limit-note" id="story-tags-limit" role="status" aria-live="polite" hidden></p>
    </div>
  `;
  syncSubmissionTagUI();
}

function syncSubmissionTagUI() {
  const container = document.getElementById('tag-checkboxes');
  if (!container) return;

  const selectedCount = submitTagState.selected.size;
  const atLimit = selectedCount >= SUBMISSION_TAG_LIMIT;
  container.querySelectorAll('[data-submit-tag]').forEach((button) => {
    const isSelected = submitTagState.selected.has(button.dataset.submitTag);
    const isDisabled = atLimit && !isSelected;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
    button.setAttribute('aria-disabled', String(isDisabled));
    button.disabled = isDisabled;
    if (isDisabled) {
      button.title = tagUiState.language === 'zh' ? '请先取消一个已选标签' : 'Deselect a tag to choose another';
    } else {
      button.removeAttribute('title');
    }
  });

  const countStatus = document.getElementById('story-tags-selection-status');
  if (countStatus) {
    countStatus.textContent = tagUiState.language === 'zh'
      ? `已选择 ${selectedCount}/${SUBMISSION_TAG_LIMIT}`
      : `${selectedCount}/${SUBMISSION_TAG_LIMIT} selected`;
  }

  const limitNote = document.getElementById('story-tags-limit');
  if (limitNote) {
    limitNote.hidden = !atLimit;
    limitNote.textContent = tagUiState.language === 'zh'
      ? '最多可以选择3个标签。'
      : 'You can select up to 3 tags.';
  }
}

function countStoryUnits(text) {
  const englishWords = text.match(
    /\p{Script=Latin}+(?:['’\-]\p{Script=Latin}+)*/gu
  ) || [];
  const cjkCharacters = text.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  ) || [];

  return {
    englishWords: englishWords.length,
    cjkCharacters: cjkCharacters.length,
    total: englishWords.length + cjkCharacters.length
  };
}

function updateStoryCount() {
  const storyText = document.getElementById('story-text');
  const englishCount = document.getElementById('english-word-count');
  const cjkCount = document.getElementById('cjk-character-count');
  const totalCount = document.getElementById('total-unit-count');
  const status = document.getElementById('story-count-status');
  if (!storyText || !englishCount || !cjkCount || !totalCount || !status) return;

  const formError = document.getElementById('form-error');
  if (formError) {
    formError.hidden = true;
    formError.textContent = '';
  }

  const count = countStoryUnits(storyText.value);
  englishCount.textContent = String(count.englishWords);
  cjkCount.textContent = String(count.cjkCharacters);
  totalCount.textContent = String(count.total);

  status.classList.remove('is-valid', 'is-invalid');
  if (count.total === 0) {
    status.textContent = tagUiState.language === 'zh'
      ? `请输入 ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} 个计数单位。`
      : `Enter ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} counted units.`;
  } else if (count.total < STORY_UNIT_MIN) {
    status.textContent = tagUiState.language === 'zh'
      ? `还需要 ${STORY_UNIT_MIN - count.total} 个计数单位。`
      : `${STORY_UNIT_MIN - count.total} more counted units needed.`;
    status.classList.add('is-invalid');
  } else if (count.total > STORY_UNIT_MAX) {
    status.textContent = tagUiState.language === 'zh'
      ? `已超出上限 ${count.total - STORY_UNIT_MAX} 个计数单位。`
      : `${count.total - STORY_UNIT_MAX} counted units over the limit.`;
    status.classList.add('is-invalid');
  } else {
    status.textContent = tagUiState.language === 'zh' ? '已满足长度要求。' : 'Length requirement met.';
    status.classList.add('is-valid');
  }
}

function formatBoardName(board) {
  const names = tagUiState.language === 'zh'
    ? {
        academic: '学业挫折',
        job: '求职挫折',
        social: '社会融入'
      }
    : {
        academic: 'Academic Failure',
        job: 'Job Hunting',
        social: 'Social Integration'
      };
  return names[board] || board;
}

function formatCommentType(type) {
  const labels = tagUiState.language === 'zh'
    ? {
        encouragement: '鼓励与支持',
        similar: '相似经历',
        advice: '温和建议',
        none: '不接收评论'
      }
    : {
        encouragement: 'Encouragement',
        similar: 'Similar Experience',
        advice: 'Gentle Advice',
        none: 'No Comments'
      };
  return labels[type] || type;
}

function truncateText(text, maximumLength) {
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength).trim()}…`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
