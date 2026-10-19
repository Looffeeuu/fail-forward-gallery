import { createHmac } from 'node:crypto';
import { StoryError } from './story-service.mjs';

const BOT_PATTERN = /bot|crawl|spider|slurp|headless|preview|curl|wget|python-requests|httpclient|okhttp/i;
const VIEW_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_VIEW_LIMITS = Object.freeze({
  windowMs: 60 * 60 * 1000,
  maxNewViewsPerSource: 60
});

// Counts at most one view per person per story per day, for rankings and the
// author's private figures. Nothing stored can be linked to a person across
// days: viewer keys are hashed with a server secret and the date, and network
// addresses are only held in memory to slow down scripted inflation.
export function createViewService({
  database,
  secret,
  now = () => new Date(),
  viewLimits = DEFAULT_VIEW_LIMITS
}) {
  if (!database) throw new TypeError('View service database is required.');
  if (!secret) throw new TypeError('View service secret is required.');

  const recentViewsBySource = new Map();
  let lastPrunedAt = 0;

  function keyedHash(value) {
    return createHmac('sha256', `${secret}:views`).update(value).digest('base64url');
  }

  function sourceIsOverLimit(sourceKey, timestamp) {
    const recent = (recentViewsBySource.get(sourceKey) || [])
      .filter((viewedAt) => timestamp - viewedAt < viewLimits.windowMs);
    recentViewsBySource.set(sourceKey, recent);
    return recent.length >= viewLimits.maxNewViewsPerSource;
  }

  function pruneOccasionally(timestamp) {
    if (timestamp - lastPrunedAt < PRUNE_INTERVAL_MS) return;
    lastPrunedAt = timestamp;
    database.pruneViewEvents(new Date(timestamp - VIEW_RETENTION_MS));
    recentViewsBySource.forEach((views, sourceKey) => {
      if (views.every((viewedAt) => timestamp - viewedAt >= viewLimits.windowMs)) {
        recentViewsBySource.delete(sourceKey);
      }
    });
  }

  return Object.freeze({
    // Returns whether the view counted; callers should not reveal this to clients.
    recordView({ storyId, visitorId, accountId, userAgent, sourceAddress }) {
      const id = String(storyId || '').trim();
      const story = id && id.length <= 100 ? database.getPublicState('story', id) : null;
      if (!story?.isPublic) {
        throw new StoryError('story-not-found', 404, 'This story is not available.');
      }

      const viewerKey = accountId ? `account:${accountId}` : visitorId ? `visitor:${visitorId}` : '';
      const isProbableBot = !userAgent || BOT_PATTERN.test(userAgent);
      if (!viewerKey || isProbableBot || story.authorAccountId === accountId) return false;

      const occurredAt = now();
      const timestamp = occurredAt.getTime();
      pruneOccasionally(timestamp);
      const sourceKey = keyedHash(`source:${sourceAddress || 'unknown'}`);
      if (sourceIsOverLimit(sourceKey, timestamp)) return false;

      const viewDate = occurredAt.toISOString().slice(0, 10);
      const counted = database.recordView({
        storyId: id,
        visitorHash: keyedHash(`${viewDate}:${viewerKey}`),
        viewDate,
        occurredAt
      });
      if (counted) recentViewsBySource.get(sourceKey).push(timestamp);
      return counted;
    }
  });
}
