const REVIEWER_ROLES = new Set(['moderator', 'administrator']);
const DECISIONS = new Set(['approve', 'reject']);

export class ModerationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ModerationError';
    this.code = code;
    this.status = status;
  }
}

function requireReviewer(session) {
  if (!session) {
    throw new ModerationError('authentication-required', 401, 'Sign in to review stories.');
  }
  if (!REVIEWER_ROLES.has(session.role)) {
    throw new ModerationError('moderator-required', 403, 'Moderator access is required.');
  }
}

function normaliseDecisionInput(storyId, input) {
  const id = String(storyId || '').trim();
  const decision = String(input?.decision || '').trim();
  const reason = String(input?.reason || '').trim();

  if (!id || id.length > 100) {
    throw new ModerationError('invalid-story', 400, 'Choose a valid story.');
  }
  if (!DECISIONS.has(decision)) {
    throw new ModerationError('invalid-decision', 400, 'Choose approve or reject.');
  }
  if (reason.length < 8 || reason.length > 500) {
    throw new ModerationError(
      'invalid-review-reason',
      400,
      'Provide a review reason between 8 and 500 characters.'
    );
  }

  return Object.freeze({ storyId: id, decision, reason });
}

export function createModerationService({ database, now = () => new Date() }) {
  if (!database) throw new TypeError('Moderation service database is required.');

  return Object.freeze({
    listPendingStories(session) {
      requireReviewer(session);
      return database.listStoriesForModeration('pending-human-review');
    },

    decideStory({ session, storyId, input }) {
      requireReviewer(session);
      const decision = normaliseDecisionInput(storyId, input);
      const story = database.moderateStory({
        ...decision,
        reviewerAccountId: session.accountId,
        decidedAt: now()
      });
      if (!story) {
        throw new ModerationError(
          'review-conflict',
          409,
          'This story is no longer awaiting review.'
        );
      }
      return story;
    }
  });
}
