import { randomUUID } from 'node:crypto';

const ALLOWED_BOARDS = new Set(['academic', 'job', 'social']);
const ALLOWED_RESPONSE_PREFERENCES = new Set(['none', 'encouragement', 'similar', 'advice']);
const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

export class StoryError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'StoryError';
    this.code = code;
    this.status = status;
  }
}

export function countStoryUnits(text) {
  const englishWords = String(text || '').match(
    /\p{Script=Latin}+(?:['\u2019\-]\p{Script=Latin}+)*/gu
  ) || [];
  const cjkCharacters = String(text || '').match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  ) || [];

  return {
    englishWords: englishWords.length,
    cjkCharacters: cjkCharacters.length,
    total: englishWords.length + cjkCharacters.length
  };
}

function normaliseStoryInput(input) {
  const title = String(input?.title || '').trim();
  const board = String(input?.board || '').trim();
  const content = String(input?.content || '').trim();
  const responsePreference = String(input?.responsePreference || '').trim();
  const tags = Array.isArray(input?.tags)
    ? [...new Set(input.tags.map((tag) => String(tag || '').trim()).filter(Boolean))]
    : [];

  if (!title || title.length > 100) {
    throw new StoryError('invalid-title', 400, 'Use a story title between 1 and 100 characters.');
  }
  if (!ALLOWED_BOARDS.has(board)) {
    throw new StoryError('invalid-board', 400, 'Choose a valid thematic board.');
  }
  if (!ALLOWED_RESPONSE_PREFERENCES.has(responsePreference)) {
    throw new StoryError('invalid-response-preference', 400, 'Choose a valid response preference.');
  }
  if (input?.guidelinesAccepted !== true) {
    throw new StoryError('guidelines-required', 400, 'Confirm the privacy and content guidelines.');
  }
  if (tags.length > 3 || tags.some((tag) => !TAG_PATTERN.test(tag))) {
    throw new StoryError('invalid-tags', 400, 'Choose up to three valid story tags.');
  }

  const count = countStoryUnits(content);
  if (count.total < 150 || count.total > 200) {
    throw new StoryError(
      'invalid-story-length',
      400,
      'Use 150-200 English words and CJK characters in total.'
    );
  }

  return Object.freeze({ title, board, content, responsePreference, tags });
}

export function createStoryService({ database, now = () => new Date(), generateId = randomUUID }) {
  if (!database) throw new TypeError('Story service database is required.');

  return Object.freeze({
    createStory({ accountId, input }) {
      if (!accountId) {
        throw new StoryError('authentication-required', 401, 'Sign in before submitting a story.');
      }

      const story = normaliseStoryInput(input);
      return database.createStory({
        id: generateId(),
        authorAccountId: accountId,
        ...story,
        createdAt: now()
      });
    },

    listMyStories(accountId) {
      if (!accountId) {
        throw new StoryError('authentication-required', 401, 'Sign in to view your stories.');
      }
      return database.listStoriesByAccount(accountId);
    },

    listPublishedStories(limit = 100) {
      return database.listPublishedStories(limit).map((story) => Object.freeze({
        id: story.id,
        board: story.board,
        title: story.title,
        content: story.content,
        responsePreference: story.responsePreference,
        tags: Object.freeze([...story.tags]),
        publishedAt: story.publishedAt
      }));
    }
  });
}
