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
    throw new ModerationError('authentication-required', 401, 'Sign in to review content.');
  }
  if (!REVIEWER_ROLES.has(session.role)) {
    throw new ModerationError('moderator-required', 403, 'Moderator access is required.');
  }
}

function normaliseDecisionInput(contentId, input, invalidContent) {
  const id = String(contentId || '').trim();
  const decision = String(input?.decision || '').trim();
  const reason = String(input?.reason || '').trim();

  if (!id || id.length > 100) {
    throw new ModerationError(invalidContent.code, 400, invalidContent.message);
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

  return Object.freeze({ id, decision, reason });
}

export function createModerationService({ database, now = () => new Date() }) {
  if (!database) throw new TypeError('Moderation service database is required.');

  function decide(session, contentId, input, { invalidContent, moderate, conflictMessage }) {
    requireReviewer(session);
    const { id, decision, reason } = normaliseDecisionInput(contentId, input, invalidContent);
    const result = moderate(id, {
      decision,
      reason,
      reviewerAccountId: session.accountId,
      decidedAt: now()
    });
    if (!result) throw new ModerationError('review-conflict', 409, conflictMessage);
    return result;
  }

  return Object.freeze({
    listPendingStories(session) {
      requireReviewer(session);
      return database.listStoriesForModeration('pending-human-review');
    },

    listPendingComments(session) {
      requireReviewer(session);
      return database.listCommentsForModeration();
    },

    listPendingFollowUps(session) {
      requireReviewer(session);
      return database.listFollowUpsForModeration();
    },

    decideStory({ session, storyId, input }) {
      return decide(session, storyId, input, {
        invalidContent: { code: 'invalid-story', message: 'Choose a valid story.' },
        moderate: (id, decision) => database.moderateStory({ storyId: id, ...decision }),
        conflictMessage: 'This story is no longer awaiting review.'
      });
    },

    decideComment({ session, commentId, input }) {
      return decide(session, commentId, input, {
        invalidContent: { code: 'invalid-comment-id', message: 'Choose a valid response.' },
        moderate: (id, decision) => database.moderateComment({ commentId: id, ...decision }),
        conflictMessage: 'This response is no longer awaiting review.'
      });
    },

    decideFollowUp({ session, followUpId, input }) {
      return decide(session, followUpId, input, {
        invalidContent: { code: 'invalid-follow-up-id', message: 'Choose a valid follow-up.' },
        moderate: (id, decision) => database.moderateFollowUp({ followUpId: id, ...decision }),
        conflictMessage: 'This follow-up is no longer awaiting review.'
      });
    }
  });
}
