'use strict';

/**
 * Wraps an async Express route handler.
 *
 * Any thrown error or rejected promise is forwarded to next(err),
 * which triggers the global error handler in middleware/errorHandler.js.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someService.getData();
 *     res.json(data);
 *   }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
