import { StoryError } from './story-service.mjs';

const MINUTE = 60 * 1000;

// Per-account limits on what each person can send to reviewers. Counts come
// from stored rows, so restarting the service or withdrawing content does not
// reset them. Messages are shown to writers as-is.
export const SUBMISSION_LIMITS = Object.freeze({
  story: Object.freeze({
    windowMs: 60 * MINUTE,
    maxPerWindow: 3,
    maxPending: 3,
    rateCode: 'story-rate-limited',
    rateMessage: 'You have submitted several stories recently. Please wait before sending another.',
    pendingCode: 'too-many-pending-stories',
    pendingMessage: 'Several of your stories are still awaiting review. Please wait for decisions first.'
  }),
  comment: Object.freeze({
    windowMs: 10 * MINUTE,
    maxPerWindow: 5,
    maxPending: 10,
    rateCode: 'comment-rate-limited',
    rateMessage: 'You have sent several responses recently. Please wait before sending another.',
    pendingCode: 'too-many-pending-comments',
    pendingMessage: 'Several of your responses are still awaiting review. Please wait for decisions first.'
  }),
  follow_up: Object.freeze({
    windowMs: 60 * MINUTE,
    maxPerWindow: 3,
    maxPending: 3,
    rateCode: 'follow-up-rate-limited',
    rateMessage: 'You have added several follow-ups recently. Please wait before adding another.',
    pendingCode: 'too-many-pending-follow-ups',
    pendingMessage: 'Several of your follow-ups are still awaiting review. Please wait for decisions first.'
  })
});

export function enforceSubmissionLimits({ database, contentType, accountId, timestamp, limits }) {
  const activity = database.getRecentActivity(
    contentType,
    accountId,
    new Date(timestamp.getTime() - limits.windowMs)
  );
  if (activity.count >= limits.maxPerWindow) {
    const windowEndsAt = new Date(activity.oldestCreatedAt).getTime() + limits.windowMs;
    throw new StoryError(
      limits.rateCode,
      429,
      limits.rateMessage,
      Math.max(1, Math.ceil((windowEndsAt - timestamp.getTime()) / 1000))
    );
  }
  if (database.countPending(contentType, accountId) >= limits.maxPending) {
    throw new StoryError(limits.pendingCode, 429, limits.pendingMessage);
  }
}
