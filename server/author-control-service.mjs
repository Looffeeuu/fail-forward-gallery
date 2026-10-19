import { randomUUID } from 'node:crypto';
import { StoryError } from './story-service.mjs';

const CONTENT_TYPES = new Set(['story', 'comment', 'follow_up']);
const APPEAL_REASON_CODES = new Set([
  'context-misunderstood',
  'no-identifying-details',
  'within-guidelines',
  'other'
]);
const APPEAL_EXPLANATION_MIN_LENGTH = 10;
const APPEAL_EXPLANATION_MAX_LENGTH = 1000;

function requireOwnedContentRequest(accountId, contentType, contentId) {
  if (!accountId) {
    throw new StoryError('authentication-required', 401, 'Sign in to manage your contributions.');
  }
  const id = String(contentId || '').trim();
  if (!CONTENT_TYPES.has(contentType) || !id || id.length > 100) {
    throw new StoryError('content-not-found', 404, 'This contribution is not available.');
  }
  return id;
}

function normaliseAppealInput(input) {
  const reasonCode = String(input?.reasonCode || '').trim();
  const explanation = String(input?.explanation || '').trim();
  if (!APPEAL_REASON_CODES.has(reasonCode)) {
    throw new StoryError('invalid-appeal-reason', 400, 'Choose why the decision should be reviewed.');
  }
  if (
    explanation.length < APPEAL_EXPLANATION_MIN_LENGTH
    || explanation.length > APPEAL_EXPLANATION_MAX_LENGTH
  ) {
    throw new StoryError(
      'invalid-appeal-explanation',
      400,
      `Explain the appeal in ${APPEAL_EXPLANATION_MIN_LENGTH}-${APPEAL_EXPLANATION_MAX_LENGTH} characters.`
    );
  }
  return { reasonCode, explanation };
}

// Authors' controls over their own stories, comments, and follow-ups.
// Someone else's content is reported as not found, so ownership is never revealed.
export function createAuthorControlService({
  database,
  now = () => new Date(),
  generateId = randomUUID
}) {
  if (!database) throw new TypeError('Author control service database is required.');

  return Object.freeze({
    // Withdrawal takes effect immediately, whether the content is pending,
    // public, rejected, or private; the record stays for the audit trail.
    withdraw({ accountId, contentType, contentId }) {
      const id = requireOwnedContentRequest(accountId, contentType, contentId);
      const content = database.withdrawContent({
        contentType,
        contentId: id,
        accountId,
        withdrawnAt: now()
      });
      if (!content) {
        throw new StoryError('content-not-found', 404, 'This contribution is not available.');
      }
      return content;
    },

    appeal({ accountId, contentType, contentId, input }) {
      const id = requireOwnedContentRequest(accountId, contentType, contentId);
      const state = database.getOwnedContentState({ contentType, contentId: id, accountId });
      if (!state) {
        throw new StoryError('content-not-found', 404, 'This contribution is not available.');
      }
      if (state.moderationStatus !== 'rejected' || !state.moderationCaseId) {
        throw new StoryError(
          'appeal-not-available',
          409,
          'Only contributions that were not approved can be appealed.'
        );
      }
      if (state.hasAppeal) {
        throw new StoryError(
          'appeal-already-submitted',
          409,
          'Each review decision can be appealed once.'
        );
      }

      const { reasonCode, explanation } = normaliseAppealInput(input);
      const content = database.createAppeal({
        id: generateId(),
        contentType,
        contentId: id,
        moderationCaseId: state.moderationCaseId,
        appellantAccountId: accountId,
        reasonCode,
        explanation,
        createdAt: now()
      });
      if (!content) {
        throw new StoryError(
          'appeal-already-submitted',
          409,
          'Each review decision can be appealed once.'
        );
      }
      return content;
    }
  });
}
