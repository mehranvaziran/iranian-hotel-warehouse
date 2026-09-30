/**
 * A request-level error the API can translate straight into an HTTP status.
 *
 * Domain rules reject bad input with a Persian message the user can act on; the
 * routes only need to know that a rejection is a client problem, not a 500.
 */
export class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

/** Reject the request with `message` and an HTTP status (default 400). */
export function reject(message, statusCode = 400) {
  return new HttpError(message, statusCode);
}
