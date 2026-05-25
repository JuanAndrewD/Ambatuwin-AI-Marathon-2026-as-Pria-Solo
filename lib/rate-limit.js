// Tiny in-memory sliding-window rate limiter, keyed by IP + bucket name.
// Good enough for a single-process demo; swap for Redis if going multi-process.

const buckets = new Map();

function clientKey(req) {
  // Express sets req.ip when "trust proxy" is on; fall back to socket address.
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Returns a middleware that allows `max` requests per `windowMs` per IP.
 * Sets standard X-RateLimit-* headers and returns 429 on overrun.
 */
function rateLimit({ name = 'default', windowMs = 60_000, max = 30 } = {}) {
  return function (req, res, next) {
    const key = `${name}:${clientKey(req)}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (buckets.get(key) || []).filter(t => t > cutoff);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((arr[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(Math.ceil((arr[0] + windowMs) / 1000)));
      return res.status(429).json({
        error: `Rate limit reached for "${name}". Try again in ${retryAfter}s.`,
        retry_after_seconds: retryAfter,
      });
    }
    arr.push(now);
    buckets.set(key, arr);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - arr.length)));
    next();
  };
}

module.exports = { rateLimit };
