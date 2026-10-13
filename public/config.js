// ─── API Base URL ─────────────────────────────────────────────────────────────
// In development (localhost) → empty string (uses same origin)
// In production (Firebase Hosting) → your Render backend URL
// 
// 🔴 قبل الرفع على Firebase، ضع رابط الـ backend من Render هنا:
// مثال: const RENDER_URL = 'https://intime-attendance-backend.onrender.com';

const RENDER_URL = ''; // ← ضع رابط Render هنا بعد رفع الـ backend

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''           // local dev: use same origin
  : RENDER_URL;  // production: use Render URL
