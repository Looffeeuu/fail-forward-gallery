const HOUR_MS = 60 * 60 * 1000;
const TRENDING_WINDOW_MS = 72 * HOUR_MS;
const TRENDING_HALF_LIFE_HOURS = 24;
const COMMENT_WEIGHT = 3;
export const RANKING_REFRESH_MS = 60 * 1000;

function topIds(rows, compare, limit) {
  return [...rows].sort(compare).slice(0, limit).map(({ storyId }) => storyId);
}

function byCountThenId(first, second) {
  return second.count - first.count || first.storyId.localeCompare(second.storyId);
}

// Content rankings for the public page. Responses carry story order only:
// view and comment figures stay on the server (authors see their own privately).
// Inputs only include stories that are public, so pending, withdrawn, removed,
// and private content can never rank.
export function createRankingService({
  database,
  storyService,
  now = () => new Date(),
  refreshMs = RANKING_REFRESH_MS,
  limit = 10
}) {
  if (!database || !storyService) throw new TypeError('Ranking service dependencies are required.');

  let cached = null;

  function computeTrending(inputs, timestamp) {
    // Recent views and approved responses, halving in weight every 24 hours.
    const scores = new Map();
    const add = ({ storyId, hour, count }, weight) => {
      const ageHours = Math.max(0, (timestamp - Date.parse(`${hour}:00:00.000Z`)) / HOUR_MS);
      const decayed = count * weight * 0.5 ** (ageHours / TRENDING_HALF_LIFE_HOURS);
      scores.set(storyId, (scores.get(storyId) || 0) + decayed);
    };
    inputs.viewHours.forEach((row) => add(row, 1));
    inputs.commentHours.forEach((row) => add(row, COMMENT_WEIGHT));
    return topIds(
      [...scores].map(([storyId, score]) => ({ storyId, count: score })),
      byCountThenId,
      limit
    );
  }

  function compute() {
    const generatedAt = now();
    const timestamp = generatedAt.getTime();
    const inputs = database.getRankingInputs({
      dayAgo: new Date(timestamp - 24 * HOUR_MS),
      weekAgo: new Date(timestamp - 7 * 24 * HOUR_MS),
      trendingSince: new Date(timestamp - TRENDING_WINDOW_MS)
    });
    const rankings = {
      trending: computeTrending(inputs, timestamp),
      mostReadDay: topIds(inputs.viewsDay, byCountThenId, limit),
      mostReadWeek: topIds(inputs.viewsWeek, byCountThenId, limit),
      mostDiscussed: topIds(
        inputs.commentCounts,
        (first, second) => second.count - first.count || second.latestAt.localeCompare(first.latestAt),
        limit
      ),
      recommended: inputs.recommendations.slice(0, limit).map(({ storyId, reason }) => ({ storyId, reason }))
    };
    const storyIds = [...new Set([
      ...rankings.trending,
      ...rankings.mostReadDay,
      ...rankings.mostReadWeek,
      ...rankings.mostDiscussed,
      ...rankings.recommended.map(({ storyId }) => storyId)
    ])];
    return {
      generatedAt: generatedAt.toISOString(),
      refreshSeconds: Math.round(refreshMs / 1000),
      rankings,
      stories: storyService.listPublishedStoriesByIds(storyIds)
    };
  }

  return Object.freeze({
    getRankings() {
      const timestamp = now().getTime();
      if (!cached || timestamp - cached.computedAt >= refreshMs) {
        cached = { computedAt: timestamp, value: compute() };
      }
      return cached.value;
    },

    // Editorial changes should appear at once rather than after the next refresh.
    invalidate() {
      cached = null;
    }
  });
}
