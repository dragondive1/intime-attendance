const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Apply auth + admin middleware to all routes in this file
router.use(authenticate, requireAdmin);

// ─── GET /api/admin/workers ───────────────────────────────────────────────────
// List all workers with today's attendance status
router.get('/workers', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const workers = db.prepare(`
    SELECT 
      u.id, u.name, u.username, u.role, u.is_active, u.shift_id, u.created_at,
      s.name AS shift_name, s.type AS shift_type, s.start_time, s.end_time, s.color AS shift_color,
      a.id AS attendance_id, a.check_in, a.check_out, a.hours_worked, a.status AS attendance_status
    FROM users u
    LEFT JOIN shifts s ON s.id = u.shift_id
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.role = 'worker'
    ORDER BY u.name
  `).all(today);

  return res.json({ success: true, data: workers });
});

// ─── PUT /api/admin/workers/:id/shift ────────────────────────────────────────
// Assign or remove a shift from a worker
router.put('/workers/:id/shift', (req, res) => {
  const { id } = req.params;
  const { shift_id } = req.body;

  const user = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'worker'").get(id);
  if (!user) return res.status(404).json({ success: false, message: 'العامل غير موجود' });

  if (shift_id) {
    const shift = db.prepare('SELECT id FROM shifts WHERE id = ?').get(shift_id);
    if (!shift) return res.status(404).json({ success: false, message: 'الشيفت غير موجود' });
  }

  db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(shift_id || null, id);
  const updated = db.prepare(`
    SELECT u.id, u.name, u.shift_id, s.name AS shift_name, s.start_time, s.end_time, s.color AS shift_color
    FROM users u LEFT JOIN shifts s ON s.id = u.shift_id WHERE u.id = ?
  `).get(id);

  return res.json({
    success: true,
    message: shift_id ? `تم تعيين الشيفت لـ ${user.name}` : `تم إلغاء شيفت ${user.name}`,
    data: updated
  });
});

// ─── POST /api/admin/workers ──────────────────────────────────────────────────
// Add a new worker
router.post('/workers', (req, res) => {
  const { name, username, password } = req.body;

  if (!name || !username || !password) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال جميع الحقول المطلوبة' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(409).json({ success: false, message: 'اسم المستخدم مستخدم بالفعل' });
  }

  const password_hash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'worker')
  `).run(name.trim(), username.trim(), password_hash);

  const newUser = db.prepare('SELECT id, name, username, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

  return res.status(201).json({ success: true, message: 'تم إضافة العامل بنجاح', data: newUser });
});

// ─── PUT /api/admin/workers/:id ───────────────────────────────────────────────
// Update a worker
router.put('/workers/:id', (req, res) => {
  const { id } = req.params;
  const { name, username, password, is_active } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(id, 'worker');
  if (!user) {
    return res.status(404).json({ success: false, message: 'العامل غير موجود' });
  }

  // Check username uniqueness if changing
  if (username && username.trim() !== user.username) {
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), id);
    if (taken) {
      return res.status(409).json({ success: false, message: 'اسم المستخدم مستخدم بالفعل' });
    }
  }

  const updatedName = name ? name.trim() : user.name;
  const updatedUsername = username ? username.trim() : user.username;
  const updatedActive = is_active !== undefined ? (is_active ? 1 : 0) : user.is_active;
  const updatedHash = password ? bcrypt.hashSync(password, 10) : user.password_hash;

  db.prepare(`
    UPDATE users SET name = ?, username = ?, password_hash = ?, is_active = ? WHERE id = ?
  `).run(updatedName, updatedUsername, updatedHash, updatedActive, id);

  const updated = db.prepare('SELECT id, name, username, role, is_active, created_at FROM users WHERE id = ?').get(id);

  return res.json({ success: true, message: 'تم تحديث بيانات العامل بنجاح', data: updated });
});

// ─── DELETE /api/admin/workers/:id ───────────────────────────────────────────
// Delete a worker
router.delete('/workers/:id', (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(id, 'worker');
  if (!user) {
    return res.status(404).json({ success: false, message: 'العامل غير موجود' });
  }

  // Delete attendance records first, then user
  db.prepare('DELETE FROM attendance WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  return res.json({ success: true, message: 'تم حذف العامل بنجاح' });
});

// ─── GET /api/admin/attendance ────────────────────────────────────────────────
// Get attendance records with optional filters
router.get('/attendance', (req, res) => {
  const { user_id, month, year } = req.query;

  let query = `
    SELECT a.*, u.name AS worker_name, u.username
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params = [];

  if (user_id) {
    query += ' AND a.user_id = ?';
    params.push(user_id);
  }
  if (year && month) {
    query += " AND strftime('%Y', a.date) = ? AND strftime('%m', a.date) = ?";
    params.push(String(year), String(month).padStart(2, '0'));
  } else if (year) {
    query += " AND strftime('%Y', a.date) = ?";
    params.push(String(year));
  }

  query += ' ORDER BY a.date DESC';

  const records = db.prepare(query).all(...params);
  return res.json({ success: true, data: records });
});

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
// Monthly stats overview
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);

  const totalWorkers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'worker' AND is_active = 1").get().count;

  const presentToday = db.prepare(`
    SELECT COUNT(*) AS count FROM attendance WHERE date = ? AND status != 'absent'
  `).get(today).count;

  const absentToday = totalWorkers - presentToday;

  const avgHours = db.prepare(`
    SELECT AVG(hours_worked) AS avg FROM attendance
    WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
    AND hours_worked IS NOT NULL
  `).get(year, month).avg;

  return res.json({
    success: true,
    data: {
      totalWorkers,
      presentToday,
      absentToday: absentToday < 0 ? 0 : absentToday,
      avgHoursThisMonth: avgHours ? parseFloat(avgHours.toFixed(2)) : 0,
    },
  });
});

// ─── GET /api/admin/worker-stats/:id ─────────────────────────────────────────
// Detailed stats for a specific worker
router.get('/worker-stats/:id', (req, res) => {
  const { id } = req.params;
  const { month, year } = req.query;

  const now = new Date();
  const targetYear = year || String(now.getFullYear());
  const targetMonth = month || String(now.getMonth() + 1).padStart(2, '0');

  const worker = db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(id);
  if (!worker) {
    return res.status(404).json({ success: false, message: 'العامل غير موجود' });
  }

  const monthlyRecords = db.prepare(`
    SELECT * FROM attendance
    WHERE user_id = ?
    AND strftime('%Y', date) = ?
    AND strftime('%m', date) = ?
    ORDER BY date DESC
  `).all(id, targetYear, String(targetMonth).padStart(2, '0'));

  const totalHours = monthlyRecords.reduce((sum, r) => sum + (r.hours_worked || 0), 0);
  const daysPresent = monthlyRecords.filter(r => r.status !== 'absent').length;
  const daysAbsent = monthlyRecords.filter(r => r.status === 'absent').length;

  // Last 6 months summary
  const monthlySummary = db.prepare(`
    SELECT 
      strftime('%Y-%m', date) AS month,
      SUM(hours_worked) AS total_hours,
      COUNT(CASE WHEN status != 'absent' THEN 1 END) AS days_present,
      COUNT(CASE WHEN status = 'absent' THEN 1 END) AS days_absent
    FROM attendance
    WHERE user_id = ?
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month DESC
    LIMIT 6
  `).all(id);

  return res.json({
    success: true,
    data: {
      worker,
      currentMonth: {
        totalHours: parseFloat(totalHours.toFixed(2)),
        daysPresent,
        daysAbsent,
        records: monthlyRecords,
      },
      monthlySummary,
    },
  });
});

// ─── GET /api/admin/locations ─────────────────────────────────────────────────
router.get('/locations', (req, res) => {
  const locations = db.prepare('SELECT * FROM locations ORDER BY created_at DESC').all();
  return res.json({ success: true, data: locations });
});

// ─── POST /api/admin/locations ────────────────────────────────────────────────
router.post('/locations', (req, res) => {
  const { name, latitude, longitude, radius_meters } = req.body;

  if (!name || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال جميع الحقول المطلوبة' });
  }

  const result = db.prepare(`
    INSERT INTO locations (name, latitude, longitude, radius_meters, created_by) VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), parseFloat(latitude), parseFloat(longitude), parseInt(radius_meters) || 100, req.user.id);

  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ success: true, message: 'تم إضافة الموقع بنجاح', data: loc });
});

// ─── PUT /api/admin/locations/:id ────────────────────────────────────────────
router.put('/locations/:id', (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, radius_meters } = req.body;

  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!loc) {
    return res.status(404).json({ success: false, message: 'الموقع غير موجود' });
  }

  db.prepare(`
    UPDATE locations SET name = ?, latitude = ?, longitude = ?, radius_meters = ? WHERE id = ?
  `).run(
    name || loc.name,
    latitude !== undefined ? parseFloat(latitude) : loc.latitude,
    longitude !== undefined ? parseFloat(longitude) : loc.longitude,
    radius_meters !== undefined ? parseInt(radius_meters) : loc.radius_meters,
    id
  );

  const updated = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  return res.json({ success: true, message: 'تم تحديث الموقع بنجاح', data: updated });
});

// ─── DELETE /api/admin/locations/:id ─────────────────────────────────────────
router.delete('/locations/:id', (req, res) => {
  const { id } = req.params;

  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!loc) {
    return res.status(404).json({ success: false, message: 'الموقع غير موجود' });
  }

  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  return res.json({ success: true, message: 'تم حذف الموقع بنجاح' });
});

// ─── POST /api/admin/attendance/mark-absent ───────────────────────────────────
// Manually mark workers as absent for a specific date
router.post('/attendance/mark-absent', (req, res) => {
  const { date, user_ids } = req.body;

  if (!date) {
    return res.status(400).json({ success: false, message: 'يرجى تحديد التاريخ' });
  }

  // Get all active workers if no specific IDs provided
  let ids = user_ids;
  if (!ids || !ids.length) {
    ids = db.prepare("SELECT id FROM users WHERE role = 'worker' AND is_active = 1").all().map(r => r.id);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO attendance (user_id, date, status, notes)
    VALUES (?, ?, 'absent', 'غائب - تم التسجيل يدوياً')
  `);

  let count = 0;
  for (const uid of ids) {
    // Only mark absent if no record exists for that day
    const exists = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').get(uid, date);
    if (!exists) {
      insert.run(uid, date);
      count++;
    }
  }

  return res.json({ success: true, message: `تم تسجيل غياب ${count} عامل`, data: { count } });
});

// ─── GET /api/admin/export/monthly/:year/:month ───────────────────────────────
// Export monthly attendance summary as JSON
router.get('/export/monthly/:year/:month', (req, res) => {
  const { year, month } = req.params;

  const records = db.prepare(`
    SELECT 
      u.name AS worker_name, u.username,
      a.date, a.check_in, a.check_out, a.hours_worked, a.status
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    WHERE strftime('%Y', a.date) = ? AND strftime('%m', a.date) = ?
    ORDER BY u.name, a.date
  `).all(String(year), String(month).padStart(2, '0'));

  // Group by worker
  const grouped = {};
  for (const r of records) {
    if (!grouped[r.username]) {
      grouped[r.username] = { name: r.worker_name, username: r.username, records: [], totalHours: 0, daysPresent: 0, daysAbsent: 0 };
    }
    grouped[r.username].records.push(r);
    grouped[r.username].totalHours += r.hours_worked || 0;
    if (r.status !== 'absent') grouped[r.username].daysPresent++;
    else grouped[r.username].daysAbsent++;
  }

  // Round total hours
  for (const key of Object.keys(grouped)) {
    grouped[key].totalHours = parseFloat(grouped[key].totalHours.toFixed(2));
  }

  return res.json({
    success: true,
    data: {
      period: `${year}-${String(month).padStart(2, '0')}`,
      summary: Object.values(grouped),
    },
  });
});

// ─── GET /api/admin/settings ─────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const s of settings) map[s.key] = s.value;
  return res.json({ success: true, data: map });
});

// ─── PUT /api/admin/settings/geofence ────────────────────────────────────────
router.put('/settings/geofence', (req, res) => {
  const { enabled } = req.body;
  const value = enabled ? 'true' : 'false';
  const exists = db.prepare("SELECT key FROM settings WHERE key = 'geofence_enabled'").get();
  if (exists) {
    db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'geofence_enabled'").run(value);
  } else {
    db.prepare("INSERT INTO settings (key, value) VALUES ('geofence_enabled', ?)").run(value);
  }
  return res.json({
    success: true,
    message: enabled ? 'تم تفعيل التحقق من الموقع' : 'تم تعطيل التحقق من الموقع',
    data: { geofence_enabled: value }
  });
});

// ─── SHIFTS CRUD ──────────────────────────────────────────────────────────────

// GET /api/admin/shifts — list all shifts
router.get('/shifts', (req, res) => {
  const shifts = db.prepare('SELECT * FROM shifts ORDER BY type, start_time').all();
  return res.json({ success: true, data: shifts });
});

// POST /api/admin/shifts — create shift
router.post('/shifts', (req, res) => {
  const { name, type, start_time, end_time, late_after_minutes, color } = req.body;
  if (!name || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: 'الاسم ووقت البداية والنهاية مطلوبون' });
  }
  const result = db.prepare(`
    INSERT INTO shifts (name, type, start_time, end_time, late_after_minutes, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    type || 'morning',
    start_time,
    end_time,
    parseInt(late_after_minutes) || 15,
    color || '#3b82f6'
  );
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ success: true, message: 'تم إضافة الشيفت بنجاح', data: shift });
});

// PUT /api/admin/shifts/:id — update shift
router.put('/shifts/:id', (req, res) => {
  const { id } = req.params;
  const { name, type, start_time, end_time, late_after_minutes, color, is_active } = req.body;
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  if (!shift) return res.status(404).json({ success: false, message: 'الشيفت غير موجود' });

  db.prepare(`
    UPDATE shifts SET name=?, type=?, start_time=?, end_time=?, late_after_minutes=?, color=?, is_active=? WHERE id=?
  `).run(
    name ?? shift.name,
    type ?? shift.type,
    start_time ?? shift.start_time,
    end_time ?? shift.end_time,
    parseInt(late_after_minutes) ?? shift.late_after_minutes,
    color ?? shift.color,
    is_active !== undefined ? (is_active ? 1 : 0) : shift.is_active,
    id
  );
  const updated = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  return res.json({ success: true, message: 'تم تحديث الشيفت', data: updated });
});

// DELETE /api/admin/shifts/:id
router.delete('/shifts/:id', (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM shifts WHERE id = ?').get(id)) {
    return res.status(404).json({ success: false, message: 'الشيفت غير موجود' });
  }
  // Unlink attendance records that use this shift
  db.prepare('UPDATE attendance SET shift_id = NULL WHERE shift_id = ?').run(id);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  return res.json({ success: true, message: 'تم حذف الشيفت' });
});

// ─── MANUAL ATTENDANCE (Admin records for a worker) ──────────────────────────

// POST /api/admin/attendance/manual — add or update a full attendance record
router.post('/attendance/manual', (req, res) => {
  const { user_id, date, check_in_time, check_out_time, shift_id, status, notes } = req.body;

  if (!user_id || !date) {
    return res.status(400).json({ success: false, message: 'العامل والتاريخ مطلوبان' });
  }

  // Validate worker exists
  const worker = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'worker'").get(user_id);
  if (!worker) return res.status(404).json({ success: false, message: 'العامل غير موجود' });

  // Build full ISO datetime strings from date + time
  let checkInISO = null;
  let checkOutISO = null;
  let hoursWorked = null;

  if (check_in_time) {
    checkInISO = `${date}T${check_in_time}:00.000Z`;
  }
  if (check_out_time) {
    checkOutISO = `${date}T${check_out_time}:00.000Z`;
  }

  // Calculate hours if both times present
  if (checkInISO && checkOutISO) {
    const inMs = new Date(checkInISO).getTime();
    let outMs = new Date(checkOutISO).getTime();
    // Handle overnight shifts (checkout < checkin means next day)
    if (outMs < inMs) outMs += 24 * 3600 * 1000;
    hoursWorked = parseFloat(((outMs - inMs) / 3600000).toFixed(2));
  }

  // Determine status: default 'present', or explicit override
  let recordStatus = status || 'present';
  // If admin provided check_in and a shift, check late logic
  if (checkInISO && shift_id) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift_id);
    if (shift && !status) {
      const [sh, sm] = shift.start_time.split(':').map(Number);
      const shiftStart = new Date(`${date}T${shift.start_time}:00`);
      const checkIn = new Date(checkInISO);
      const lateMs = (shift.late_after_minutes || 15) * 60 * 1000;
      if (checkIn.getTime() > shiftStart.getTime() + lateMs) {
        recordStatus = 'late';
      }
    }
  }

  // Upsert: update if record exists for that day, else insert
  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(user_id, date);

  if (existing) {
    db.prepare(`
      UPDATE attendance
      SET check_in = ?, check_out = ?, hours_worked = ?, shift_id = ?, status = ?,
          added_by = ?, notes = ?
      WHERE id = ?
    `).run(checkInISO, checkOutISO, hoursWorked, shift_id || null, recordStatus, req.user.id, notes || null, existing.id);
    const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
    return res.json({ success: true, message: `تم تحديث حضور ${worker.name}`, data: updated });
  } else {
    const result = db.prepare(`
      INSERT INTO attendance (user_id, date, check_in, check_out, hours_worked, shift_id, status, added_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, date, checkInISO, checkOutISO, hoursWorked, shift_id || null, recordStatus, req.user.id, notes || null);
    const created = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ success: true, message: `تم تسجيل حضور ${worker.name} بنجاح`, data: created });
  }
});

// DELETE /api/admin/attendance/:id — delete a specific attendance record
router.delete('/attendance/:id', (req, res) => {
  const { id } = req.params;
  const rec = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  if (!rec) return res.status(404).json({ success: false, message: 'السجل غير موجود' });
  db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
  return res.json({ success: true, message: 'تم حذف السجل بنجاح' });
});

module.exports = router;

