require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { bootstrap } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    /\.web\.app$/,           // Firebase Hosting (any project)
    /\.firebaseapp\.com$/,   // Firebase Hosting (alternate)
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Bootstrap DB then mount routes ──────────────────────────────────────────
bootstrap().then(() => {
  // Import routes AFTER DB is ready so db is initialized
  const authRoutes = require('./routes/auth');
  const adminRoutes = require('./routes/admin');
  const workerRoutes = require('./routes/worker');

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/worker', workerRoutes);

  // SPA fallback
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // 404 handler
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ success: false, message: 'المسار غير موجود' });
    }
    res.status(404).send('Page not found');
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    return res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
  });

  app.listen(PORT, () => {
    console.log('');
    console.log('🏪 ==========================================');
    console.log('🏪  نظام حضور الهايبر ماركت');
    console.log('🏪 ==========================================');
    console.log(`🚀  الخادم يعمل على: http://localhost:${PORT}`);
    console.log(`📋  لوحة الأدمن:      http://localhost:${PORT}/admin/`);
    console.log(`👷  لوحة العامل:       http://localhost:${PORT}/worker/`);
    console.log('🏪 ==========================================');
    console.log('');
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
