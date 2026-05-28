'use strict';
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

// For ICS file downloads: accepts token from ?token= query param as fallback
function authOrQuery(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {}
  }
  if (req.query.token) {
    try {
      req.user = jwt.verify(req.query.token, process.env.JWT_SECRET);
      return next();
    } catch {}
  }
  return res.status(401).json({ error: 'Token requerido' });
}

module.exports = { authMiddleware, adminMiddleware, authOrQuery };
