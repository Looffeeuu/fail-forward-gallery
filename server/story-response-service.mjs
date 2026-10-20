import { randomUUID } from 'node:crypto';
import { detectRiskSignals } from './risk-signals.mjs';
import { StoryError } from './story-service.mjs';
import { enforceSubmissionLimits, SUBMISSION_LIMITS } from './submission-limits.mjs';

const FOLLOW_UP_STATUSES = new Set([
  'still-difficult',
  'no-major-change',
  'small-steps',
  'better-than-before',
  'prefer-not-to-say'
]);
const FOLLOW_UP_VISIBILITIES = new Set(['anonymous-public', 'private']);
const COMMENT_MAX_LENGTH = 1000;
const FOLLOW_UP_MAX_LENGTH = 2000;
const FOLLOW_UP_SUPPORT_MAX_LENGTH = 1200;
export const DEFAULT_COMMENT_LIMITS = SUBMISSION_LIMITS.comment;

function requireAccount(accountId, message) {
  if (!accountId) throw new StoryError('authentication-required', 401, message);
}

function normaliseStoryId(storyId) {
  const id = String(storyId || '').trim();
  if (!id || id.length > 100) {
    throw new StoryError('story-not-found', 404, 'This story is not available.');
  }
  return id;
}

function normaliseCommentInput(input) {
  const content = String(input?.content || '').trim();
  if (!content || content.length > COMMENT_MAX_LENGTH) {
    throw new StoryError(
      'invalid-comment',
      400,
      `Write a response between 1 and ${COMMENT_MAX_LENGTH} characters.`
    );
  }
  return content;
}

function normaliseFollowUpInput(input) {
  const status = String(input?.status || '').trim();
  const content = String(input?.content || '').trim();
  const support = String(input?.support || '').trim();
  const visibility = String(input?.visibility || '').trim();

  if (!FOLLOW_UP_STATUSES.has(status)) {
    throw new StoryError('invalid-follow-up-status', 400, 'Choose how things are now.');
  }
  if (!FOLLOW_UP_VISIBILITIES.has(visibility)) {
    throw new StoryError('invalid-visibility', 400, 'Choose who can see this update.');
  }
  if (content.length > FOLLOW_UP_MAX_LENGTH || support.length > FOLLOW_UP_SUPPORT_MAX_LENGTH) {
    throw new StoryError(
      'invalid-follow-up',
      400,
      `Keep the update within ${FOLLOW_UP_MAX_LENGTH} characters and the support note within ${FOLLOW_UP_SUPPORT_MAX_LENGTH}.`
    );
  }

  return Object.freeze({ status, content, support, visibility });
}

// Comments and follow-ups attach only to stories a human has already approved.
function findPublishedStory(database, storyId) {
  const story = database.findStoryForInteraction(normaliseStoryId(storyId));
  if (!story || story.moderationStatus !== 'approved') {
    throw new StoryError('story-not-found', 404, 'This story is not available.');
  }
  return story;
}

export function createStoryResponseService({
  database,
  now = () => new Date(),
  generateId = randomUUID,
  commentLimits = DEFAULT_COMMENT_LIMITS,
  followUpLimits = SUBMISSION_LIMITS.follow_up
}) {
  if (!database) throw new TypeError('Story response service database is required.');
  // Callers may override only the numbers; codes and messages keep their defaults.
  const effectiveCommentLimits = { ...SUBMISSION_LIMITS.comment, ...commentLimits };
  const effectiveFollowUpLimits = { ...SUBMISSION_LIMITS.follow_up, ...followUpLimits };

  // Comments are the only content strangers can send to an author, so they
  // carry flood, backlog, and duplicate limits before reaching reviewers.
  function enforceCommentLimits({ accountId, storyId, content, timestamp }) {
    enforceSubmissionLimits({
      database, contentType: 'comment', accountId, timestamp, limits: effectiveCommentLimits
    });
    if (database.hasDuplicateComment({ accountId, storyId, content })) {
      throw new StoryError(
        'duplicate-comment',
        409,
        'You have already sent this response to this story.'
      );
    }
  }

  return Object.freeze({
    createComment({ accountId, storyId, input }) {
      requireAccount(accountId, 'Sign in before responding to a story.');
      const story = findPublishedStory(database, storyId);
      if (story.responsePreference === 'none') {
        throw new StoryError(
          'comments-closed',
          403,
          'The author chose not to receive responses to this story.'
        );
      }

      const content = normaliseCommentInput(input);
      const createdAt = now();
      enforceCommentLimits({ accountId, storyId: story.id, content, timestamp: createdAt });
      return database.createComment({
        id: generateId(),
        storyId: story.id,
        authorAccountId: accountId,
        // The author's chosen boundary, not the commenter, decides the response type.
        responseType: story.responsePreference,
        content,
        riskSignals: detectRiskSignals(content),
        createdAt
      });
    },

    listMyComments(accountId) {
      requireAccount(accountId, 'Sign in to view your responses.');
      return database.listCommentsByAccount(accountId);
    },

    createFollowUp({ accountId, storyId, input }) {
      requireAccount(accountId, 'Sign in before adding a follow-up.');
      const story = findPublishedStory(database, storyId);
      if (story.authorAccountId !== accountId) {
        throw new StoryError(
          'follow-up-author-only',
          403,
          'Only the original anonymous author can add a follow-up.'
        );
      }

      const followUp = normaliseFollowUpInput(input);
      const createdAt = now();
      enforceSubmissionLimits({
        database,
        contentType: 'follow_up',
        accountId,
        timestamp: createdAt,
        limits: effectiveFollowUpLimits
      });
      const riskSignals = detectRiskSignals(followUp.content, followUp.support);
      const created = database.createFollowUp({
        id: generateId(),
        storyId: story.id,
        authorAccountId: accountId,
        ...followUp,
        riskSignals,
        createdAt
      });
      // Private updates never reach reviewers, but the writer is still offered care.
      return riskSignals.length && !created.careSuggested
        ? Object.freeze({ ...created, careSuggested: true })
        : created;
    }
  });
}
