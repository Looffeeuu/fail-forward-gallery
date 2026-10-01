import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
      content_type TEXT NOT NULL CHECK (content_type IN ('story')),
      content_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
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
    ") VALUES (?, 'story', ?, 'not-configured', 'pending', ?, ?)"
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
  const updateStoryModeration = database.prepare([
    'UPDATE stories SET moderation_status = ?, updated_at = ?, published_at = ?',
    "WHERE id = ? AND moderation_status = 'pending-human-review'"
  ].join(' '));
  const updateModerationCase = database.prepare([
    'UPDATE moderation_cases SET human_status = ?, decision_reason = ?,',
    'decided_at = ?, decided_by_account_id = ?, updated_at = ?',
    "WHERE content_type = 'story' AND content_id = ? AND human_status = 'pending'"
  ].join(' '));
  const selectModerationCaseId = database.prepare([
    'SELECT id FROM moderation_cases',
    "WHERE content_type = 'story' AND content_id = ?"
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
      database.exec('BEGIN IMMEDIATE');
      try {
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
        const moderationCaseId = randomUUID();
        insertModerationCase.run(moderationCaseId, id, timestamp, timestamp);
        insertModerationEvent.run(
          randomUUID(),
          moderationCaseId,
          authorAccountId,
          'submitted',
          null,
          timestamp
        );
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return hydrateStory(selectStoryForAccount.get(id, authorAccountId));
    },

    listStoriesByAccount(accountId) {
      return selectStoriesForAccount.all(accountId).map(hydrateStory);
    },

    listStoriesForModeration(status = 'pending-human-review') {
      return selectStoriesForModeration.all(status).map(hydrateStory);
    },

    moderateStory({
      storyId,
      reviewerAccountId,
      decision,
      reason,
      decidedAt
    }) {
      const timestamp = decidedAt.toISOString();
      const moderationCase = selectModerationCaseId.get(storyId);
      if (!moderationCase) return null;

      database.exec('BEGIN IMMEDIATE');
      try {
        const storyUpdate = updateStoryModeration.run(
          decision === 'approve' ? 'approved' : 'rejected',
          timestamp,
          decision === 'approve' ? timestamp : null,
          storyId
        );
        if (Number(storyUpdate.changes) !== 1) {
          database.exec('ROLLBACK');
          return null;
        }
        const caseUpdate = updateModerationCase.run(
          decision === 'approve' ? 'approved' : 'rejected',
          reason,
          timestamp,
          reviewerAccountId,
          timestamp,
          storyId
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

      return hydrateStory(selectStoryForModeration.get(storyId));
    },

    listPublishedStories(limit = 100) {
      const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
      return selectPublishedStories.all(safeLimit).map(hydrateStory);
    },

    listModerationEvents(storyId) {
      const moderationCase = selectModerationCaseId.get(storyId);
      return moderationCase ? selectModerationEvents.all(moderationCase.id) : [];
    },

    close() {
      database.close();
    }
  });
}
