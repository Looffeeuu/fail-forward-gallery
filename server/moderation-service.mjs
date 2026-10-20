import { randomUUID } from 'node:crypto';

const REVIEWER_ROLES = new Set(['moderator', 'administrator']);
const DECISIONS = new Set(['approve', 'reject', 'safety-hold']);
const CONTENT_TYPES = new Set(['story', 'comment', 'follow_up']);
// Decisions on held content, mapped to the database's decision names.
const HELD_DECISIONS = Object.freeze({ release: 'release', reject: 'reject-held' });
const APPEAL_DECISIONS = new Set(['overturn', 'uphold']);
const REPORT_DECISIONS = new Set(['remove', 'dismiss', 'safety-hold']);

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

function normaliseDecisionInput(contentId, input, invalidContent, allowedDecisions = DECISIONS) {
  const id = String(contentId || '').trim();
  const decision = String(input?.decision || '').trim();
  const reason = String(input?.reason || '').trim();

  if (!id || id.length > 100) {
    throw new ModerationError(invalidContent.code, 400, invalidContent.message);
  }
  if (!allowedDecisions.has(decision)) {
    throw new ModerationError(
      'invalid-decision',
      400,
      `Choose ${[...allowedDecisions].join(' or ')}.`
    );
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

export function createModerationService({
  database,
  now = () => new Date(),
  generateId = randomUUID
}) {
  if (!database) throw new TypeError('Moderation service database is required.');

  // Reviewers never decide on what they wrote; another reviewer must. Their own
  // items are also left out of their queue, so the refusal is rarely seen.
  function requireOthersContent(session, contentType, contentId) {
    if (database.findContentAuthor(contentType, contentId) === session.accountId) {
      throw new ModerationError(
        'own-content',
        403,
        'You cannot review your own content. Another reviewer will handle it.'
      );
    }
  }

  function notOwn(session, contentType) {
    return (item) => database.findContentAuthor(contentType, item.id) !== session.accountId;
  }

  function decide(session, contentId, input, { contentType, invalidContent, moderate, conflictMessage }) {
    requireReviewer(session);
    const { id, decision, reason } = normaliseDecisionInput(contentId, input, invalidContent);
    requireOthersContent(session, contentType, id);
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
      return database.listStoriesForModeration('pending-human-review').filter(notOwn(session, 'story'));
    },

    listPendingComments(session) {
      requireReviewer(session);
      return database.listCommentsForModeration().filter(notOwn(session, 'comment'));
    },

    listPendingFollowUps(session) {
      requireReviewer(session);
      return database.listFollowUpsForModeration().filter(notOwn(session, 'follow_up'));
    },

    // The original reviewer may still decide an appeal (small teams would
    // otherwise stall), but the queue tells them so they can hand it over.
    listPendingAppeals(session) {
      requireReviewer(session);
      return database.listPendingAppeals()
        .filter((appeal) => database.findContentAuthor(appeal.contentType, appeal.contentId) !== session.accountId)
        .map(({
        originalDeciderAccountId,
        moderationCaseId,
        ...appeal
      }) => Object.freeze({
        ...appeal,
        originalDecisionByYou: originalDeciderAccountId === session.accountId
      }));
    },

    decideAppeal({ session, appealId, input }) {
      requireReviewer(session);
      const { id, decision, reason } = normaliseDecisionInput(
        appealId,
        input,
        { code: 'invalid-appeal-id', message: 'Choose a valid appeal.' },
        APPEAL_DECISIONS
      );
      const pendingAppeal = database.findAppeal(id);
      if (pendingAppeal) requireOthersContent(session, pendingAppeal.contentType, pendingAppeal.contentId);
      const resolved = database.resolveAppeal({
        appealId: id,
        reviewerAccountId: session.accountId,
        decision,
        reason,
        decidedAt: now()
      });
      if (!resolved) {
        throw new ModerationError(
          'review-conflict',
          409,
          'This appeal is no longer awaiting a decision.'
        );
      }
      const { originalDeciderAccountId, moderationCaseId, ...appeal } = database.findAppeal(id);
      return Object.freeze(appeal);
    },

    // Editorial picks are public with their reason, so readers know why a story is featured.
    recommendStory({ session, storyId, input }) {
      requireReviewer(session);
      const id = String(storyId || '').trim();
      const reason = String(input?.reason || '').trim();
      if (reason.length < 8 || reason.length > 300) {
        throw new ModerationError(
          'invalid-recommendation-reason',
          400,
          'Explain the recommendation in 8-300 characters.'
        );
      }
      if (id && id.length <= 100) requireOthersContent(session, 'story', id);
      const recommended = id && id.length <= 100 && database.recommendStory({
        id: generateId(),
        storyId: id,
        reason,
        accountId: session.accountId,
        createdAt: now()
      });
      if (!recommended) {
        throw new ModerationError('invalid-story', 404, 'Only public stories can be recommended.');
      }
      return Object.freeze({ storyId: id, reason });
    },

    unrecommendStory({ session, storyId }) {
      requireReviewer(session);
      const removed = database.unrecommendStory({
        storyId: String(storyId || '').trim(),
        accountId: session.accountId,
        removedAt: now()
      });
      if (!removed) {
        throw new ModerationError('review-conflict', 409, 'This story is not currently recommended.');
      }
      return Object.freeze({ storyId });
    },

    // Safety holds: unpublished for care rather than for breaking rules.
    listHeldContent(session) {
      requireReviewer(session);
      return database.listHeldContent()
        .filter(({ contentType, content }) => database.findContentAuthor(contentType, content.id) !== session.accountId);
    },

    decideHeld({ session, contentType, contentId, input }) {
      requireReviewer(session);
      if (!CONTENT_TYPES.has(contentType)) {
        throw new ModerationError('invalid-content', 400, 'Choose valid held content.');
      }
      const { id, decision, reason } = normaliseDecisionInput(
        contentId,
        input,
        { code: 'invalid-content', message: 'Choose valid held content.' },
        new Set(Object.keys(HELD_DECISIONS))
      );
      requireOthersContent(session, contentType, id);
      const decide = {
        story: (args) => database.moderateStory({ storyId: id, ...args }),
        comment: (args) => database.moderateComment({ commentId: id, ...args }),
        follow_up: (args) => database.moderateFollowUp({ followUpId: id, ...args })
      }[contentType];
      const result = decide({
        decision: HELD_DECISIONS[decision],
        reason,
        reviewerAccountId: session.accountId,
        decidedAt: now()
      });
      if (!result) {
        throw new ModerationError('review-conflict', 409, 'This content is no longer held.');
      }
      return result;
    },

    listReportedContent(session) {
      requireReviewer(session);
      return database.listReportedContent()
        .filter(({ contentType, contentId }) => database.findContentAuthor(contentType, contentId) !== session.accountId);
    },

    decideReports({ session, contentType, contentId, input }) {
      requireReviewer(session);
      if (!CONTENT_TYPES.has(contentType)) {
        throw new ModerationError('invalid-content', 400, 'Choose valid reported content.');
      }
      const { id, decision, reason } = normaliseDecisionInput(
        contentId,
        input,
        { code: 'invalid-content', message: 'Choose valid reported content.' },
        REPORT_DECISIONS
      );
      requireOthersContent(session, contentType, id);
      const resolved = database.resolveReports({
        contentType,
        contentId: id,
        reviewerAccountId: session.accountId,
        decision,
        reason,
        decidedAt: now()
      });
      if (!resolved) {
        throw new ModerationError(
          'review-conflict',
          409,
          'These reports were already handled, or the content is no longer public.'
        );
      }
      return Object.freeze({
        contentType,
        contentId: id,
        status: { remove: 'removed', dismiss: 'kept', 'safety-hold': 'safety-hold' }[decision]
      });
    },

    decideStory({ session, storyId, input }) {
      return decide(session, storyId, input, {
        contentType: 'story',
        invalidContent: { code: 'invalid-story', message: 'Choose a valid story.' },
        moderate: (id, decision) => database.moderateStory({ storyId: id, ...decision }),
        conflictMessage: 'This story is no longer awaiting review.'
      });
    },

    decideComment({ session, commentId, input }) {
      return decide(session, commentId, input, {
        contentType: 'comment',
        invalidContent: { code: 'invalid-comment-id', message: 'Choose a valid response.' },
        moderate: (id, decision) => database.moderateComment({ commentId: id, ...decision }),
        conflictMessage: 'This response is no longer awaiting review.'
      });
    },

    decideFollowUp({ session, followUpId, input }) {
      return decide(session, followUpId, input, {
        contentType: 'follow_up',
        invalidContent: { code: 'invalid-follow-up-id', message: 'Choose a valid follow-up.' },
        moderate: (id, decision) => database.moderateFollowUp({ followUpId: id, ...decision }),
        conflictMessage: 'This follow-up is no longer awaiting review.'
      });
    }
  });
}
