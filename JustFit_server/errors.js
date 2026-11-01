// Safe-to-show errors: the shared handler in index.js answers with the status and the message
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}
class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = "ForbiddenError";
    this.status = 403;
  }
}

module.exports = { NotFoundError, ForbiddenError };
