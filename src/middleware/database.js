'use strict';

// Share initialization between concurrent requests, but allow recovery after a failure.
function createDatabaseMiddleware(initialize) {
  let initialization = null;
  return async function ensureDatabase(req, res, next) {
    try {
      if (!initialization) {
        initialization = Promise.resolve().then(initialize).catch(err => {
          initialization = null;
          throw err;
        });
      }
      await initialization;
      next();
    } catch {
      res.set('Retry-After', '5');
      res.status(503).json({
        error: 'Nido no puede conectar con sus datos en este momento. Vuelve a intentarlo en unos segundos.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
  };
}

module.exports = { createDatabaseMiddleware };
