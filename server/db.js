// db.js — SQLite storage (Node's built-in node:sqlite, no native deps).
// Tables: users, credits_ledger, jobs, settings.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'wan-saas.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS credits_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON credits_ledger(ref) WHERE ref IS NOT NULL;
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    prompt TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'cinematic',
    format TEXT NOT NULL DEFAULT '9:16',
    image_name TEXT,
    image_data TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    sample_id TEXT,
    video_url TEXT,
    worker_job_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- users ----
function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()) || null;
}
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}
function createUser(email, passwordHash, role) {
  const r = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email.toLowerCase().trim(), passwordHash, role);
  return getUserById(r.lastInsertRowid);
}

// ---- credits ----
function getBalance(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(delta), 0) AS b FROM credits_ledger WHERE user_id = ?').get(userId);
  return row.b;
}
function ledgerHasRef(ref) {
  if (!ref) return false;
  return !!db.prepare('SELECT 1 FROM credits_ledger WHERE ref = ?').get(ref);
}
function addLedger(userId, delta, reason, ref) {
  try {
    db.prepare('INSERT INTO credits_ledger (user_id, delta, reason, ref) VALUES (?, ?, ?, ?)')
      .run(userId, delta, reason, ref || null);
  } catch (e) {
    if (ref && String(e.message).includes('UNIQUE')) return false; // idempotency: already credited
    throw e;
  }
  return true;
}
function listLedger(userId, limit = 50) {
  return db.prepare('SELECT id, delta, reason, ref, created_at FROM credits_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit);
}

// ---- jobs ----
function createJob(userId, { prompt, style, format, imageName, imageData }) {
  const r = db.prepare(
    'INSERT INTO jobs (user_id, prompt, style, format, image_name, image_data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, prompt, style, format, imageName || null, imageData || null);
  return getJob(r.lastInsertRowid);
}
function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null;
}
function listJobs(userId, limit = 50) {
  return db.prepare(
    `SELECT id, prompt, style, format, image_name, status, sample_id, video_url, error, created_at, updated_at
     FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?`
  ).all(userId, limit);
}
function updateJob(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getJob(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE jobs SET ${set}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
  return getJob(id);
}
function pendingJobs() {
  return db.prepare(`SELECT * FROM jobs WHERE status IN ('queued', 'processing') ORDER BY id ASC`).all();
}

// ---- settings (key/value, owner-only) ----
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}
function getAllSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}

module.exports = {
  db, getUserByEmail, getUserById, countUsers, createUser,
  getBalance, ledgerHasRef, addLedger, listLedger,
  createJob, getJob, listJobs, updateJob, pendingJobs,
  getSetting, setSetting, getAllSettings,
};
