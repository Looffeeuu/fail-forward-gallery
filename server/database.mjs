import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Table names come only from this fixed map, never from request input.
const CONTENT_TABLES = Object.freeze({
  story: 'stories',
  comment: 'comments',
  follow_up: 'follow_ups'
});

function prepareForEachContentType(database, buildSql) {
  return Object.fromEntries(
    Object.entries(CONTENT_TABLES).map(([contentType, table]) => [
      contentType,
      database.prepare(buildSql(table))
    ])
  );
}

// Content kept after its author deletes their account belongs to this account,
// which can never sign in: its fingerprint is not a phone hash and it is suspended.
export const DELETED_ACCOUNT_ID = 'deleted-account';

// What each human decision does. `from` is the status the content must still
// have, so a stale or repeated decision changes nothing.
const DECISION_OUTCOMES = Object.freeze({
  approve: { from: 'pending-human-review', status: 'approved', event: 'approved', notice: 'approved' },
  reject: { from: 'pending-human-review', status: 'rejected', event: 'rejected', notice: 'rejected' },
  'safety-hold': {
    from: 'pending-human-review', status: 'safety-hold', event: 'safety-held', notice: 'safety-hold'
  },
  release: { from: 'safety-hold', status: 'approved', event: 'safety-released', notice: 'approved' },
  'reject-held': { from: 'safety-hold', status: 'rejected', event: 'rejected', notice: 'rejected' }
});

// Authors never see internal safety notes or the risk label. Instead they are
// offered care while a flagged item awaits review or is held for safety.
function forOwner(item) {
  if (!item) return item;
  const { riskSignal, ...owned } = item;
  const held = owned.moderationStatus === 'safety-hold';
  return Object.freeze({
    ...owned,
    decisionReason: held ? null : owned.decisionReason,
    careSuggested: held || (Boolean(riskSignal) && owned.moderationStatus === 'pending-human-review')
  });
}

// Shared by fresh databases and migrations, so both always build the same table.
function moderationCasesTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('story', 'comment', 'follow_up')),
      content_id TEXT NOT NULL,
      automated_status TEXT NOT NULL DEFAULT 'not-configured'
        CHECK (automated_status IN ('not-configured', 'passed', 'rejected', 'needs-human-review')),
      human_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (human_status IN ('pending', 'approved', 'rejected', 'safety-hold')),
      risk_signal TEXT,
      decision_reason TEXT,
      decided_at TEXT,
      decided_by_account_id TEXT REFERENCES accounts(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
}

function moderationEventsTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      moderation_case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      actor_account_id TEXT REFERENCES accounts(id),
      action TEXT NOT NULL CHECK (action IN (
        'submitted', 'approved', 'rejected', 'withdrawn',
        'appealed', 'appeal-upheld', 'appeal-overturned', 'removed', 'reports-dismissed',
        'safety-held', 'safety-released'
      )),
      reason TEXT,
      created_at TEXT NOT NULL
    )
  `;
}

function storiesTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
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
        CHECK (moderation_status IN (
          'pending-human-review', 'approved', 'rejected', 'withdrawn', 'safety-hold'
        )),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    )
  `;
}

function commentsTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      author_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      response_type TEXT NOT NULL
        CHECK (response_type IN ('encouragement', 'similar', 'advice')),
      body TEXT NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'pending-human-review'
        CHECK (moderation_status IN (
          'pending-human-review', 'approved', 'rejected', 'withdrawn', 'safety-hold'
        )),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    )
  `;
}

function followUpsTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
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
        CHECK (moderation_status IN (
          'pending-human-review', 'approved', 'rejected', 'private', 'withdrawn', 'safety-hold'
        )),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    )
  `;
}

function notificationsTableSql(name) {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY,
      recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'approved', 'rejected', 'appeal-overturned', 'appeal-upheld',
        'removed', 'report-actioned', 'report-dismissed', 'safety-hold'
      )),
      content_type TEXT NOT NULL CHECK (content_type IN ('story', 'comment', 'follow_up')),
      content_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    )
  `;
}

// SQLite cannot change a CHECK constraint or foreign key in place, so tables
// created by older versions are copied into a new definition once.
function rebuildTableIfOutdated(database, { name, isCurrent, createSql, columns, indexSql }) {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name);
  if (!table || isCurrent(table.sql)) return;

  const migratedName = `${name}_migrated`;
  const columnList = columns.join(', ');
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      ${createSql(migratedName)};
      INSERT INTO ${migratedName} (${columnList}) SELECT ${columnList} FROM ${name};
      DROP TABLE ${name};
      ALTER TABLE ${migratedName} RENAME TO ${name};
      ${indexSql};
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

// Each entry rebuilds a table created by an older version whose CHECK
// constraints or foreign keys no longer match; the marker is a value only the
// current definition contains. Columns are those every older version has.
function migrateTables(database) {
  const contentColumns = ['moderation_status', 'created_at', 'updated_at', 'published_at'];
  [
    {
      name: 'moderation_cases',
      marker: "'safety-hold'",
      createSql: moderationCasesTableSql,
      columns: [
        'id', 'content_type', 'content_id', 'automated_status', 'human_status',
        'decision_reason', 'decided_at', 'decided_by_account_id', 'created_at', 'updated_at'
      ],
      indexSql: `CREATE INDEX IF NOT EXISTS moderation_content_index
        ON moderation_cases(content_type, content_id)`
    },
    {
      name: 'moderation_events',
      marker: "'safety-held'",
      createSql: moderationEventsTableSql,
      columns: ['id', 'moderation_case_id', 'actor_account_id', 'action', 'reason', 'created_at'],
      indexSql: `CREATE INDEX IF NOT EXISTS moderation_events_case_index
        ON moderation_events(moderation_case_id, created_at)`
    },
    {
      name: 'stories',
      marker: "'safety-hold'",
      createSql: storiesTableSql,
      columns: [
        'id', 'author_account_id', 'board', 'title', 'body', 'response_preference', 'visibility',
        ...contentColumns
      ],
      indexSql: `CREATE INDEX IF NOT EXISTS stories_author_created_index
          ON stories(author_account_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS stories_moderation_index
          ON stories(moderation_status, created_at DESC)`
    },
    {
      name: 'comments',
      marker: "'safety-hold'",
      createSql: commentsTableSql,
      columns: ['id', 'story_id', 'author_account_id', 'response_type', 'body', ...contentColumns],
      indexSql: `CREATE INDEX IF NOT EXISTS comments_story_index
          ON comments(story_id, moderation_status, published_at);
        CREATE INDEX IF NOT EXISTS comments_author_index
          ON comments(author_account_id, created_at DESC)`
    },
    {
      name: 'follow_ups',
      marker: "'safety-hold'",
      createSql: followUpsTableSql,
      columns: [
        'id', 'story_id', 'author_account_id', 'status', 'body', 'support', 'visibility',
        ...contentColumns
      ],
      indexSql: `CREATE INDEX IF NOT EXISTS follow_ups_story_index
        ON follow_ups(story_id, created_at)`
    },
    {
      name: 'notifications',
      marker: "'safety-hold'",
      createSql: notificationsTableSql,
      columns: [
        'id', 'recipient_account_id', 'kind', 'content_type', 'content_id', 'created_at', 'read_at'
      ],
      indexSql: `CREATE INDEX IF NOT EXISTS notifications_recipient_index
        ON notifications(recipient_account_id, created_at DESC)`
    }
  ].forEach(({ marker, ...table }) => rebuildTableIfOutdated(database, {
    ...table,
    isCurrent: (sql) => sql.includes(marker)
  }));
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

    ${storiesTableSql('stories')};

    CREATE TABLE IF NOT EXISTS story_tags (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      tag_value TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (story_id, tag_value)
    );

    ${moderationCasesTableSql('moderation_cases')};

    ${moderationEventsTableSql('moderation_events')};

    -- One row per visitor per story per day. visitor_hash is keyed with a
    -- server secret and the date, so the same person cannot be linked across days.
    CREATE TABLE IF NOT EXISTS view_events (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      visitor_hash TEXT NOT NULL,
      view_date TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      PRIMARY KEY (story_id, visitor_hash, view_date)
    );

    CREATE INDEX IF NOT EXISTS view_events_time_index ON view_events(occurred_at);

    -- All-time unique daily views, kept after old view events are pruned.
    CREATE TABLE IF NOT EXISTS story_view_totals (
      story_id TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
      unique_views INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS story_recommendations (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      recommended_by_account_id TEXT NOT NULL REFERENCES accounts(id),
      created_at TEXT NOT NULL,
      removed_by_account_id TEXT REFERENCES accounts(id),
      removed_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS story_recommendations_active_index
      ON story_recommendations(story_id) WHERE removed_at IS NULL;

    ${notificationsTableSql('notifications')};

    CREATE INDEX IF NOT EXISTS notifications_recipient_index
      ON notifications(recipient_account_id, created_at DESC);

    -- A name the administrators give staff accounts, so the team list is
    -- readable without storing phone numbers. Members never get one.
    -- Which version of each policy an account agreed to, and when.
    CREATE TABLE IF NOT EXISTS policy_consents (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      policy TEXT NOT NULL CHECK (policy IN ('privacy', 'community')),
      version TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      PRIMARY KEY (account_id, policy, version)
    );

    CREATE TABLE IF NOT EXISTS staff_profiles (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_changes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      previous_role TEXT NOT NULL,
      new_role TEXT NOT NULL,
      changed_by_account_id TEXT REFERENCES accounts(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('story', 'comment', 'follow_up')),
      content_id TEXT NOT NULL,
      reporter_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reason_code TEXT NOT NULL CHECK (reason_code IN (
        'personal-information', 'harassment', 'encourages-harm', 'spam',
        'outside-boundary', 'safety-concern', 'other'
      )),
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
      resolved_by_account_id TEXT REFERENCES accounts(id),
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (content_type, content_id, reporter_account_id)
    );

    CREATE INDEX IF NOT EXISTS reports_open_index ON reports(status, content_type, content_id);
    CREATE INDEX IF NOT EXISTS reports_reporter_index ON reports(reporter_account_id, created_at);

    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      moderation_case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      appellant_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reason_code TEXT NOT NULL CHECK (reason_code IN (
        'context-misunderstood', 'no-identifying-details', 'within-guidelines', 'other'
      )),
      explanation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'upheld', 'overturned')),
      decision_reason TEXT,
      decided_by_account_id TEXT REFERENCES accounts(id),
      decided_at TEXT,
      created_at TEXT NOT NULL
    );

    ${commentsTableSql('comments')};

    ${followUpsTableSql('follow_ups')};

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

  migrateTables(database);

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
  const insertConsent = database.prepare([
    'INSERT OR IGNORE INTO policy_consents (account_id, policy, version, accepted_at)',
    'VALUES (?, ?, ?, ?)'
  ].join(' '));
  const selectConsent = database.prepare(
    'SELECT 1 FROM policy_consents WHERE account_id = ? AND policy = ? AND version = ?'
  );
  const insertDeletedAccountPlaceholder = database.prepare([
    'INSERT OR IGNORE INTO accounts (id, phone_fingerprint, role, status, created_at, updated_at)',
    "VALUES (?, ?, 'member', 'suspended', ?, ?)"
  ].join(' '));
  const selectOwnedIds = prepareForEachContentType(database, (table) => (
    `SELECT id, moderation_status AS moderationStatus FROM ${table} WHERE author_account_id = ?`
  ));
  const deleteContentById = prepareForEachContentType(database, (table) => (
    `DELETE FROM ${table} WHERE id = ?`
  ));
  const reassignContentAuthor = prepareForEachContentType(database, (table) => (
    `UPDATE ${table} SET author_account_id = ? WHERE id = ?`
  ));
  // Every other reference to an account: cleared where optional, handed to the
  // placeholder where required, so audit rows survive without naming anyone.
  const accountReferenceUpdates = [
    'UPDATE moderation_events SET actor_account_id = NULL WHERE actor_account_id = ?',
    'UPDATE moderation_cases SET decided_by_account_id = NULL WHERE decided_by_account_id = ?',
    'UPDATE appeals SET decided_by_account_id = NULL WHERE decided_by_account_id = ?',
    'UPDATE reports SET resolved_by_account_id = NULL WHERE resolved_by_account_id = ?',
    'UPDATE story_recommendations SET removed_by_account_id = NULL WHERE removed_by_account_id = ?'
  ].map((sql) => database.prepare(sql));
  const accountReferenceReassignments = [
    'UPDATE story_recommendations SET recommended_by_account_id = ? WHERE recommended_by_account_id = ?',
    'UPDATE role_changes SET account_id = ? WHERE account_id = ?',
    'UPDATE role_changes SET changed_by_account_id = ? WHERE changed_by_account_id = ?'
  ].map((sql) => database.prepare(sql));
  // Reports and notices about content that no longer exists are meaningless.
  const missingContent = [
    "(content_type = 'story' AND content_id NOT IN (SELECT id FROM stories))",
    "(content_type = 'comment' AND content_id NOT IN (SELECT id FROM comments))",
    "(content_type = 'follow_up' AND content_id NOT IN (SELECT id FROM follow_ups))"
  ].join(' OR ');
  const deleteReportsForMissingContent = database.prepare(`DELETE FROM reports WHERE ${missingContent}`);
  const deleteNotificationsForMissingContent = database.prepare(
    `DELETE FROM notifications WHERE ${missingContent}`
  );
  const deleteAccountRow = database.prepare('DELETE FROM accounts WHERE id = ?');
  const selectConsentsByAccount = database.prepare([
    'SELECT policy, version, accepted_at AS acceptedAt FROM policy_consents',
    'WHERE account_id = ? ORDER BY accepted_at ASC'
  ].join(' '));
  const selectReportsByReporter = database.prepare([
    'SELECT content_type AS contentType, content_id AS contentId, reason_code AS reasonCode,',
    'details, status, created_at AS createdAt FROM reports',
    'WHERE reporter_account_id = ? ORDER BY created_at ASC'
  ].join(' '));
  const selectAccountById = database.prepare(
    'SELECT id, role, status, created_at AS createdAt FROM accounts WHERE id = ?'
  );
  const updateAccountRole = database.prepare(
    'UPDATE accounts SET role = ?, updated_at = ? WHERE id = ?'
  );
  const upsertStaffLabel = database.prepare([
    'INSERT INTO staff_profiles (account_id, label, updated_at) VALUES (?, ?, ?)',
    'ON CONFLICT(account_id) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at'
  ].join(' '));
  const insertRoleChange = database.prepare([
    'INSERT INTO role_changes (id, account_id, previous_role, new_role, changed_by_account_id, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));
  // "Since" is when the account last gained its current role.
  const selectStaff = database.prepare([
    'SELECT accounts.id AS accountId, accounts.role AS role,',
    "COALESCE(staff_profiles.label, '') AS label,",
    '(SELECT MAX(created_at) FROM role_changes WHERE role_changes.account_id = accounts.id) AS since',
    'FROM accounts LEFT JOIN staff_profiles ON staff_profiles.account_id = accounts.id',
    "WHERE accounts.role IN ('moderator', 'administrator')",
    "ORDER BY accounts.role = 'administrator' DESC, label COLLATE NOCASE ASC"
  ].join(' '));
  const selectRoleChanges = database.prepare([
    'SELECT role_changes.id AS id, role_changes.previous_role AS previousRole,',
    'role_changes.new_role AS newRole, role_changes.created_at AS createdAt,',
    "COALESCE(subject.label, '') AS label, COALESCE(actor.label, '') AS changedByLabel,",
    'role_changes.changed_by_account_id IS NULL AS byServerOperator',
    'FROM role_changes',
    'LEFT JOIN staff_profiles subject ON subject.account_id = role_changes.account_id',
    'LEFT JOIN staff_profiles actor ON actor.account_id = role_changes.changed_by_account_id',
    'ORDER BY role_changes.created_at DESC, role_changes.id DESC LIMIT ?'
  ].join(' '));
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
    'id, content_type, content_id, automated_status, human_status, risk_signal, created_at, updated_at',
    ") VALUES (?, ?, ?, 'not-configured', 'pending', ?, ?, ?)"
  ].join(' '));
  const insertModerationEvent = database.prepare([
    'INSERT INTO moderation_events (',
    'id, moderation_case_id, actor_account_id, action, reason, created_at',
    ') VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));
  // Owner and reviewer views carry the review decision and any appeal of it.
  const appealFields = [
    'appeals.id AS appealId, appeals.status AS appealStatus,',
    'appeals.reason_code AS appealReasonCode, appeals.explanation AS appealExplanation,',
    'appeals.decision_reason AS appealDecisionReason, appeals.decided_at AS appealDecidedAt'
  ].join(' ');
  // Each decision can be appealed once. The appeal that belongs to the current
  // decision is the latest one still pending or decided no earlier than the case;
  // a later decision (such as removal after a report) makes older appeals history.
  const currentAppealId = [
    'SELECT latest.id FROM appeals latest',
    'WHERE latest.moderation_case_id = moderation_cases.id',
    'AND (latest.decided_at IS NULL OR latest.decided_at >= moderation_cases.decided_at)',
    'ORDER BY latest.created_at DESC LIMIT 1'
  ].join(' ');
  const appealSource = `LEFT JOIN appeals ON appeals.id = (${currentAppealId})`;
  const storyFields = [
    'stories.id AS id, stories.board AS board, stories.title AS title,',
    'stories.body AS content, stories.response_preference AS responsePreference,',
    'stories.visibility AS visibility, stories.moderation_status AS moderationStatus,',
    'moderation_cases.automated_status AS automatedReviewStatus,',
    'moderation_cases.human_status AS humanReviewStatus,',
    'moderation_cases.decision_reason AS decisionReason,',
    'moderation_cases.decided_at AS decidedAt,',
    'stories.created_at AS createdAt, stories.updated_at AS updatedAt,',
    `stories.published_at AS publishedAt, moderation_cases.risk_signal AS riskSignal, ${appealFields}`
  ].join(' ');
  const storySource = [
    'FROM stories JOIN moderation_cases',
    "ON moderation_cases.content_type = 'story' AND moderation_cases.content_id = stories.id",
    appealSource
  ].join(' ');
  const selectStoryForAccount = database.prepare(
    `SELECT ${storyFields} ${storySource} WHERE stories.id = ? AND stories.author_account_id = ?`
  );
  const selectStoriesForAccount = database.prepare([
    `SELECT ${storyFields} ${storySource}`,
    'WHERE stories.author_account_id = ?',
    'ORDER BY stories.created_at DESC, stories.id DESC'
  ].join(' '));
  const selectStoryTags = database.prepare([
    'SELECT tag_value AS tagValue FROM story_tags',
    'WHERE story_id = ? ORDER BY position ASC'
  ].join(' '));
  const selectStoriesForModeration = database.prepare([
    `SELECT ${storyFields} ${storySource}`,
    'WHERE stories.moderation_status = ?',
    'ORDER BY stories.created_at ASC, stories.id ASC'
  ].join(' '));
  const selectStoryForModeration = database.prepare(
    `SELECT ${storyFields} ${storySource} WHERE stories.id = ?`
  );
  const selectPublishedStories = database.prepare([
    'SELECT id, board, title, body AS content,',
    'response_preference AS responsePreference, published_at AS publishedAt',
    "FROM stories WHERE moderation_status = 'approved'",
    'ORDER BY published_at DESC, id DESC LIMIT ?'
  ].join(' '));
  const selectPublishedStoryById = database.prepare([
    'SELECT id, board, title, body AS content,',
    'response_preference AS responsePreference, published_at AS publishedAt',
    "FROM stories WHERE id = ? AND moderation_status = 'approved'"
  ].join(' '));
  const insertViewEvent = database.prepare([
    'INSERT OR IGNORE INTO view_events (story_id, visitor_hash, view_date, occurred_at)',
    'VALUES (?, ?, ?, ?)'
  ].join(' '));
  const incrementViewTotal = database.prepare([
    'INSERT INTO story_view_totals (story_id, unique_views) VALUES (?, 1)',
    'ON CONFLICT(story_id) DO UPDATE SET unique_views = unique_views + 1'
  ].join(' '));
  const deleteViewEventsBefore = database.prepare('DELETE FROM view_events WHERE occurred_at < ?');
  // Ranking inputs only ever cover stories that are public right now.
  const selectViewCountsSince = database.prepare([
    'SELECT view_events.story_id AS storyId, COUNT(*) AS count FROM view_events',
    'JOIN stories ON stories.id = view_events.story_id',
    "WHERE view_events.occurred_at > ? AND stories.moderation_status = 'approved'",
    'GROUP BY view_events.story_id'
  ].join(' '));
  const selectViewHoursSince = database.prepare([
    "SELECT view_events.story_id AS storyId, substr(view_events.occurred_at, 1, 13) AS hour,",
    'COUNT(*) AS count FROM view_events',
    'JOIN stories ON stories.id = view_events.story_id',
    "WHERE view_events.occurred_at > ? AND stories.moderation_status = 'approved'",
    'GROUP BY view_events.story_id, hour'
  ].join(' '));
  const selectCommentHoursSince = database.prepare([
    "SELECT comments.story_id AS storyId, substr(comments.published_at, 1, 13) AS hour,",
    'COUNT(*) AS count FROM comments',
    'JOIN stories ON stories.id = comments.story_id',
    "WHERE comments.moderation_status = 'approved' AND comments.published_at > ?",
    "AND stories.moderation_status = 'approved'",
    'GROUP BY comments.story_id, hour'
  ].join(' '));
  const selectApprovedCommentCounts = database.prepare([
    'SELECT comments.story_id AS storyId, COUNT(*) AS count,',
    'MAX(comments.published_at) AS latestAt FROM comments',
    'JOIN stories ON stories.id = comments.story_id',
    "WHERE comments.moderation_status = 'approved' AND stories.moderation_status = 'approved'",
    "AND stories.response_preference != 'none'",
    'GROUP BY comments.story_id'
  ].join(' '));
  const selectActiveRecommendations = database.prepare([
    'SELECT story_recommendations.story_id AS storyId, story_recommendations.reason AS reason,',
    'story_recommendations.created_at AS createdAt FROM story_recommendations',
    'JOIN stories ON stories.id = story_recommendations.story_id',
    "WHERE story_recommendations.removed_at IS NULL AND stories.moderation_status = 'approved'",
    'ORDER BY story_recommendations.created_at DESC'
  ].join(' '));
  const insertRecommendation = database.prepare([
    'INSERT INTO story_recommendations (id, story_id, reason, recommended_by_account_id, created_at)',
    'VALUES (?, ?, ?, ?, ?)'
  ].join(' '));
  const removeRecommendation = database.prepare([
    'UPDATE story_recommendations SET removed_by_account_id = ?, removed_at = ?',
    'WHERE story_id = ? AND removed_at IS NULL'
  ].join(' '));
  const selectStoryStats = database.prepare([
    'SELECT COALESCE((SELECT unique_views FROM story_view_totals WHERE story_id = ?), 0) AS totalViews,',
    '(SELECT COUNT(*) FROM view_events WHERE story_id = ? AND occurred_at > ?) AS weekViews,',
    "(SELECT COUNT(*) FROM comments WHERE story_id = ? AND moderation_status = 'approved') AS approvedComments"
  ].join(' '));
  const updateContentModeration = prepareForEachContentType(database, (table) => [
    `UPDATE ${table} SET moderation_status = ?, updated_at = ?, published_at = ?`,
    'WHERE id = ? AND moderation_status = ?'
  ].join(' '));
  const withdrawOwnedContent = prepareForEachContentType(database, (table) => [
    `UPDATE ${table} SET moderation_status = 'withdrawn', updated_at = ?`,
    "WHERE id = ? AND author_account_id = ? AND moderation_status != 'withdrawn'"
  ].join(' '));
  const publishRejectedContent = prepareForEachContentType(database, (table) => [
    `UPDATE ${table} SET moderation_status = 'approved', updated_at = ?, published_at = ?`,
    "WHERE id = ? AND moderation_status = 'rejected'"
  ].join(' '));
  const selectContentStatus = prepareForEachContentType(database, (table) => [
    `SELECT moderation_status AS moderationStatus, author_account_id AS authorAccountId`,
    `FROM ${table} WHERE id = ?`
  ].join(' '));
  const insertAppeal = database.prepare([
    'INSERT INTO appeals (',
    'id, moderation_case_id, appellant_account_id, reason_code, explanation, status, created_at',
    ") VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ].join(' '));
  const selectAppealForCase = database.prepare(
    `SELECT (${currentAppealId}) AS id FROM moderation_cases WHERE moderation_cases.id = ?`
  );
  // Whether content is public right now: approved, and for responses, on an approved story.
  const selectPublicState = {
    story: database.prepare([
      'SELECT moderation_status AS status, moderation_status AS storyStatus,',
      'author_account_id AS authorAccountId FROM stories WHERE id = ?'
    ].join(' ')),
    comment: database.prepare([
      'SELECT comments.moderation_status AS status, stories.moderation_status AS storyStatus,',
      'comments.author_account_id AS authorAccountId',
      'FROM comments JOIN stories ON stories.id = comments.story_id WHERE comments.id = ?'
    ].join(' ')),
    follow_up: database.prepare([
      'SELECT follow_ups.moderation_status AS status, stories.moderation_status AS storyStatus,',
      'follow_ups.author_account_id AS authorAccountId',
      'FROM follow_ups JOIN stories ON stories.id = follow_ups.story_id WHERE follow_ups.id = ?'
    ].join(' '))
  };
  const insertReport = database.prepare([
    'INSERT OR IGNORE INTO reports (',
    'id, content_type, content_id, reporter_account_id, reason_code, details, status, created_at',
    ") VALUES (?, ?, ?, ?, ?, ?, 'open', ?)"
  ].join(' '));
  const countReportsSince = database.prepare([
    'SELECT COUNT(*) AS count, MIN(created_at) AS oldestCreatedAt FROM reports',
    'WHERE reporter_account_id = ? AND created_at > ?'
  ].join(' '));
  // Safety concerns first, then the longest-waiting content.
  const selectReportedContent = database.prepare([
    'SELECT content_type AS contentType, content_id AS contentId,',
    'MIN(created_at) AS createdAt, COUNT(*) AS reportCount,',
    "MAX(reason_code = 'safety-concern') AS hasSafetyConcern",
    "FROM reports WHERE status = 'open' GROUP BY content_type, content_id",
    'ORDER BY hasSafetyConcern DESC, createdAt ASC'
  ].join(' '));
  const selectOpenReports = database.prepare([
    'SELECT reason_code AS reasonCode, details, created_at AS createdAt FROM reports',
    "WHERE content_type = ? AND content_id = ? AND status = 'open'",
    'ORDER BY created_at ASC, id ASC'
  ].join(' '));
  const selectOpenReporters = database.prepare([
    'SELECT DISTINCT reporter_account_id AS accountId FROM reports',
    "WHERE content_type = ? AND content_id = ? AND status = 'open'"
  ].join(' '));
  const resolveOpenReports = database.prepare([
    'UPDATE reports SET status = ?, resolved_by_account_id = ?, resolved_at = ?',
    "WHERE content_type = ? AND content_id = ? AND status = 'open'"
  ].join(' '));
  const removeApprovedContent = prepareForEachContentType(database, (table) => [
    `UPDATE ${table} SET moderation_status = ?, updated_at = ?`,
    "WHERE id = ? AND moderation_status = 'approved'"
  ].join(' '));
  const insertNotification = database.prepare([
    'INSERT INTO notifications (id, recipient_account_id, kind, content_type, content_id, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));
  // Notifications name the story they concern; comments and follow-ups use their parent story.
  const selectNotifications = database.prepare([
    'SELECT notifications.id AS id, notifications.kind AS kind,',
    'notifications.content_type AS contentType, notifications.content_id AS contentId,',
    'notifications.created_at AS createdAt, notifications.read_at AS readAt,',
    'COALESCE(own_story.title, comment_story.title, follow_up_story.title) AS storyTitle',
    'FROM notifications',
    "LEFT JOIN stories own_story ON notifications.content_type = 'story'",
    'AND own_story.id = notifications.content_id',
    "LEFT JOIN comments ON notifications.content_type = 'comment'",
    'AND comments.id = notifications.content_id',
    'LEFT JOIN stories comment_story ON comment_story.id = comments.story_id',
    "LEFT JOIN follow_ups ON notifications.content_type = 'follow_up'",
    'AND follow_ups.id = notifications.content_id',
    'LEFT JOIN stories follow_up_story ON follow_up_story.id = follow_ups.story_id',
    'WHERE notifications.recipient_account_id = ?',
    'ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT ?'
  ].join(' '));
  const countUnreadNotifications = database.prepare([
    'SELECT COUNT(*) AS count FROM notifications',
    'WHERE recipient_account_id = ? AND read_at IS NULL'
  ].join(' '));
  const markNotificationsRead = database.prepare([
    'UPDATE notifications SET read_at = ?',
    'WHERE recipient_account_id = ? AND read_at IS NULL'
  ].join(' '));
  const appealQueueFields = [
    'appeals.id AS id, appeals.reason_code AS reasonCode, appeals.explanation AS explanation,',
    'appeals.status AS status, appeals.created_at AS createdAt,',
    'moderation_cases.id AS moderationCaseId,',
    'moderation_cases.content_type AS contentType, moderation_cases.content_id AS contentId,',
    'moderation_cases.decision_reason AS originalDecisionReason,',
    'moderation_cases.decided_at AS originalDecidedAt,',
    'moderation_cases.decided_by_account_id AS originalDeciderAccountId',
    'FROM appeals JOIN moderation_cases ON moderation_cases.id = appeals.moderation_case_id'
  ].join(' ');
  const selectPendingAppeals = database.prepare(
    `SELECT ${appealQueueFields} WHERE appeals.status = 'pending' ORDER BY appeals.created_at ASC, appeals.id ASC`
  );
  const selectAppeal = database.prepare(`SELECT ${appealQueueFields} WHERE appeals.id = ?`);
  const resolveAppeal = database.prepare([
    'UPDATE appeals SET status = ?, decision_reason = ?, decided_by_account_id = ?, decided_at = ?',
    "WHERE id = ? AND status = 'pending'"
  ].join(' '));
  const updateModerationCaseById = database.prepare([
    'UPDATE moderation_cases SET human_status = ?, decision_reason = ?,',
    'decided_at = ?, decided_by_account_id = ?, updated_at = ?',
    'WHERE id = ?'
  ].join(' '));
  const updateModerationCase = database.prepare([
    'UPDATE moderation_cases SET human_status = ?, decision_reason = ?,',
    'decided_at = ?, decided_by_account_id = ?, updated_at = ?',
    'WHERE content_type = ? AND content_id = ?'
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
    'comments.created_at AS createdAt, comments.published_at AS publishedAt,',
    `moderation_cases.risk_signal AS riskSignal, ${appealFields}`
  ].join(' ');
  const commentSource = [
    'FROM comments JOIN stories ON stories.id = comments.story_id',
    'JOIN moderation_cases',
    "ON moderation_cases.content_type = 'comment' AND moderation_cases.content_id = comments.id",
    appealSource
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
    "WHERE comments.moderation_status = 'pending-human-review' AND stories.moderation_status = 'approved'",
    'ORDER BY comments.created_at ASC, comments.id ASC'
  ].join(' '));
  const selectHeldComments = database.prepare([
    `SELECT ${commentFields},`,
    'stories.body AS storyContent, stories.response_preference AS storyResponsePreference',
    commentSource,
    "WHERE comments.moderation_status = 'safety-hold'",
    'ORDER BY moderation_cases.decided_at ASC, comments.id ASC'
  ].join(' '));
  const selectCommentForModeration = database.prepare(
    `SELECT ${commentFields} ${commentSource} WHERE comments.id = ?`
  );
  // Withdrawn and rejected rows still count, so deleting cannot reset a limit.
  const selectRecentActivity = prepareForEachContentType(database, (table) => [
    `SELECT COUNT(*) AS count, MIN(created_at) AS oldestCreatedAt FROM ${table}`,
    'WHERE author_account_id = ? AND created_at > ?'
  ].join(' '));
  const countPendingContent = prepareForEachContentType(database, (table) => [
    `SELECT COUNT(*) AS count FROM ${table}`,
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
    'follow_ups.created_at AS createdAt, follow_ups.published_at AS publishedAt,',
    `moderation_cases.risk_signal AS riskSignal, ${appealFields}`
  ].join(' ');
  // Private follow-ups never enter review, so their moderation case is optional.
  const followUpSource = [
    'FROM follow_ups JOIN stories ON stories.id = follow_ups.story_id',
    'LEFT JOIN moderation_cases',
    "ON moderation_cases.content_type = 'follow_up' AND moderation_cases.content_id = follow_ups.id",
    appealSource
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
    "AND stories.moderation_status = 'approved'",
    'ORDER BY follow_ups.created_at ASC, follow_ups.id ASC'
  ].join(' '));
  const selectHeldFollowUps = database.prepare([
    `SELECT ${followUpFields} ${followUpSource}`,
    "WHERE follow_ups.moderation_status = 'safety-hold'",
    'ORDER BY moderation_cases.decided_at ASC, follow_ups.id ASC'
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

  function hydratePublishedStory(row) {
    return Object.freeze({
      ...hydrateStory(row),
      comments: selectPublishedComments.all(row.id),
      followUps: selectPublishedFollowUps.all(row.id)
    });
  }

  function selectOwnedContent(contentType, contentId, accountId) {
    if (contentType === 'story') return forOwner(hydrateStory(selectStoryForAccount.get(contentId, accountId)));
    if (contentType === 'comment') return forOwner(selectCommentForAccount.get(contentId, accountId)) || null;
    return forOwner(selectFollowUpForAccount.get(contentId, accountId)) || null;
  }

  function selectContentForModeration(contentType, contentId) {
    if (contentType === 'story') return hydrateStory(selectStoryForModeration.get(contentId));
    if (contentType === 'comment') return selectCommentForModeration.get(contentId) || null;
    return selectFollowUpForModeration.get(contentId) || null;
  }

  function applyRoleChange(account, role, changedByAccountId, timestamp) {
    if (account.role === role) return;
    updateAccountRole.run(role, timestamp, account.id);
    insertRoleChange.run(
      randomUUID(), account.id, account.role, role, changedByAccountId || null, timestamp
    );
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

  function openModerationCase(contentType, contentId, authorAccountId, timestamp, riskSignals = []) {
    const moderationCaseId = randomUUID();
    insertModerationCase.run(
      moderationCaseId,
      contentType,
      contentId,
      riskSignals.length ? riskSignals.join(',') : null,
      timestamp,
      timestamp
    );
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
    const outcome = DECISION_OUTCOMES[decision];
    const moderationCase = selectModerationCaseId.get(contentType, contentId);
    if (!outcome || !moderationCase) return false;

    database.exec('BEGIN IMMEDIATE');
    try {
      const contentUpdate = updateContentModeration[contentType].run(
        outcome.status,
        timestamp,
        outcome.status === 'approved' ? timestamp : null,
        contentId,
        outcome.from
      );
      if (Number(contentUpdate.changes) !== 1) {
        database.exec('ROLLBACK');
        return false;
      }
      const caseUpdate = updateModerationCase.run(
        outcome.status,
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
        outcome.event,
        reason,
        timestamp
      );
      notifyAuthor(contentType, contentId, outcome.notice, timestamp);
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

  // Written inside the decision's transaction, so a decision never lands without its notice.
  function notifyAuthor(contentType, contentId, kind, timestamp) {
    const content = selectContentStatus[contentType].get(contentId);
    insertNotification.run(
      randomUUID(), content.authorAccountId, kind, contentType, contentId, timestamp
    );
  }

  return Object.freeze({
    // Gives the account behind a phone fingerprint a staff label and role,
    // creating the account if that person has never signed in.
    // changedByAccountId is null when a server operator runs the staff CLI.
    setStaffRoleByPhone({ phoneFingerprint, label, role, changedByAccountId, changedAt }) {
      const timestamp = changedAt.toISOString();
      let accountId = null;
      withTransaction(() => {
        insertAccount.run(randomUUID(), phoneFingerprint, timestamp, timestamp);
        const account = selectAccountByPhone.get(phoneFingerprint);
        accountId = account.id;
        upsertStaffLabel.run(account.id, label, timestamp);
        applyRoleChange(account, role, changedByAccountId, timestamp);
      });
      return selectAccountById.get(accountId);
    },

    setStaffRole({ accountId, role, changedByAccountId, changedAt }) {
      const account = selectAccountById.get(accountId);
      if (!account) return null;
      withTransaction(() => {
        applyRoleChange(account, role, changedByAccountId, changedAt.toISOString());
      });
      return selectAccountById.get(accountId);
    },

    // The first agreement to a version is kept; agreeing again changes nothing.
    recordConsent({ accountId, policy, version, acceptedAt }) {
      insertConsent.run(accountId, policy, version, acceptedAt.toISOString());
    },

    hasConsent(accountId, policy, version) {
      return Boolean(accountId && selectConsent.get(accountId, policy, version));
    },

    // Reviewer tools use this only to keep people from reviewing their own work.
    findContentAuthor(contentType, contentId) {
      return selectContentStatus[contentType]?.get(contentId)?.authorAccountId || null;
    },

    // What a person gets when they download their data. No phone number is
    // stored, so none can be included.
    exportAccountRecords(accountId) {
      return {
        consents: selectConsentsByAccount.all(accountId),
        reportsFiled: selectReportsByReporter.all(accountId),
        notifications: selectNotifications.all(accountId, 1000)
      };
    },

    // Deletes an account in one transaction. Content that is public right now
    // may be kept, unowned, when the person asks; everything else they wrote is
    // deleted. Moderation cases and events stay, with no link to the account.
    deleteAccount({ accountId, keepPublicContent, deletedAt }) {
      const timestamp = deletedAt.toISOString();
      const summary = { deleted: 0, kept: 0 };
      withTransaction(() => {
        insertDeletedAccountPlaceholder.run(DELETED_ACCOUNT_ID, DELETED_ACCOUNT_ID, timestamp, timestamp);
        // Everything is listed before anything is removed, because deleting a
        // story also deletes the responses attached to it. Stories go first.
        const owned = ['story', 'comment', 'follow_up'].flatMap((contentType) => (
          selectOwnedIds[contentType].all(accountId).map((item) => ({ contentType, ...item }))
        ));
        owned.forEach(({ contentType, id, moderationStatus }) => {
          const keep = keepPublicContent && moderationStatus === 'approved'
            && Number(reassignContentAuthor[contentType].run(DELETED_ACCOUNT_ID, id).changes) === 1;
          if (keep) {
            summary.kept += 1;
          } else {
            deleteContentById[contentType].run(id);
            summary.deleted += 1;
          }
        });
        accountReferenceUpdates.forEach((statement) => statement.run(accountId));
        accountReferenceReassignments.forEach((statement) => statement.run(DELETED_ACCOUNT_ID, accountId));
        deleteReportsForMissingContent.run();
        deleteNotificationsForMissingContent.run();
        deleteAccountRow.run(accountId);
      });
      return summary;
    },

    findAccount(accountId) {
      return selectAccountById.get(accountId) || null;
    },

    findAccountByPhone(phoneFingerprint) {
      return selectAccountByPhone.get(phoneFingerprint) || null;
    },

    listStaff() {
      return selectStaff.all();
    },

    listRoleChanges(limit = 20) {
      return selectRoleChanges.all(limit).map((change) => ({
        ...change,
        byServerOperator: Boolean(change.byServerOperator)
      }));
    },

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
      riskSignals,
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
        openModerationCase('story', id, authorAccountId, timestamp, riskSignals);
      });
      return selectOwnedContent('story', id, authorAccountId);
    },

    listStoriesByAccount(accountId) {
      return selectStoriesForAccount.all(accountId).map((row) => forOwner(hydrateStory(row)));
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

    // Returns null when the content does not exist or belongs to someone else.
    withdrawContent({ contentType, contentId, accountId, withdrawnAt }) {
      const timestamp = withdrawnAt.toISOString();
      withTransaction(() => {
        const update = withdrawOwnedContent[contentType].run(timestamp, contentId, accountId);
        const moderationCase = selectModerationCaseId.get(contentType, contentId);
        // Private follow-ups never had a case, so only reviewed content gets an event.
        if (Number(update.changes) === 1 && moderationCase) {
          insertModerationEvent.run(
            randomUUID(), moderationCase.id, accountId, 'withdrawn', null, timestamp
          );
        }
      });
      return selectOwnedContent(contentType, contentId, accountId);
    },

    getOwnedContentState({ contentType, contentId, accountId }) {
      const content = selectContentStatus[contentType].get(contentId);
      if (!content || content.authorAccountId !== accountId) return null;
      const moderationCase = selectModerationCaseId.get(contentType, contentId);
      return {
        moderationStatus: content.moderationStatus,
        moderationCaseId: moderationCase?.id || null,
        hasAppeal: Boolean(moderationCase && selectAppealForCase.get(moderationCase.id)?.id)
      };
    },

    createAppeal({
      id,
      contentType,
      contentId,
      moderationCaseId,
      appellantAccountId,
      reasonCode,
      explanation,
      createdAt
    }) {
      const timestamp = createdAt.toISOString();
      let alreadyAppealed = false;
      withTransaction(() => {
        // Checked inside the write lock so two concurrent submissions cannot both pass.
        alreadyAppealed = Boolean(selectAppealForCase.get(moderationCaseId)?.id);
        if (alreadyAppealed) return;
        insertAppeal.run(
          id, moderationCaseId, appellantAccountId, reasonCode, explanation, timestamp
        );
        insertModerationEvent.run(
          randomUUID(), moderationCaseId, appellantAccountId, 'appealed', reasonCode, timestamp
        );
      });
      return alreadyAppealed ? null : selectOwnedContent(contentType, contentId, appellantAccountId);
    },

    // Appeals for content the author has since withdrawn are left out of the queue.
    listPendingAppeals() {
      return selectPendingAppeals.all().flatMap((appeal) => {
        const content = selectContentForModeration(appeal.contentType, appeal.contentId);
        return content?.moderationStatus === 'rejected' ? [{ ...appeal, content }] : [];
      });
    },

    findAppeal(appealId) {
      return selectAppeal.get(appealId) || null;
    },

    // Returns false when the appeal was already resolved or the content withdrawn.
    resolveAppeal({ appealId, reviewerAccountId, decision, reason, decidedAt }) {
      const timestamp = decidedAt.toISOString();
      const appeal = selectAppeal.get(appealId);
      if (!appeal) return false;

      database.exec('BEGIN IMMEDIATE');
      try {
        const overturn = decision === 'overturn';
        const appealUpdate = resolveAppeal.run(
          overturn ? 'overturned' : 'upheld', reason, reviewerAccountId, timestamp, appealId
        );
        const content = selectContentStatus[appeal.contentType].get(appeal.contentId);
        if (Number(appealUpdate.changes) !== 1 || content?.moderationStatus !== 'rejected') {
          database.exec('ROLLBACK');
          return false;
        }
        if (overturn) {
          publishRejectedContent[appeal.contentType].run(timestamp, timestamp, appeal.contentId);
          updateModerationCaseById.run(
            'approved', reason, timestamp, reviewerAccountId, timestamp, appeal.moderationCaseId
          );
        }
        insertModerationEvent.run(
          randomUUID(),
          appeal.moderationCaseId,
          reviewerAccountId,
          overturn ? 'appeal-overturned' : 'appeal-upheld',
          reason,
          timestamp
        );
        notifyAuthor(
          appeal.contentType,
          appeal.contentId,
          overturn ? 'appeal-overturned' : 'appeal-upheld',
          timestamp
        );
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return true;
    },

    getPublicState(contentType, contentId) {
      const state = selectPublicState[contentType].get(contentId);
      if (!state) return null;
      return {
        authorAccountId: state.authorAccountId,
        isPublic: state.status === 'approved' && state.storyStatus === 'approved'
      };
    },

    getRecentReportActivity(accountId, since) {
      const activity = countReportsSince.get(accountId, since.toISOString());
      return { count: Number(activity.count), oldestCreatedAt: activity.oldestCreatedAt };
    },

    // Returns false when this account already reported this content.
    createReport({ id, contentType, contentId, reporterAccountId, reasonCode, details, createdAt }) {
      const insert = insertReport.run(
        id, contentType, contentId, reporterAccountId, reasonCode, details, createdAt.toISOString()
      );
      return Number(insert.changes) === 1;
    },

    // Reports are grouped per content item; reporters' identities stay out of the queue.
    listReportedContent() {
      return selectReportedContent.all().flatMap((group) => {
        const state = selectPublicState[group.contentType].get(group.contentId);
        if (state?.status !== 'approved' || state.storyStatus !== 'approved') return [];
        return [{
          ...group,
          hasSafetyConcern: Boolean(group.hasSafetyConcern),
          content: selectContentForModeration(group.contentType, group.contentId),
          reports: selectOpenReports.all(group.contentType, group.contentId)
        }];
      });
    },

    // Removal unpublishes the content as a rejection the author can appeal.
    // Returns false when there are no open reports or the content is no longer public.
    resolveReports({ contentType, contentId, reviewerAccountId, decision, reason, decidedAt }) {
      const timestamp = decidedAt.toISOString();
      const moderationCase = selectModerationCaseId.get(contentType, contentId);
      const reporters = selectOpenReporters.all(contentType, contentId);
      if (!moderationCase || reporters.length === 0) return false;

      // Removal and safety hold both unpublish; only removal is a rejection.
      const unpublish = { remove: 'rejected', 'safety-hold': 'safety-hold' }[decision];
      const remove = Boolean(unpublish);
      database.exec('BEGIN IMMEDIATE');
      try {
        if (unpublish) {
          const removal = removeApprovedContent[contentType].run(unpublish, timestamp, contentId);
          if (Number(removal.changes) !== 1) {
            database.exec('ROLLBACK');
            return false;
          }
          updateModerationCaseById.run(
            unpublish, reason, timestamp, reviewerAccountId, timestamp, moderationCase.id
          );
          notifyAuthor(contentType, contentId, unpublish === 'rejected' ? 'removed' : 'safety-hold', timestamp);
        }
        resolveOpenReports.run(
          remove ? 'actioned' : 'dismissed', reviewerAccountId, timestamp, contentType, contentId
        );
        insertModerationEvent.run(
          randomUUID(),
          moderationCase.id,
          reviewerAccountId,
          { rejected: 'removed', 'safety-hold': 'safety-held' }[unpublish] || 'reports-dismissed',
          reason,
          timestamp
        );
        reporters.forEach(({ accountId }) => insertNotification.run(
          randomUUID(),
          accountId,
          remove ? 'report-actioned' : 'report-dismissed',
          contentType,
          contentId,
          timestamp
        ));
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return true;
    },

    listNotifications(accountId, limit = 30) {
      return {
        notifications: selectNotifications.all(accountId, limit),
        unreadCount: Number(countUnreadNotifications.get(accountId).count)
      };
    },

    markNotificationsRead(accountId, readAt) {
      markNotificationsRead.run(readAt.toISOString(), accountId);
    },

    findStoryForInteraction(storyId) {
      return selectStoryForInteraction.get(storyId) || null;
    },

    createComment({ id, storyId, authorAccountId, responseType, content, riskSignals, createdAt }) {
      const timestamp = createdAt.toISOString();
      withTransaction(() => {
        insertComment.run(id, storyId, authorAccountId, responseType, content, timestamp, timestamp);
        openModerationCase('comment', id, authorAccountId, timestamp, riskSignals);
      });
      return selectOwnedContent('comment', id, authorAccountId);
    },

    getRecentActivity(contentType, accountId, since) {
      const activity = selectRecentActivity[contentType].get(accountId, since.toISOString());
      return { count: Number(activity.count), oldestCreatedAt: activity.oldestCreatedAt };
    },

    countPending(contentType, accountId) {
      return Number(countPendingContent[contentType].get(accountId).count);
    },

    hasDuplicateComment({ accountId, storyId, content }) {
      return Boolean(selectDuplicateComment.get(accountId, storyId, content));
    },

    listCommentsByAccount(accountId) {
      return selectCommentsForAccount.all(accountId).map(forOwner);
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
      riskSignals,
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
        if (isPublic) openModerationCase('follow_up', id, authorAccountId, timestamp, riskSignals);
      });
      return selectOwnedContent('follow_up', id, authorAccountId);
    },

    listFollowUpsForStoryOwner(storyId, accountId) {
      return selectFollowUpsForStoryOwner.all(storyId, accountId).map(forOwner);
    },

    // Held items stay in front of reviewers until someone releases or rejects them.
    listHeldContent() {
      return [
        ...selectStoriesForModeration.all('safety-hold').map((row) => ({
          contentType: 'story', content: hydrateStory(row)
        })),
        ...selectHeldComments.all().map((content) => ({ contentType: 'comment', content })),
        ...selectHeldFollowUps.all().map((content) => ({ contentType: 'follow_up', content }))
      ];
    },

    listFollowUpsForModeration() {
      return selectFollowUpsForModeration.all();
    },

    listPublishedStories(limit = 100) {
      const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
      return selectPublishedStories.all(safeLimit).map(hydratePublishedStory);
    },

    listPublishedStoriesByIds(storyIds) {
      return storyIds.map((storyId) => selectPublishedStoryById.get(storyId))
        .filter(Boolean)
        .map(hydratePublishedStory);
    },

    // Returns true when this visitor's view of the story is new for the day.
    recordView({ storyId, visitorHash, viewDate, occurredAt }) {
      let counted = false;
      withTransaction(() => {
        const insert = insertViewEvent.run(storyId, visitorHash, viewDate, occurredAt.toISOString());
        counted = Number(insert.changes) === 1;
        if (counted) incrementViewTotal.run(storyId);
      });
      return counted;
    },

    pruneViewEvents(before) {
      deleteViewEventsBefore.run(before.toISOString());
    },

    getRankingInputs({ dayAgo, weekAgo, trendingSince }) {
      const since = trendingSince.toISOString();
      return {
        viewsDay: selectViewCountsSince.all(dayAgo.toISOString()),
        viewsWeek: selectViewCountsSince.all(weekAgo.toISOString()),
        viewHours: selectViewHoursSince.all(since),
        commentHours: selectCommentHoursSince.all(since),
        commentCounts: selectApprovedCommentCounts.all(),
        recommendations: selectActiveRecommendations.all()
      };
    },

    recommendStory({ id, storyId, reason, accountId, createdAt }) {
      let recommended = false;
      withTransaction(() => {
        if (!selectPublishedStoryById.get(storyId)) return;
        removeRecommendation.run(accountId, createdAt.toISOString(), storyId);
        insertRecommendation.run(id, storyId, reason, accountId, createdAt.toISOString());
        recommended = true;
      });
      return recommended;
    },

    unrecommendStory({ storyId, accountId, removedAt }) {
      return Number(removeRecommendation.run(accountId, removedAt.toISOString(), storyId).changes) === 1;
    },

    getStoryStats(storyId, weekAgo) {
      const stats = selectStoryStats.get(storyId, storyId, weekAgo.toISOString(), storyId);
      return {
        totalViews: Number(stats.totalViews),
        weekViews: Number(stats.weekViews),
        approvedComments: Number(stats.approvedComments)
      };
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
