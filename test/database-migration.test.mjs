import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDatabase } from '../server/database.mjs';

test('V0.2 moderation tables are migrated without losing decisions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ffg-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'v02.sqlite');

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, phone_fingerprint TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE stories (id TEXT PRIMARY KEY, author_account_id TEXT NOT NULL REFERENCES accounts(id),
      board TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      response_preference TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'anonymous-public',
      moderation_status TEXT NOT NULL DEFAULT 'pending-human-review',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT);
    CREATE TABLE moderation_cases (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('story')),
      content_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      automated_status TEXT NOT NULL DEFAULT 'not-configured',
      human_status TEXT NOT NULL DEFAULT 'pending',
      decision_reason TEXT, decided_at TEXT, decided_by_account_id TEXT REFERENCES accounts(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE moderation_events (id TEXT PRIMARY KEY,
      moderation_case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      actor_account_id TEXT REFERENCES accounts(id),
      action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected')), reason TEXT,
      created_at TEXT NOT NULL);
    INSERT INTO accounts VALUES ('author', 'author-phone', 'member', 'active', 't', 't');
    INSERT INTO stories VALUES ('story-1', 'author', 'academic', 'Kept', 'Body', 'advice',
      'anonymous-public', 'approved', 't', 't', 't');
    INSERT INTO moderation_cases VALUES ('case-1', 'story', 'story-1', 'not-configured',
      'approved', 'Meets the guidelines.', 't', NULL, 't', 't');
    INSERT INTO moderation_events VALUES ('event-1', 'case-1', 'author', 'submitted', NULL,
      '2026-09-15T00:00:00.000Z');
  `);
  legacy.close();

  const database = createDatabase(databasePath);
  t.after(() => database.close());

  assert.deepEqual(
    database.listModerationEvents('story-1').map(({ action }) => action),
    ['submitted']
  );
  const comment = database.createComment({
    id: 'comment-1',
    storyId: 'story-1',
    authorAccountId: 'author',
    responseType: 'advice',
    content: 'One thing that helped me was a study group.',
    createdAt: new Date('2026-10-13T00:00:00.000Z')
  });
  assert.equal(comment.moderationStatus, 'pending-human-review');
  assert.deepEqual(
    database.listModerationEvents('comment-1', 'comment').map(({ action }) => action),
    ['submitted']
  );

  database.withdrawContent({
    contentType: 'story',
    contentId: 'story-1',
    accountId: 'author',
    withdrawnAt: new Date('2026-10-13T01:00:00.000Z')
  });
  assert.deepEqual(
    database.listModerationEvents('story-1').map(({ action }) => action),
    ['submitted', 'withdrawn']
  );
});
