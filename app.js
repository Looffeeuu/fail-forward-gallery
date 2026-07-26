'use strict';

const STORY_UNIT_MIN = 150;
const STORY_UNIT_MAX = 200;
const SUBMISSION_TAG_LIMIT = 3;
const DEMO_STORY_STORAGE_KEY = 'fail-forward-demo-stories-v1';
const DEMO_MODERATION_DELAY_MS = 900;

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
  language: 'en'
};

const appState = {
  initialised: false,
  activeStoryId: null,
  lastStoryTrigger: null,
  lastSubmittedStoryId: null,
  adviceRendered: false
};

const followUpState = {
  phase: 'idle',
  pendingFollowUp: null,
  lastPublishedId: null,
  moderationTimer: null
};

function initApp() {
  if (appState.initialised) return;

  appState.initialised = true;
  loadDemoStories();
  initNavigation();
  initTagLanguage();
  initArchive();
  initSubmitForm();
  initModal();
  showPage('home');
}

function initTagLanguage() {
  document.addEventListener('click', (event) => {
    const languageButton = event.target.closest('[data-tag-language]');
    if (!languageButton) return;

    const nextLanguage = languageButton.dataset.tagLanguage;
    if (!['en', 'zh'].includes(nextLanguage) || nextLanguage === tagUiState.language) return;

    tagUiState.language = nextLanguage;
    syncTagLanguageControls();
    renderArchive();
    const board = document.getElementById('story-board')?.value || '';
    renderSubmissionTags(board);
  });

  syncTagLanguageControls();
}

function syncTagLanguageControls() {
  document.querySelectorAll('[data-tag-language]').forEach((button) => {
    const isActive = button.dataset.tagLanguage === tagUiState.language;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
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

  if (pageName === 'archive') renderArchive();
  if (pageName === 'advice') renderAdvice();

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
    const storyWord = resultCount === 1 ? 'story' : 'stories';
    const tagText = filterState.tags.size
      ? `; tags: ${[...filterState.tags].map(getTagLabel).join(', ')}`
      : '';
    summary.textContent = `${resultCount} ${storyWord} shown${tagText}.`;
  }
}

function createStoryCard(story) {
  const boardLabels = {
    academic: 'Academic Failure',
    job: 'Job Hunting',
    social: 'Social Integration'
  };
  const followUpCount = getPublishedFollowUps(story).length;

  return `
    <article class="story-card">
      <button
        type="button"
        class="story-card-button"
        data-story-id="${escapeHtml(story.id)}"
        aria-haspopup="dialog"
        aria-label="Read story: ${escapeHtml(story.title)}"
      >
        <span class="story-board">${boardLabels[story.board]}</span>
        <h2>${escapeHtml(story.title)}</h2>
        <p>${escapeHtml(truncateText(story.text, 180))}</p>
        <span class="story-tags">
          ${story.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
        </span>
        <span class="story-meta">
          <span>${escapeHtml(story.commentModeLabel)}</span>
          <span>${story.comments.length} ${story.comments.length === 1 ? 'response' : 'responses'}</span>
          ${followUpCount
            ? `<span class="story-follow-up-count">${followUpCount} ${followUpCount === 1 ? 'follow-up' : 'follow-ups'}</span>`
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
      submitFollowUpForDemo(followUpForm);
      return;
    }

    const commentForm = event.target.closest('.comment-form');
    if (!commentForm) return;

    event.preventDefault();
    const story = findStoryById(appState.activeStoryId);
    if (!story || story.commentMode === 'none') return;

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
    ${renderFollowUpInvite()}
    ${renderFollowUpTimeline(story)}
    ${renderComments(story)}
  `;
}

function renderFollowUpInvite() {
  return `
    <section class="follow-up-invite" aria-labelledby="follow-up-invite-heading">
      <div>
        <span class="prototype-badge">Prototype author view · 原作者演示视图</span>
        <h3 id="follow-up-invite-heading">Your story can continue <span lang="zh-Hans">故事仍可继续</span></h3>
        <p>Your story does not have to end here. You can return and share what happened next.</p>
        <p lang="zh-Hans">你的故事不必停留在这里，你可以回来分享后来发生了什么。</p>
      </div>
      <button type="button" class="btn btn-primary follow-up-open-button" data-followup-action="open">
        Add a Follow-up <span lang="zh-Hans">· 添加后续</span>
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

  return `
    <section class="follow-up-timeline-section" aria-labelledby="follow-up-timeline-heading">
      <div class="continuation-statement">
        <span class="continuation-mark" aria-hidden="true">↳</span>
        <div>
          <h3 id="follow-up-timeline-heading">Failure is not a fixed ending.</h3>
          <p>Stories can continue, change, or remain unresolved.</p>
          <p lang="zh-Hans">失败不是一个固定的结局。故事可能继续、发生变化，也可能暂时没有答案。</p>
        </div>
      </div>

      <div class="follow-up-timeline">
        <article class="timeline-event timeline-original">
          <span class="timeline-dot" aria-hidden="true"></span>
          <p class="timeline-kicker">ORIGINAL STORY · 原始故事</p>
          <h4>${escapeHtml(story.title)}</h4>
          <p class="timeline-date">Published 30 days ago · 发布于30天前</p>
        </article>
        ${followUps.map(renderFollowUpCard).join('')}
      </div>

      ${hasDemoFollowUp ? `
        <div class="follow-up-demo-reset">
          <button type="button" class="btn btn-ghost btn-sm" data-followup-action="reset-demo">
            Reset Demo <span lang="zh-Hans">· 重置演示</span>
          </button>
          <span>Removes only follow-ups created during this browser demo.</span>
        </div>
      ` : ''}
    </section>
  `;
}

function renderFollowUpCard(followUp) {
  const status = getFollowUpStatus(followUp.status);
  const isPrivate = followUp.visibility === 'private';

  return `
    <article
      class="timeline-event follow-up-card${isPrivate ? ' is-private' : ''}"
      id="${escapeHtml(followUp.id)}"
      tabindex="-1"
    >
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="follow-up-card-header">
        <p class="timeline-kicker">FOLLOW-UP · DAY ${followUp.day}</p>
        ${isPrivate
          ? '<span class="visibility-badge">Private author view · 仅自己可见</span>'
          : '<span class="visibility-badge">Published anonymously · 匿名公开</span>'}
      </div>
      <p class="follow-up-status">
        <span>${escapeHtml(status.label)}</span>
        <span lang="zh-Hans">${escapeHtml(status.labelZh)}</span>
      </p>
      ${followUp.text ? `
        <blockquote>
          <p>${escapeHtml(followUp.text)}</p>
          ${followUp.textZh ? `<p lang="zh-Hans">${escapeHtml(followUp.textZh)}</p>` : ''}
        </blockquote>
      ` : `
        <p class="follow-up-no-details">No additional details shared. · 未补充更多内容。</p>
      `}
      ${followUp.support ? `
        <div class="follow-up-support">
          <strong>What helped or is still needed · 帮助与仍需的支持</strong>
          <p>${escapeHtml(followUp.support)}</p>
          ${followUp.supportZh ? `<p lang="zh-Hans">${escapeHtml(followUp.supportZh)}</p>` : ''}
        </div>
      ` : ''}
      <footer>
        <span>${escapeHtml(followUp.publishedLabel || 'Published just now · Demo')}</span>
        <span>Update from the original anonymous author</span>
        <span lang="zh-Hans">来自原匿名作者的更新</span>
      </footer>
    </article>
  `;
}

function renderFollowUpForm(story) {
  const content = document.getElementById('modal-content');
  if (!content) return;

  followUpState.phase = 'composing';
  const statusOptions = FOLLOW_UP_STATUS_OPTIONS.map((option) => `
    <label class="follow-up-choice">
      <input
        type="radio"
        name="follow-up-status"
        value="${option.value}"
        required
      >
      <span>
        <strong>${escapeHtml(option.label)}</strong>
        <small lang="zh-Hans">${escapeHtml(option.labelZh)}</small>
      </span>
    </label>
  `).join('');

  content.innerHTML = `
    <div class="follow-up-form-view">
      <span class="prototype-label">Prototype follow-up · 后续更新演示</span>
      <h2 id="modal-title" tabindex="-1">How are things now? <span lang="zh-Hans">最近怎么样？</span></h2>
      <p class="follow-up-form-intro">
        Your follow-up does not need to be positive. There is no pressure to prove that things have improved.
      </p>
      <p class="follow-up-form-intro" lang="zh-Hans">
        你的后续不需要是积极的，也不需要证明情况已经变好。
      </p>
      <p class="valid-update-note">
        <strong>No change is still a valid update.</strong>
        <span lang="zh-Hans">即使没有变化，也是一种真实而有效的更新。</span>
      </p>
      <p class="follow-up-story-reference">Updating: <strong>${escapeHtml(story.title)}</strong></p>

      <form class="follow-up-form" novalidate>
        <fieldset class="follow-up-fieldset">
          <legend>How would you describe things now? <span lang="zh-Hans">你会怎样描述目前的情况？</span></legend>
          <div class="follow-up-choice-grid">${statusOptions}</div>
        </fieldset>

        <div class="form-group">
          <label for="follow-up-text">
            What has changed, if anything?
            <span class="label-zh" lang="zh-Hans">如果愿意，可以说说后来发生了什么变化。</span>
          </label>
          <textarea
            id="follow-up-text"
            name="follow-up-text"
            rows="6"
            maxlength="2000"
            placeholder="You may share a small change, something that helped, or something you are still struggling with.&#10;你可以分享一个微小的变化、对你有帮助的事情，或者仍然困扰你的问题。"
          ></textarea>
          <p class="form-help">Suggested length: 50–200 words. This demo does not enforce a strict word limit. · 建议 50–200 词，演示版不作严格限制。</p>
        </div>

        <div class="form-group">
          <label for="follow-up-support">
            What helped—or what support do you still need?
            <span class="label-zh" lang="zh-Hans">什么对你有所帮助？或者你现在仍然需要什么支持？</span>
          </label>
          <textarea id="follow-up-support" name="follow-up-support" rows="3" maxlength="1200"></textarea>
        </div>

        <fieldset class="follow-up-fieldset">
          <legend>Who can see this update? <span lang="zh-Hans">谁可以看到这条更新？</span></legend>
          <div class="visibility-choice-grid">
            <label class="visibility-choice">
              <input type="radio" name="follow-up-visibility" value="public" checked>
              <span>
                <strong>Publish anonymously</strong>
                <small lang="zh-Hans">匿名公开</small>
              </span>
            </label>
            <label class="visibility-choice">
              <input type="radio" name="follow-up-visibility" value="private">
              <span>
                <strong>Keep private</strong>
                <small lang="zh-Hans">仅自己可见</small>
              </span>
            </label>
          </div>
          <p class="form-help">Anonymous public updates still enter review before publication. · 匿名公开的内容仍需经过审核后才会发布。</p>
        </fieldset>

        <aside class="follow-up-safety-note">
          <strong>Demo safety approach · 演示审核原则</strong>
          <ul>
            <li>Clearly safe content can proceed to review and publication.</li>
            <li>Attacks, ridicule, or encouragement of harmful behaviour are not published.</li>
            <li>Ambiguous or high-risk content is routed to a human moderator.</li>
            <li>Immediate-danger content is not made public; a live platform would show caring, verified regional support.</li>
          </ul>
          <p lang="zh-Hans">明确安全的内容可进入发布流程；攻击、讽刺或鼓动伤害的内容不会发布；模糊或高风险内容交由人工审核；紧急危险内容不会直接公开，正式平台将提供经过核验的地区支持资源。</p>
        </aside>

        <details class="demo-controls">
          <summary>Roadshow demo controls · 路演演示控制</summary>
          <label for="demo-moderation-scenario">Simulated moderation outcome · 模拟审核结果</label>
          <select id="demo-moderation-scenario" name="demo-moderation-scenario">
            <option value="safe">Standard safe flow → Pending Review</option>
            <option value="human">Needs Human Review example</option>
            <option value="care">Immediate safety-care example</option>
            <option value="reject">Unsafe / abusive content rejected</option>
          </select>
          <p>Demo-only presenter control. This is not available to ordinary users in a live platform.</p>
        </details>

        <div class="follow-up-form-actions">
          <button type="button" class="btn btn-secondary" data-followup-action="back-to-story">
            Back to story · 返回故事
          </button>
          <button type="submit" class="btn btn-primary">
            Submit Follow-up · 提交后续
          </button>
        </div>
      </form>
    </div>
  `;
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
    publishedLabel: 'Published just now · Demo',
    source: 'demo-created'
  };
  followUpState.phase = 'checking';
  renderFollowUpReviewState(story);

  followUpState.moderationTimer = mockModerateFollowUp(
    followUpState.pendingFollowUp,
    (nextPhase) => {
      if (!followUpState.pendingFollowUp || appState.activeStoryId !== story.id) return;
      followUpState.phase = nextPhase;
      followUpState.pendingFollowUp.reviewStatus = nextPhase;
      followUpState.moderationTimer = null;
      renderFollowUpReviewState(story);
      document.getElementById('follow-up-review-status')?.focus();
    }
  );
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

  const phaseContent = {
    checking: `
      <div class="review-state-card is-checking">
        <span class="review-spinner" aria-hidden="true"></span>
        <h3>Checking your follow-up…</h3>
        <p lang="zh-Hans">正在检查你的后续内容……</p>
        <p>This is a short, simulated safety check for the roadshow demo.</p>
      </div>
    `,
    'pending-review': `
      <div class="review-state-card is-pending">
        <h3>Submitted for review</h3>
        <p lang="zh-Hans">已提交审核</p>
        <p>Ambiguous or sensitive content will be reviewed by a human moderator before publication.</p>
        <p lang="zh-Hans">模糊或敏感的内容将在发布前交由人工审核。</p>
        <button type="button" class="btn btn-primary demo-approve-button" data-followup-action="approve">
          <span class="demo-only-label">DEMO CONTROL</span>
          Approve & publish · 批准并发布
        </button>
      </div>
    `,
    'needs-human-review': `
      <div class="review-state-card is-human">
        <h3>Needs Human Review</h3>
        <p lang="zh-Hans">需要人工审核</p>
        <p>The demo has paused publication because the content may be ambiguous or sensitive. It has not been rewritten or made public.</p>
        <p lang="zh-Hans">由于内容可能较模糊或敏感，演示流程已暂停发布；内容不会被自动改写或公开。</p>
      </div>
    `,
    'safety-care': `
      <div class="review-state-card is-care">
        <h3>Not published — support comes first</h3>
        <p lang="zh-Hans">暂不发布——先关注当事人的安全与支持</p>
        <p>A live platform would pause publication and offer caring, verified resources appropriate to the person’s region. This demo does not invent hotline details.</p>
        <p lang="zh-Hans">正式平台会暂停发布，并根据用户所在地区提供经过核验的关怀与求助资源。本演示不编造热线信息。</p>
      </div>
    `,
    rejected: `
      <div class="review-state-card is-rejected">
        <h3>Not eligible for publication</h3>
        <p lang="zh-Hans">不符合发布要求</p>
        <p>Attacks, ridicule, or encouragement of harmful behaviour are not published. The demo does not rewrite the content into a more positive version.</p>
        <p lang="zh-Hans">攻击、讽刺或鼓动伤害行为的内容不会发布；演示不会把原文自动改写成“更积极”的版本。</p>
      </div>
    `,
    approved: `
      <div class="review-state-card is-approved">
        <h3>${draft.visibility === 'public' ? 'Approved and published' : 'Approved and saved privately'}</h3>
        <p lang="zh-Hans">${draft.visibility === 'public' ? '已批准并发布' : '已批准并仅自己可见'}</p>
        <p>No change is still a valid update. · 即使没有变化，也是一种真实而有效的更新。</p>
        <button type="button" class="btn btn-primary" data-followup-action="view-story">
          View story timeline · 查看故事时间线
        </button>
      </div>
    `
  };

  content.innerHTML = `
    <div class="follow-up-review-view">
      <span class="prototype-label">Simulated review · 模拟审核</span>
      <h2 id="modal-title">Follow-up review status <span lang="zh-Hans">后续审核状态</span></h2>
      ${renderFollowUpWorkflow(followUpState.phase)}
      <div id="follow-up-review-status" role="status" aria-live="polite" tabindex="-1">
        ${phaseContent[followUpState.phase] || phaseContent.checking}
      </div>
      ${!['checking', 'approved'].includes(followUpState.phase) ? `
        <button type="button" class="btn btn-secondary review-back-button" data-followup-action="back-to-story">
          Back to story · 返回故事
        </button>
      ` : ''}
    </div>
  `;
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

  return `
    <ol class="review-workflow" aria-label="Demo review workflow">
      ${steps.map((step, index) => {
        const stateClass = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : '';
        return `
          <li class="${stateClass}" ${index === activeIndex ? 'aria-current="step"' : ''}>
            <span class="workflow-marker">${index < activeIndex ? '✓' : index + 1}</span>
            <span>
              <strong>${step.label}</strong>
              <small lang="zh-Hans">${step.labelZh}</small>
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
    return `
      <section class="comments-section no-comment-notice" aria-labelledby="response-heading">
        <h3 id="response-heading">No Comments</h3>
        <p>The author chose to have this story witnessed without receiving responses. Please respect that boundary.</p>
      </section>
    `;
  }

  const commentItems = story.comments.length
    ? story.comments.map((comment) => `
        <article class="comment-item">
          <strong>${escapeHtml(comment.author)}</strong>
          <span class="comment-type">${formatCommentType(comment.type)}</span>
          <p>${escapeHtml(comment.text)}</p>
        </article>
      `).join('')
    : '<p>No responses yet. You can leave the first one within the author’s chosen mode.</p>';

  return `
    <section class="comments-section" aria-labelledby="response-heading">
      <h3 id="response-heading">${escapeHtml(story.commentModeLabel)}</h3>
      <div class="comment-list">${commentItems}</div>
      <form class="comment-form">
        <label for="comment-text">Your response</label>
        <textarea
          id="comment-text"
          rows="3"
          maxlength="1000"
          required
          placeholder="Respond with ${escapeHtml(story.commentModeLabel.toLowerCase())}..."
        ></textarea>
        <button type="submit" class="btn btn-primary">Add demo response</button>
        <p class="comment-prototype-note" id="comment-prototype-note" tabindex="-1">
          Prototype preview: this response stays only in this browser session and is not transmitted or stored.
        </p>
      </form>
    </section>
  `;
}

function renderAdvice() {
  const grid = document.getElementById('advice-grid');
  if (!grid || appState.adviceRendered) return;

  grid.innerHTML = adviceArticles.map((article) => `
    <article class="advice-card">
      <span class="story-board">${formatBoardName(article.board)}</span>
      <h2>${escapeHtml(article.title)}</h2>
      <p>${escapeHtml(article.summary)}</p>
      <details>
        <summary>View practical steps</summary>
        <ol>
          ${article.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>
      </details>
      <div class="story-tags">
        ${article.tags.map((tag) => `<span class="story-tag">${escapeHtml(getTagLabel(tag))}</span>`).join('')}
      </div>
    </article>
  `).join('');

  appState.adviceRendered = true;
}

function initSubmitForm() {
  const form = document.getElementById('submit-form');
  const boardSelect = document.getElementById('story-board');
  const storyTitle = document.getElementById('story-title');
  const storyText = document.getElementById('story-text');
  const tagContainer = document.getElementById('tag-checkboxes');
  const resetButton = document.getElementById('reset-prototype-form');
  const resetDemoButton = document.getElementById('reset-demo-stories');
  const viewSubmittedButton = document.querySelector('#submit-success [data-page="archive"]');

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

  form?.addEventListener('submit', (event) => {
    event.preventDefault();

    const count = countStoryUnits(storyText?.value || '');
    const formError = document.getElementById('form-error');
    if (count.total < STORY_UNIT_MIN || count.total > STORY_UNIT_MAX) {
      if (formError) {
        formError.hidden = false;
        formError.textContent = `Your story has ${count.total} counted units. Please use ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} English words and CJK characters in total.`;
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

    const { story, persisted } = createDemoStory(form);
    appState.lastSubmittedStoryId = story.id;
    renderArchive();
    syncDemoStoryResetButton();

    form.hidden = true;
    const success = document.getElementById('submit-success');
    const successSummary = document.getElementById('submit-success-summary');
    if (successSummary) {
      successSummary.textContent = persisted
        ? 'Saved in this browser local storage. You can now verify the story, its tags, and Archive filtering. A live pilot would review and anonymise it before publication.'
        : 'Browser storage was unavailable, so this story exists only for the current page session. Nothing was transmitted to a server.';
    }
    if (success) {
      success.hidden = false;
      success.focus();
    }
  });

  viewSubmittedButton?.addEventListener('click', () => {
    const story = findStoryById(appState.lastSubmittedStoryId);
    if (!story) return;

    filterState.board = 'all';
    filterState.tags.clear();
    filterState.commentMode = 'all';
    filterState.search = story.title.toLocaleLowerCase();
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
    status.textContent = `Enter ${STORY_UNIT_MIN}–${STORY_UNIT_MAX} counted units.`;
  } else if (count.total < STORY_UNIT_MIN) {
    status.textContent = `${STORY_UNIT_MIN - count.total} more counted units needed.`;
    status.classList.add('is-invalid');
  } else if (count.total > STORY_UNIT_MAX) {
    status.textContent = `${count.total - STORY_UNIT_MAX} counted units over the limit.`;
    status.classList.add('is-invalid');
  } else {
    status.textContent = 'Length requirement met.';
    status.classList.add('is-valid');
  }
}

function formatBoardName(board) {
  const names = {
    academic: 'Academic Failure',
    job: 'Job Hunting',
    social: 'Social Integration'
  };
  return names[board] || board;
}

function formatCommentType(type) {
  const labels = {
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
