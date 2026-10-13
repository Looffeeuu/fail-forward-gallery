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
  'follow-up': 'decideFollowUp'
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
  if (pageName === 'account' && isSignedIn()) loadMyStories();
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
  appState.activeStoryId = storyId;
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
      <span class="story-board">${formatBoardName(story.board)}</span>
      <h2 id="modal-title">${escapeHtml(story.title)}</h2>
      <p class="story-full-text">${escapeHtml(story.text)}</p>
      <p class="story-attribution">${escapeHtml(story.attribution)}</p>
      <div class="story-tags">
        ${story.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
      </div>
    </article>
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

  try {
    await window.FFG_CONTENT_API.createFollowUp(story.id, {
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
  followUpState.pendingFollowUp = { visibility };
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
          <span class="comment-type">${formatCommentType(comment.type)}</span>
          <p>${escapeHtml(comment.text)}</p>
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
    await window.FFG_CONTENT_API.createComment(story.id, { content });
    textarea.value = '';
    status.textContent = tagUiState.language === 'zh'
      ? '已提交人工审核。通过后会匿名显示在这里；你可以在“我的故事”中查看状态。'
      : 'Submitted for human review. Once approved it will appear here anonymously; you can follow the status in My stories.';
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
    if (!['approve', 'reject'].includes(decision) || !MODERATION_ACTIONS[contentType]) return;

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
    const [storyQueue, commentQueue, followUpQueue] = await Promise.all([
      window.FFG_CONTENT_API.listModerationStories(),
      window.FFG_CONTENT_API.listModerationComments(),
      window.FFG_CONTENT_API.listModerationFollowUps()
    ]);
    if (requestVersion !== moderationState.requestVersion) return;
    // Oldest first across all content types, so nothing waits behind a busy type.
    moderationState.items = [
      ...storyQueue.map((item) => ({ contentType: 'story', item })),
      ...commentQueue.map((item) => ({ contentType: 'comment', item })),
      ...followUpQueue.map((item) => ({ contentType: 'follow-up', item }))
    ].sort((first, second) => first.item.createdAt.localeCompare(second.item.createdAt));
    moderationState.loaded = true;
  } catch (error) {
    if (requestVersion !== moderationState.requestVersion) return;
    moderationState.errorCode = error.code || 'request-failed';
    moderationState.loaded = false;
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
    }
  };
  return messages[contentType][decision][useChinese ? 0 : 1];
}

function renderModerationItem({ contentType, item }) {
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
    <article class="moderation-item">
      <div class="moderation-item-heading">
        <div>
          <span class="story-board">${escapeHtml(kicker)}</span>
          <h3>${escapeHtml(heading)}</h3>
        </div>
        <span class="review-status">${useChinese ? '待人工审核' : 'Pending human review'}</span>
      </div>
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

  window.FFG_AUTH.subscribe((authState) => {
    syncSubmissionModeUI(authState);
    if (authState.status === window.FFG_AUTH.STATUS.AUTHENTICATED) {
      loadMyStories();
      return;
    }

    myStoriesState.requestVersion += 1;
    myStoriesState.loading = false;
    myStoriesState.stories = [];
    myStoriesState.comments = [];
    myStoriesState.errorCode = null;
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
            ${renderReviewNote(followUp)}
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
        ${renderReviewNote(comment)}
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
        ${renderReviewNote(story)}
        ${renderOwnedFollowUps(story.followUps)}
      </article>
    `;
  }).join('');
}

function syncSubmissionModeUI(authState = window.FFG_AUTH?.getSnapshot()) {
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

function showSubmissionSuccess({ mode, persisted = false }) {
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
        showSubmissionSuccess({ mode: 'server' });
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
      if (error.code === 'authentication-required') {
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
