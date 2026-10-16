import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { log } from '../logging'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#F7A51C',
    instructions TEXT NOT NULL DEFAULT '',
    tools_json TEXT NOT NULL DEFAULT '[]',
    model TEXT NOT NULL DEFAULT 'balanced',
    mcp_json TEXT NOT NULL DEFAULT '[]',
    skills_json TEXT NOT NULL DEFAULT '[]',
    is_manager INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    agent_id TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'normal',
    sdk_session_id TEXT,
    report TEXT,
    error TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE TABLE task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  // 2 — task context + usage tracking
  `
  ALTER TABLE tasks ADD COLUMN conversation_id TEXT;
  ALTER TABLE tasks ADD COLUMN last_activity TEXT;
  ALTER TABLE tasks ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE usage (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    agent_id TEXT,
    task_id TEXT,
    conversation_id TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_usage_day ON usage(day);
  `,
  // 3 — visual workflows and schedules (stored as JSON documents)
  `
  CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    next_run_at INTEGER
  );
  `
]

export function getDb(): Database.Database {
  if (db) return db
  const file = path.join(app.getPath('userData'), 'agentcloud.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database) {
  const current = d.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    log.info(`Running database migration ${v + 1}`)
    d.transaction(() => {
      d.exec(MIGRATIONS[v])
      d.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function closeDb() {
  db?.close()
  db = null
}
