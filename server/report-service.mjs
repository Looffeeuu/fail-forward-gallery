import { randomUUID } from 'node:crypto';
import { StoryError } from './story-service.mjs';

const CONTENT_TYPES = new Set(['story', 'comment', 'follow_up']);
const REPORT_REASON_CODES = new Set([
  'personal-information',
  'harassment',
  'encourages-harm',
  'spam',
  'outside-boundary',
  'safety-concern',
  'other'
]);
const DETAILS_MAX_LENGTH = 500;
export const DEFAULT_REPORT_LIMITS = Object.freeze({
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 10
});

function normaliseReportInput(input) {
  const reasonCode = String(input?.reasonCode || '').trim();
  const details = String(input?.details || '').trim();
  if (!REPORT_REASON_CODES.has(reasonCode)) {
    throw new StoryError('invalid-report-reason', 400, 'Choose why this should be reviewed.');
  }
  if (details.length > DETAILS_MAX_LENGTH || (reasonCode === 'other' && details.length < 5)) {
    throw new StoryError(
      'invalid-report-details',
      400,
      `Add up to ${DETAILS_MAX_LENGTH} characters of detail; "other" needs a short description.`
    );
  }
  return { reasonCode, details };
}

// Signed-in readers flag public content for human re-review. Reports are
// limited per account so they cannot be used to flood reviewers or harass authors.
export function createReportService({
  database,
  now = () => new Date(),
  generateId = randomUUID,
  reportLimits = DEFAULT_REPORT_LIMITS
}) {
  if (!database) throw new TypeError('Report service database is required.');

  return Object.freeze({
    createReport({ accountId, contentType, contentId, input }) {
      if (!accountId) {
        throw new StoryError('authentication-required', 401, 'Sign in to report content.');
      }
      const id = String(contentId || '').trim();
      const target = CONTENT_TYPES.has(contentType) && id && id.length <= 100
        ? database.getReportTarget(contentType, id)
        : null;
      if (!target?.isPublic) {
        throw new StoryError('content-not-found', 404, 'This content is not available.');
      }
      if (target.authorAccountId === accountId) {
        throw new StoryError(
          'cannot-report-own-content',
          400,
          'This is your own content. You can withdraw it from My stories.'
        );
      }

      const { reasonCode, details } = normaliseReportInput(input);
      const createdAt = now();
      const activity = database.getRecentReportActivity(
        accountId,
        new Date(createdAt.getTime() - reportLimits.windowMs)
      );
      if (activity.count >= reportLimits.maxPerWindow) {
        const windowEndsAt = new Date(activity.oldestCreatedAt).getTime() + reportLimits.windowMs;
        throw new StoryError(
          'report-rate-limited',
          429,
          'You have sent several reports recently. Please try again later.',
          Math.max(1, Math.ceil((windowEndsAt - createdAt.getTime()) / 1000))
        );
      }

      const created = database.createReport({
        id: generateId(),
        contentType,
        contentId: id,
        reporterAccountId: accountId,
        reasonCode,
        details,
        createdAt
      });
      if (!created) {
        throw new StoryError('already-reported', 409, 'You have already reported this content.');
      }
      return Object.freeze({ contentType, contentId: id, reasonCode, status: 'open' });
    }
  });
}
