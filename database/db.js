const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'attendance.db');

// sql.js is async to init (loads WASM), so we use a synchronous pattern
// by initializing once at startup and exposing a sync-like interface.

let _db = null;

/**
 * Persist the in-memory DB to disk as binary
 */
function save() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Load DB from disk if it exists, otherwise start fresh
 */
async function loadOrCreate() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }
}

/**
 * Thin synchronous-style wrapper matching the better-sqlite3 API surface
 * used throughout the routes (prepare/run/get/all).
 */
class Statement {
  constructor(sql) { this.sql = sql; }

  run(...params) {
    _db.run(this.sql, params);
    save();
    // Return lastInsertRowid (works for INSERT; 0 for UPDATE/DELETE which is fine)
    try {
      const result = _db.exec('SELECT last_insert_rowid()');
      const rowid = result.length > 0 ? result[0].values[0][0] : 0;
      return { lastInsertRowid: rowid };
    } catch (_) {
      return { lastInsertRowid: 0 };
    }
  }

  get(...params) {
    const stmt = _db.prepare(this.sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all(...params) {
    const results = [];
    const stmt = _db.prepare(this.sql);
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
}

/**
 * Execute a multi-statement SQL string (DDL, etc.)
 */
function exec(sql) {
  _db.run(sql);
  save();
}

/**
 * Create a prepared statement wrapper
 */
function prepare(sql) {
  return new Statement(sql);
}

// Export a db-like object that routes can use
const db = { prepare, exec };

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  await loadOrCreate();

  // ── Create tables ──────────────────────────────────────────────────────────
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      shift_id INTEGER,                       -- assigned shift
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER DEFAULT 100,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Settings table for app configuration
  _db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Shifts table — morning / evening shift definitions
  _db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'morning',   -- 'morning' | 'evening' | 'custom'
      start_time TEXT NOT NULL,               -- HH:MM  e.g. "08:00"
      end_time TEXT NOT NULL,                 -- HH:MM  e.g. "16:00"
      late_after_minutes INTEGER DEFAULT 15,  -- grace period before marking "late"
      color TEXT DEFAULT '#3b82f6',           -- display color
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      shift_id INTEGER,                       -- assigned shift (nullable)
      check_in DATETIME,
      check_out DATETIME,
      check_in_lat REAL,
      check_in_lng REAL,
      check_out_lat REAL,
      check_out_lng REAL,
      hours_worked REAL,
      status TEXT DEFAULT 'present',          -- 'present'|'absent'|'late'
      added_by INTEGER,                       -- NULL = self, admin user id = manual entry
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    )
  `);

  // ── Migrations: add new columns to existing tables safely ──────────────────
  try { _db.run(`ALTER TABLE attendance ADD COLUMN shift_id INTEGER`); } catch (_) {}
  try { _db.run(`ALTER TABLE attendance ADD COLUMN added_by INTEGER`); } catch (_) {}
  try { _db.run(`ALTER TABLE users ADD COLUMN shift_id INTEGER`); } catch (_) {}

  save();

  // ── Seed data ──────────────────────────────────────────────────────────────
  const adminCheck = prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminCheck) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    prepare(`INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)`).run('مدير النظام', 'admin', adminHash, 'admin');

    const workerHash = bcrypt.hashSync('123456', 10);
    const workers = [
      { name: 'أحمد محمد', username: 'worker1' },
      { name: 'محمد علي', username: 'worker2' },
      { name: 'خالد عمر', username: 'worker3' },
    ];
    for (const w of workers) {
      prepare(`INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'worker')`).run(w.name, w.username, workerHash);
    }
    console.log('✅ Seed users created');
  }

  // No automatic location seed — admin adds locations manually via the panel

  // Seed default shifts
  const shiftCheck = prepare('SELECT id FROM shifts LIMIT 1').get();
  if (!shiftCheck) {
    prepare(`INSERT INTO shifts (name, type, start_time, end_time, late_after_minutes, color) VALUES (?, ?, ?, ?, ?, ?)`).run('شيفت صباحي', 'morning', '08:00', '16:00', 15, '#3b82f6');
    prepare(`INSERT INTO shifts (name, type, start_time, end_time, late_after_minutes, color) VALUES (?, ?, ?, ?, ?, ?)`).run('شيفت مسائي', 'evening', '16:00', '00:00', 15, '#f97316');
    console.log('✅ Seed shifts created');
  }

  // Seed default settings
  const geofenceSetting = prepare('SELECT key FROM settings WHERE key = ?').get('geofence_enabled');
  if (!geofenceSetting) {
    prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('geofence_enabled', 'true');
    console.log('✅ Seed settings created');
  }
}

module.exports = { db, bootstrap };
