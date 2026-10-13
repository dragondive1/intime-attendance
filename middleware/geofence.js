const { db } = require('../database/db');

/**
 * Haversine formula: calculates distance in meters between two GPS coordinates
 */
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Middleware: validates that the user's GPS coordinates are within
 * at least one of the registered geofence locations.
 * If geofence is disabled in settings, this middleware is bypassed.
 */
const validateGeofence = (req, res, next) => {
  // Check if geofence is enabled in settings
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'geofence_enabled'").get();
    if (!setting || setting.value !== 'true') {
      // Geofence disabled — allow all check-ins
      req.withinGeofence = true;
      return next();
    }
  } catch (e) {
    // If settings table doesn't exist yet, skip geofence
    req.withinGeofence = true;
    return next();
  }

  const { latitude, longitude } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      success: false,
      message: 'يجب تقديم إحداثيات GPS (latitude, longitude)'
    });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({
      success: false,
      message: 'إحداثيات GPS غير صالحة'
    });
  }

  // Fetch all active locations from the database
  const locations = db.prepare('SELECT * FROM locations').all();

  if (!locations || locations.length === 0) {
    // If no locations configured, allow check-in
    req.withinGeofence = true;
    return next();
  }

  // Check if user is within radius of ANY location, include distance info
  let closestDistance = Infinity;
  let closestLocation = null;

  const withinAny = locations.some((loc) => {
    const distance = haversineDistance(lat, lng, loc.latitude, loc.longitude);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestLocation = loc;
    }
    return distance <= loc.radius_meters;
  });

  if (!withinAny) {
    const distanceMsg = closestLocation
      ? ` (أقرب موقع: ${closestLocation.name} - ${Math.round(closestDistance)} متر)`
      : '';
    return res.status(403).json({
      success: false,
      message: `أنت خارج النطاق المسموح به${distanceMsg}`,
      data: {
        userLat: lat,
        userLng: lng,
        closestLocationName: closestLocation?.name,
        distanceMeters: Math.round(closestDistance),
        allowedRadiusMeters: closestLocation?.radius_meters
      }
    });
  }

  req.withinGeofence = true;
  next();
};

module.exports = { validateGeofence, haversineDistance };

