'use strict';
// Company records: one SQLite file holding everything the company has to keep track of.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees(
  id TEXT PRIMARY KEY, name TEXT, model TEXT, profile TEXT,
  level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, speed INTEGER, memory INTEGER,
  stamina REAL DEFAULT 100, spent REAL DEFAULT 0, prefs TEXT DEFAULT '[]', bond TEXT DEFAULT '{}',
  hired_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY, title TEXT, brief TEXT, est TEXT, task_key TEXT, source TEXT,
  status TEXT DEFAULT 'open', assignee TEXT, mode TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, goal TEXT, slug TEXT, status TEXT DEFAULT 'running',
  stars INTEGER, reworks INTEGER DEFAULT 0, cost REAL DEFAULT 0, order_id TEXT, tag TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), finished_at TEXT);
CREATE TABLE IF NOT EXISTS roles(
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, idx INTEGER, name TEXT, description TEXT, output TEXT,
  deps TEXT, gate INTEGER, who TEXT, kind TEXT, status TEXT DEFAULT 'wait', cost REAL DEFAULT 0,
  artifacts TEXT DEFAULT '[]', started_at TEXT, finished_at TEXT);
CREATE TABLE IF NOT EXISTS pull_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT, branch TEXT, title TEXT, author TEXT, reviewer TEXT,
  status TEXT DEFAULT 'open', project_id INTEGER, role_id INTEGER, head TEXT, note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), merged_at TEXT);
CREATE TABLE IF NOT EXISTS approvals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, task TEXT, project_id INTEGER, title TEXT, detail TEXT,
  risk TEXT, decision TEXT, proposed_by TEXT, auto INTEGER DEFAULT 0, people TEXT,
  game_day INTEGER, game_time TEXT, at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS deliverables(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT, people TEXT, mode TEXT, stars INTEGER,
  reworks INTEGER, cost REAL, decisions TEXT, doc_path TEXT, project_id INTEGER, order_id TEXT,
  at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, verdict TEXT, reason TEXT, people TEXT, project_id INTEGER,
  at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS meetings(
  id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, attendees TEXT, transcript TEXT, decision TEXT, doc_path TEXT,
  at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee TEXT, task TEXT, tokens INTEGER, cost REAL, game_day INTEGER,
  at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS activity(
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, kind TEXT, text TEXT, task TEXT, game_day INTEGER, game_time TEXT,
  at TEXT DEFAULT (datetime('now','localtime')));
`;

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec(SCHEMA);
  // columns added after the first release
  const cols = new Set(db.prepare('PRAGMA table_info(ledger)').all().map(c => c.name));
  if (!cols.has('source')) db.exec("ALTER TABLE ledger ADD COLUMN source TEXT DEFAULT 'sim'");
  if (!cols.has('model')) db.exec('ALTER TABLE ledger ADD COLUMN model TEXT');
  const orderCols = new Set(db.prepare('PRAGMA table_info(orders)').all().map(c => c.name));
  if (!orderCols.has('spec')) db.exec("ALTER TABLE orders ADD COLUMN spec TEXT DEFAULT '{}'");
  if (!orderCols.has('doc_path')) db.exec('ALTER TABLE orders ADD COLUMN doc_path TEXT');
  return db;
}

const json = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

module.exports = { open, json };
