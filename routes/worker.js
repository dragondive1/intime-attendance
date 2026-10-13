const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate, requireWorker } = require('../middleware/auth');
const { validateGeofence } = require('../middleware/geofence');

// Apply auth + worker middleware to all routes
router.use(authenticate, requireWorker);

// ─── GET /api/worker/status ───────────────────────────────────────────────────
// Get today's attendance record for the logged-in worker
router.get('/status', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const record = db.prepare(`
    SELECT * FROM attendance WHERE user_id = ? AND date = ?
  `).get(req.user.id, today);

  return res.json({ success: true, data: record || null });
});

// ─── POST /api/worker/checkin ─────────────────────────────────────────────────
// Check in - validates geofence first
router.post('/checkin', validateGeofence, (req, res) => {
  const { latitude, longitude } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Check if already checked in today
  const existing = db.prepare(`
    SELECT * FROM attendance WHERE user_id = ? AND date = ?
  `).get(req.user.id, today);

  if (existing) {
    if (existing.check_in && !existing.check_out) {
      return res.status(409).json({ success: false, message: 'لقد سجلت حضورك بالفعل اليوم' });
    }
    if (existing.check_in && existing.check_out) {
      return res.status(409).json({ success: false, message: 'لقد أكملت دوامك اليوم' });
    }
  }

  // Determine if late (after 9:00 AM local time - configurable)
  const checkInHour = new Date().getHours();
  const status = checkInHour >= 9 ? 'late' : 'present';

  let record;
  if (existing && !existing.check_in) {
    // Update existing absent record
    db.prepare(`
      UPDATE attendance SET check_in = ?, check_in_lat = ?, check_in_lng = ?, status = ?
      WHERE id = ?
    `).run(now, parseFloat(latitude), parseFloat(longitude), status, existing.id);
    record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
  } else {
    // Create new attendance record
    const result = db.prepare(`
      INSERT INTO attendance (user_id, date, check_in, check_in_lat, check_in_lng, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, today, now, parseFloat(latitude), parseFloat(longitude), status);
    record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
  }

  return res.json({
    success: true,
    message: 'تم تسجيل حضورك بنجاح',
    data: record,
  });
});

// ─── POST /api/worker/checkout ────────────────────────────────────────────────
// Check out - validates geofence first
router.post('/checkout', validateGeofence, (req, res) => {
  const { latitude, longitude } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const record = db.prepare(`
    SELECT * FROM attendance WHERE user_id = ? AND date = ?
  `).get(req.user.id, today);

  if (!record || !record.check_in) {
    return res.status(400).json({ success: false, message: 'لم تسجل حضورك بعد' });
  }

  if (record.check_out) {
    return res.status(409).json({ success: false, message: 'لقد سجلت انصرافك بالفعل' });
  }

  // Calculate hours worked
  const checkInTime = new Date(record.check_in).getTime();
  const checkOutTime = new Date(now).getTime();
  const hoursWorked = parseFloat(((checkOutTime - checkInTime) / 3600000).toFixed(2));

  db.prepare(`
    UPDATE attendance
    SET check_out = ?, check_out_lat = ?, check_out_lng = ?, hours_worked = ?
    WHERE id = ?
  `).run(now, parseFloat(latitude), parseFloat(longitude), hoursWorked, record.id);

  const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(record.id);

  return res.json({
    success: true,
    message: 'تم تسجيل انصرافك بنجاح',
    data: updated,
  });
});

// ─── GET /api/worker/history ──────────────────────────────────────────────────
// Attendance history with optional month/year filter
router.get('/history', (req, res) => {
  const { month, year } = req.query;

  let query = `SELECT * FROM attendance WHERE user_id = ?`;
  const params = [req.user.id];

  if (year && month) {
    query += ` AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  } else {
    // Default: last 30 days
    query += ` AND date >= date('now', '-30 days')`;
  }

  query += ` ORDER BY date DESC`;

  const records = db.prepare(query).all(...params);
  return res.json({ success: true, data: records });
});

// ─── GET /api/worker/stats ────────────────────────────────────────────────────
// Personal stats for the current worker
router.get('/stats', (req, res) => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const monthly = db.prepare(`
    SELECT * FROM attendance
    WHERE user_id = ?
    AND strftime('%Y', date) = ?
    AND strftime('%m', date) = ?
  `).all(req.user.id, year, month);

  const totalHours = monthly.reduce((sum, r) => sum + (r.hours_worked || 0), 0);
  const workingDays = monthly.filter(r => r.status !== 'absent').length;
  const absences = monthly.filter(r => r.status === 'absent').length;

  // Average check-in time (only for days with check-in)
  const checkIns = monthly.filter(r => r.check_in);
  let avgCheckIn = null;
  if (checkIns.length > 0) {
    const totalMinutes = checkIns.reduce((sum, r) => {
      const d = new Date(r.check_in);
      return sum + d.getHours() * 60 + d.getMinutes();
    }, 0);
    const avgMinutes = Math.round(totalMinutes / checkIns.length);
    const h = Math.floor(avgMinutes / 60).toString().padStart(2, '0');
    const m = (avgMinutes % 60).toString().padStart(2, '0');
    avgCheckIn = `${h}:${m}`;
  }

  return res.json({
    success: true,
    data: {
      totalHoursThisMonth: parseFloat(totalHours.toFixed(2)),
      workingDaysThisMonth: workingDays,
      absencesThisMonth: absences,
      avgCheckInTime: avgCheckIn,
    },
  });
});

module.exports = router;
