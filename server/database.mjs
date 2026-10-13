import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// V0.2 created moderation_cases with a story-only CHECK and a foreign key to
// stories. SQLite cannot alter either in place, so the table is rebuilt once.
function migrateStoryOnlyModerationCases(database) {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'moderation_cases'"
  ).get();
  if (!table || table.sql.includes("'comment'")) return;

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      CREATE TABLE moderation_cases_migrated (
        id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL CHECK (content_type IN ('story', 'comment', 'follow_up')),
        content_id TEXT NOT NULL,
        automated_status TEXT NOT NULL DEFAULT 'not-configured'
          CHECK (automated_status IN ('not-configured', 'passed', 'rejected', 'needs-human-review')),
        human_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (human_status IN ('pending', 'approved', 'rejected')),
        decision_reason TEXT,
        decided_at TEXT,
        decided_by_account_id TEXT REFERENCES accounts(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO moderation_cases_migrated (
        id, content_type, content_id, automated_status, human_status,
        decision_reason, decided_at, decided_by_account_id, created_at, updated_at
      )
      SELECT
        id, content_type, content_id, automated_status, human_status,
        decision_reason, decided_at, decided_by_account_id, created_at, updated_at
      FROM moderation_cases;
      DROP TABLE moderation_cases;
      ALTER TABLE moderation_cases_migrated RENAME TO moderation_cases;
      CREATE INDEX IF NOT EXISTS moderation_content_index
        ON moderation_cases(content_type, content_id);
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

export function createDatabase(databasePath) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  // DELETE mode also works when development runs through a Windows/WSL
  // shared path. Production will use PostgreSQL rather than this local store.
  database.exec('PRAGMA journal_mode = DELETE');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      phone_fingerprint TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'moderator', 'administrator')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_account_id_index
      ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_index
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      author_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      board TEXT NOT NULL CHECK (board IN ('academic', 'job', 'social')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      response_preference TEXT NOT NULL
        CHECK (response_preference IN ('none', 'encouragement', 'similar', 'advice')),
      visibility TEXT NOT NULL DEFAULT 'anonymous-public'
        CHECK (visibility IN ('anonymous-public')),
      moderation_status TEXT NOT NULL DEFAULT 'pending-human-review'
        CHECK (moderation_status IN ('pending-human-review', 'approved', 'rejected', 'withdrawn')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS story_tags (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      tag_value TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (story_id, tag_value)
    );

    CREATE TABLE IF NOT EXISTS moderation_cases (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('story', 'comment', 'follow_up')),
      content_id TEXT NOT NULL,
      automated_status TEXT NOT NULL DEFAULT 'not-configured'
        CHECK (automated_status IN ('not-configured', 'passed', 'rejected', 'needs-human-review')),
      human_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (human_status IN ('pending', 'approved', 'rejected')),
      decision_reason TEXT,
      decided_at TEXT,
      decided_by_account_id TEXT REFERENCES accounts(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_events (
      id TEXT PRIMARY KEY,
      moderation_case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      actor_account_id TEXT REFERENCES accounts(id),
      action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected')),
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      author_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      response_type TEXT NOT NULL
        CHECK (response_type IN ('encouragement', 'similar', 'advice')),
      body TEXT NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'pending-human-review'
        CHECK (moderation_status IN ('pending-human-review', 'approved', 'rejected', 'withdrawn')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      author_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN (
        'still-difficult', 'no-major-change', 'small-steps', 'better-than-before', 'prefer-not-to-say'
      )),
      body TEXT NOT NULL DEFAULT '',
      support TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK (visibility IN ('anonymous-public', 'private')),
      moderation_status TEXT NOT NULL
        CHECK (moderation_status IN ('pending-human-review', 'approved', 'rejected', 'private', 'withdrawn')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE INDEX IF NOT EXISTS comments_story_index
      ON comments(story_id, moderation_status, published_at);
    CREATE INDEX IF NOT EXISTS comments_author_index
      ON comments(author_account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS follow_ups_story_index
      ON follow_ups(story_id, created_at);
    CREATE INDEX IF NOT EXISTS stories_author_created_index
      ON stories(author_account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS stories_moderation_index
      ON stories(moderation_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS moderation_content_index
      ON moderation_cases(content_type, content_id);
    CREATE INDEX IF NOT EXISTS moderation_events_case_index
      ON moderation_events(moderation_case_id, created_at);
  `);

  const moderationColumns = new Set(
    database.prepare('PRAGMA table_info(moderation_cases)').all().map(({ name }) => name)
  );
  if (!moderationColumns.has('decision_reason')) {
    database.exec('ALTER TABLE moderation_cases ADD COLUMN decision_reason TEXT');
  }
  if (!moderationColumns.has('decided_at')) {
    database.exec('ALTER TABLE moderation_cases ADD COLUMN decided_at TEXT');
  }
  if (!moderationColumns.has('decided_by_account_id')) {
    database.exec(
      'ALTER TABLE moderation_cases ADD COLUMN decided_by_account_id TEXT REFERENCES accounts(id)'
    );
  }

  migrateStoryOnlyModerationCases(database);

  const insertAccount = database.prepare(`
    INSERT OR IGNORE INTO accounts
      (id, phone_fingerprint, role, status, created_at, updated_at)
    VALUES
      (?, ?, 'member', 'active', ?, ?)
  `);
  const selectAccountByPhone = database.prepare(`
    SELECT id, role, status, created_at AS createdAt
    FROM accounts
    WHERE phone_fingerprint = ?
  `);
  const promoteAccountRole = database.prepare(`
    UPDATE accounts
    SET role = ?, updated_at = ?
    WHERE phone_fingerprint = ? AND role = 'member'
  `);
  const insertSession = database.prepare(`
    INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const selectSession = database.prepare(`
    SELECT
      sessions.token_hash AS tokenHash,
      sessions.expires_at AS expiresAt,
      accounts.id AS accountId,
      accounts.role AS role,
      accounts.status AS status
    FROM sessions
    JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token_hash = ?
  `);
  const deleteSession = database.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const deleteExpiredSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const insertStory = database.prepare([
    'INSERT INTO stories (',
    'id, author_account_id, board, title, body, response_preference,',
    'visibility, moderation_status, created_at, updated_at',
    ') VALUES (?, ?, ?, ?, ?, ?,',
    "'anonymous-public', 'pending-human-review', ?, ?)"
  ].join(' '));
  const insertStoryTag = database.prepare(
    'INSERT INTO story_tags (story_id, tag_value, position) VALUES (?, ?, ?)'
  );
  const insertModerationCase = database.prepare([
    'INSERT INTO moderation_cases (',
    'id, content_type, content_id, automated_status, human_status, created_at, updated_at',
    ") VALUES (?, ?, ?, 'not-configured', 'pending', ?, ?)"
  ].join(' '));
  const insertModerationEvent = database.prepare([
    'INSERT INTO moderation_events (',
    'id, moderation_case_id, actor_account_id, action, reason, created_at',
    ') VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));
  const selectStoryForAccount = database.prepare([
    'SELECT stories.id AS id, stories.board AS board, stories.title AS title,',
    'stories.body AS content, stories.response_preference AS responsePreference,',
    'stories.visibility AS visibility,',
    'stories.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'stories.created_at AS createdAt, stories.updated_at AS updatedAt,',
    'stories.published_at AS publishedAt',
    'FROM stories JOIN moderation_cases',
    "ON moderation_cases.content_type = 'story' AND moderation_cases.content_id = stories.id",
    'WHERE stories.id = ? AND stories.author_account_id = ?'
  ].join(' '));
  const selectStoriesForAccount = database.prepare([
    'SELECT stories.id AS id, stories.board AS board, stories.title AS title,',
    'stories.body AS content, stories.response_preference AS responsePreference,',
    'stories.visibility AS visibility,',
    'stories.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'stories.created_at AS createdAt, stories.updated_at AS updatedAt,',
    'stories.published_at AS publishedAt',
    'FROM stories JOIN moderation_cases',
    "ON moderation_cases.content_type = 'story' AND moderation_cases.content_id = stories.id",
    'WHERE stories.author_account_id = ?',
    'ORDER BY stories.created_at DESC, stories.id DESC'
  ].join(' '));
  const selectStoryTags = database.prepare([
    'SELECT tag_value AS tagValue FROM story_tags',
    'WHERE story_id = ? ORDER BY position ASC'
  ].join(' '));
  const selectStoriesForModeration = database.prepare([
    'SELECT stories.id AS id, stories.board AS board, stories.title AS title,',
    'stories.body AS content, stories.response_preference AS responsePreference,',
    'stories.visibility AS visibility, stories.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'stories.created_at AS createdAt, stories.updated_at AS updatedAt,',
    'stories.published_at AS publishedAt',
    'FROM stories JOIN moderation_cases',
    "ON moderation_cases.content_type = 'story' AND moderation_cases.content_id = stories.id",
    'WHERE stories.moderation_status = ?',
    'ORDER BY stories.created_at ASC, stories.id ASC'
  ].join(' '));
  const selectStoryForModeration = database.prepare([
    'SELECT stories.id AS id, stories.board AS board, stories.title AS title,',
    'stories.body AS content, stories.response_preference AS responsePreference,',
    'stories.visibility AS visibility, stories.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'stories.created_at AS createdAt, stories.updated_at AS updatedAt,',
    'stories.published_at AS publishedAt',
    'FROM stories JOIN moderation_cases',
    "ON moderation_cases.content_type = 'story' AND moderation_cases.content_id = stories.id",
    'WHERE stories.id = ?'
  ].join(' '));
  const selectPublishedStories = database.prepare([
    'SELECT id, board, title, body AS content,',
    'response_preference AS responsePreference, published_at AS publishedAt',
    "FROM stories WHERE moderation_status = 'approved'",
    'ORDER BY published_at DESC, id DESC LIMIT ?'
  ].join(' '));
  // Table names come only from this fixed map, never from request input.
  const updateContentModeration = Object.fromEntries(
    [['story', 'stories'], ['comment', 'comments'], ['follow_up', 'follow_ups']].map(
      ([contentType, table]) => [contentType, database.prepare([
        `UPDATE ${table} SET moderation_status = ?, updated_at = ?, published_at = ?`,
        "WHERE id = ? AND moderation_status = 'pending-human-review'"
      ].join(' '))]
    )
  );
  const updateModerationCase = database.prepare([
    'UPDATE moderation_cases SET human_status = ?, decision_reason = ?,',
    'decided_at = ?, decided_by_account_id = ?, updated_at = ?',
    "WHERE content_type = ? AND content_id = ? AND human_status = 'pending'"
  ].join(' '));
  const selectModerationCaseId = database.prepare([
    'SELECT id FROM moderation_cases',
    'WHERE content_type = ? AND content_id = ?'
  ].join(' '));
  const selectStoryForInteraction = database.prepare([
    'SELECT id, author_account_id AS authorAccountId,',
    'response_preference AS responsePreference,',
    'moderation_status AS moderationStatus, published_at AS publishedAt',
    'FROM stories WHERE id = ?'
  ].join(' '));
  const insertComment = database.prepare([
    'INSERT INTO comments (',
    'id, story_id, author_account_id, response_type, body,',
    'moderation_status, created_at, updated_at',
    ") VALUES (?, ?, ?, ?, ?, 'pending-human-review', ?, ?)"
  ].join(' '));
  const commentFields = [
    'comments.id AS id, comments.story_id AS storyId,',
    'stories.title AS storyTitle,',
    'comments.response_type AS responseType, comments.body AS content,',
    'comments.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'comments.created_at AS createdAt, comments.published_at AS publishedAt'
  ].join(' ');
  const commentSource = [
    'FROM comments JOIN stories ON stories.id = comments.story_id',
    'JOIN moderation_cases',
    "ON moderation_cases.content_type = 'comment' AND moderation_cases.content_id = comments.id"
  ].join(' ');
  const selectCommentForAccount = database.prepare([
    `SELECT ${commentFields} ${commentSource}`,
    'WHERE comments.id = ? AND comments.author_account_id = ?'
  ].join(' '));
  const selectCommentsForAccount = database.prepare([
    `SELECT ${commentFields} ${commentSource}`,
    'WHERE comments.author_account_id = ?',
    'ORDER BY comments.created_at DESC, comments.id DESC'
  ].join(' '));
  // Reviewers need the story the comment answers to judge the response in context.
  const selectCommentsForModeration = database.prepare([
    `SELECT ${commentFields},`,
    'stories.body AS storyContent, stories.response_preference AS storyResponsePreference',
    commentSource,
    "WHERE comments.moderation_status = 'pending-human-review'",
    'ORDER BY comments.created_at ASC, comments.id ASC'
  ].join(' '));
  const selectCommentForModeration = database.prepare(
    `SELECT ${commentFields} ${commentSource} WHERE comments.id = ?`
  );
  const selectRecentCommentActivity = database.prepare([
    'SELECT COUNT(*) AS count, MIN(created_at) AS oldestCreatedAt FROM comments',
    'WHERE author_account_id = ? AND created_at > ?'
  ].join(' '));
  const countPendingComments = database.prepare([
    'SELECT COUNT(*) AS count FROM comments',
    "WHERE author_account_id = ? AND moderation_status = 'pending-human-review'"
  ].join(' '));
  const selectDuplicateComment = database.prepare([
    'SELECT id FROM comments',
    'WHERE author_account_id = ? AND story_id = ? AND body = ?',
    "AND moderation_status IN ('pending-human-review', 'approved') LIMIT 1"
  ].join(' '));
  const selectPublishedComments = database.prepare([
    'SELECT id, response_type AS responseType, body AS content, published_at AS publishedAt',
    "FROM comments WHERE story_id = ? AND moderation_status = 'approved'",
    'ORDER BY published_at ASC, id ASC'
  ].join(' '));
  const insertFollowUp = database.prepare([
    'INSERT INTO follow_ups (',
    'id, story_id, author_account_id, status, body, support, visibility,',
    'moderation_status, created_at, updated_at',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join(' '));
  const followUpFields = [
    'follow_ups.id AS id, follow_ups.story_id AS storyId,',
    'stories.title AS storyTitle,',
    'follow_ups.status AS status, follow_ups.body AS content,',
    'follow_ups.support AS support, follow_ups.visibility AS visibility,',
    'follow_ups.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'follow_ups.created_at AS createdAt, follow_ups.published_at AS publishedAt'
  ].join(' ');
  // Private follow-ups never enter review, so their moderation case is optional.
  const followUpSource = [
    'FROM follow_ups JOIN stories ON stories.id = follow_ups.story_id',
    'LEFT JOIN moderation_cases',
    "ON moderation_cases.content_type = 'follow_up' AND moderation_cases.content_id = follow_ups.id"
  ].join(' ');
  const selectFollowUpForAccount = database.prepare([
    `SELECT ${followUpFields} ${followUpSource}`,
    'WHERE follow_ups.id = ? AND follow_ups.author_account_id = ?'
  ].join(' '));
  const selectFollowUpsForStoryOwner = database.prepare([
    `SELECT ${followUpFields} ${followUpSource}`,
    'WHERE follow_ups.story_id = ? AND follow_ups.author_account_id = ?',
    'ORDER BY follow_ups.created_at ASC, follow_ups.id ASC'
  ].join(' '));
  const selectFollowUpsForModeration = database.prepare([
    `SELECT ${followUpFields} ${followUpSource}`,
    "WHERE follow_ups.moderation_status = 'pending-human-review'",
    'ORDER BY follow_ups.created_at ASC, follow_ups.id ASC'
  ].join(' '));
  const selectFollowUpForModeration = database.prepare(
    `SELECT ${followUpFields} ${followUpSource} WHERE follow_ups.id = ?`
  );
  const selectPublishedFollowUps = database.prepare([
    'SELECT id, status, body AS content, support, published_at AS publishedAt',
    "FROM follow_ups WHERE story_id = ? AND moderation_status = 'approved'",
    'ORDER BY published_at ASC, id ASC'
  ].join(' '));
  const selectModerationEvents = database.prepare([
    'SELECT action, reason, created_at AS createdAt',
    'FROM moderation_events WHERE moderation_case_id = ?',
    'ORDER BY created_at ASC, rowid ASC'
  ].join(' '));

  function hydrateStory(row) {
    if (!row) return null;
    return Object.freeze({
      ...row,
      tags: selectStoryTags.all(row.id).map(({ tagValue }) => tagValue)
    });
  }

  function withTransaction(work) {
    database.exec('BEGIN IMMEDIATE');
    try {
      work();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function openModerationCase(contentType, contentId, authorAccountId, timestamp) {
    const moderationCaseId = randomUUID();
    insertModerationCase.run(moderationCaseId, contentType, contentId, timestamp, timestamp);
    insertModerationEvent.run(
      randomUUID(),
      moderationCaseId,
      authorAccountId,
      'submitted',
      null,
      timestamp
    );
  }

  // Applies one human decision to the content row, its case, and the audit log.
  // Returns false when the content is no longer pending (a stale decision).
  function moderateContent(contentType, contentId, {
    reviewerAccountId,
    decision,
    reason,
    decidedAt
  }) {
    const timestamp = decidedAt.toISOString();
    const moderationCase = selectModerationCaseId.get(contentType, contentId);
    if (!moderationCase) return false;

    database.exec('BEGIN IMMEDIATE');
    try {
      const contentUpdate = updateContentModeration[contentType].run(
        decision === 'approve' ? 'approved' : 'rejected',
        timestamp,
        decision === 'approve' ? timestamp : null,
        contentId
      );
      if (Number(contentUpdate.changes) !== 1) {
        database.exec('ROLLBACK');
        return false;
      }
      const caseUpdate = updateModerationCase.run(
        decision === 'approve' ? 'approved' : 'rejected',
        reason,
        timestamp,
        reviewerAccountId,
        timestamp,
        contentType,
        contentId
      );
      if (Number(caseUpdate.changes) !== 1) {
        throw new Error('The moderation case could not be updated.');
      }
      insertModerationEvent.run(
        randomUUID(),
        moderationCase.id,
        reviewerAccountId,
        decision === 'approve' ? 'approved' : 'rejected',
        reason,
        timestamp
      );
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // The transaction may already have been rolled back after a stale decision.
      }
      throw error;
    }
    return true;
  }

  return Object.freeze({
    findOrCreateAccount(phoneFingerprint, now = new Date(), initialRole = 'member') {
      const timestamp = now.toISOString();
      insertAccount.run(randomUUID(), phoneFingerprint, timestamp, timestamp);
      if (['moderator', 'administrator'].includes(initialRole)) {
        promoteAccountRole.run(initialRole, timestamp, phoneFingerprint);
      }
      return selectAccountByPhone.get(phoneFingerprint);
    },

    createSession({ tokenHash, accountId, createdAt, expiresAt }) {
      insertSession.run(
        tokenHash,
        accountId,
        createdAt.toISOString(),
        expiresAt.toISOString()
      );
    },

    findSession(tokenHash) {
      return selectSession.get(tokenHash) || null;
    },

    deleteSession(tokenHash) {
      if (tokenHash) deleteSession.run(tokenHash);
    },

    deleteExpiredSessions(now = new Date()) {
      deleteExpiredSessions.run(now.toISOString());
    },

    createStory({
      id,
      authorAccountId,
      board,
      title,
      content,
      responsePreference,
      tags,
      createdAt
    }) {
      const timestamp = createdAt.toISOString();
      withTransaction(() => {
        insertStory.run(
          id,
          authorAccountId,
          board,
          title,
          content,
          responsePreference,
          timestamp,
          timestamp
        );
        tags.forEach((tag, index) => insertStoryTag.run(id, tag, index));
        openModerationCase('story', id, authorAccountId, timestamp);
      });
      return hydrateStory(selectStoryForAccount.get(id, authorAccountId));
    },

    listStoriesByAccount(accountId) {
      return selectStoriesForAccount.all(accountId).map(hydrateStory);
    },

    listStoriesForModeration(status = 'pending-human-review') {
      return selectStoriesForModeration.all(status).map(hydrateStory);
    },

    moderateStory({ storyId, ...decision }) {
      return moderateContent('story', storyId, decision)
        ? hydrateStory(selectStoryForModeration.get(storyId))
        : null;
    },

    moderateComment({ commentId, ...decision }) {
      return moderateContent('comment', commentId, decision)
        ? selectCommentForModeration.get(commentId)
        : null;
    },

    moderateFollowUp({ followUpId, ...decision }) {
      return moderateContent('follow_up', followUpId, decision)
        ? selectFollowUpForModeration.get(followUpId)
        : null;
    },

    findStoryForInteraction(storyId) {
      return selectStoryForInteraction.get(storyId) || null;
    },

    createComment({ id, storyId, authorAccountId, responseType, content, createdAt }) {
      const timestamp = createdAt.toISOString();
      withTransaction(() => {
        insertComment.run(id, storyId, authorAccountId, responseType, content, timestamp, timestamp);
        openModerationCase('comment', id, authorAccountId, timestamp);
      });
      return selectCommentForAccount.get(id, authorAccountId);
    },

    // Withdrawn and rejected comments still count, so deleting cannot reset the limit.
    getRecentCommentActivity(accountId, since) {
      const activity = selectRecentCommentActivity.get(accountId, since.toISOString());
      return { count: Number(activity.count), oldestCreatedAt: activity.oldestCreatedAt };
    },

    countPendingComments(accountId) {
      return Number(countPendingComments.get(accountId).count);
    },

    hasDuplicateComment({ accountId, storyId, content }) {
      return Boolean(selectDuplicateComment.get(accountId, storyId, content));
    },

    listCommentsByAccount(accountId) {
      return selectCommentsForAccount.all(accountId);
    },

    listCommentsForModeration() {
      return selectCommentsForModeration.all();
    },

    createFollowUp({
      id,
      storyId,
      authorAccountId,
      status,
      content,
      support,
      visibility,
      createdAt
    }) {
      const timestamp = createdAt.toISOString();
      const isPublic = visibility === 'anonymous-public';
      withTransaction(() => {
        insertFollowUp.run(
          id,
          storyId,
          authorAccountId,
          status,
          content,
          support,
          visibility,
          isPublic ? 'pending-human-review' : 'private',
          timestamp,
          timestamp
        );
        if (isPublic) openModerationCase('follow_up', id, authorAccountId, timestamp);
      });
      return selectFollowUpForAccount.get(id, authorAccountId);
    },

    listFollowUpsForStoryOwner(storyId, accountId) {
      return selectFollowUpsForStoryOwner.all(storyId, accountId);
    },

    listFollowUpsForModeration() {
      return selectFollowUpsForModeration.all();
    },

    listPublishedStories(limit = 100) {
      const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
      return selectPublishedStories.all(safeLimit).map((row) => Object.freeze({
        ...hydrateStory(row),
        comments: selectPublishedComments.all(row.id),
        followUps: selectPublishedFollowUps.all(row.id)
      }));
    },

    listModerationEvents(contentId, contentType = 'story') {
      const moderationCase = selectModerationCaseId.get(contentType, contentId);
      return moderationCase ? selectModerationEvents.all(moderationCase.id) : [];
    },

    close() {
      database.close();
    }
  });
}
