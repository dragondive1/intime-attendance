const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hypermarket_secret_2024';

/**
 * Middleware: verifies JWT token from Authorization header
 * Attaches decoded user payload to req.user
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'لا يوجد رمز مصادقة' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'رمز المصادقة غير صالح أو منتهي الصلاحية' });
  }
};

/**
 * Middleware: restricts route to admin role only
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'غير مصرح لك بالوصول إلى هذا المورد' });
  }
  next();
};

/**
 * Middleware: restricts route to worker role only
 */
const requireWorker = (req, res, next) => {
  if (!req.user || req.user.role !== 'worker') {
    return res.status(403).json({ success: false, message: 'غير مصرح لك بالوصول إلى هذا المورد' });
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireWorker };
