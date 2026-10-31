// Safe, structured error logging. Errors can carry things that must never reach a
// log: a MySQL error has the formatted SQL with its bound values (someone's allergies
// or health flags), and its message can quote a value ("Duplicate entry 'x@y' ...").
// So only fixed, non-sensitive fields are kept, and for database errors the message
// is dropped in favour of the code, number and SQLSTATE, which identify the problem.

const DB_ERROR = (error) => typeof error?.errno === "number" || typeof error?.sqlState === "string";

// The fields that are safe to log, and nothing else
function describeError(error) {
  if (!error || typeof error !== "object") return { name: "Error", message: String(error) };
  if (DB_ERROR(error)) {
    return {
      name: error.name ?? "DatabaseError",
      code: error.code ?? null,
      errno: error.errno ?? null,
      sqlState: error.sqlState ?? null,
      // Deliberately no message, sqlMessage or sql: they can contain user data
    };
  }
  return {
    name: error.name ?? "Error",
    code: error.code ?? null,
    message: typeof error.message === "string" ? error.message.slice(0, 300) : null,
    // Our own stack frames help debugging and hold no user data
    stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 6).join("\n") : null,
  };
}

// One line per failed request: what was asked (method and path only, never the body,
// query string, headers or token) and the safe description of what went wrong
function logRequestError(req, error) {
  const entry = { at: new Date().toISOString(), method: req.method, path: req.path, error: describeError(error) };
  console.error(JSON.stringify(entry));
}

// One line per security event worth watching (a locked sign-in code, an admin route refused,
// a rate limit hit), so the server log answers "is someone probing us?". The details are a
// flat object of safe fields: a user id, a masked phone, a path, an IP address. Never a
// token, a code, a body or a full phone number.
function logSecurityEvent(event, details = {}) {
  console.warn(JSON.stringify({ at: new Date().toISOString(), security: event, ...details }));
}

// A phone number for a log line: only its last 4 digits ("+91******6439")
function maskPhone(phone) {
  if (typeof phone !== "string" || phone.length < 4) return "unknown";
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`;
}

module.exports = { describeError, logRequestError, logSecurityEvent, maskPhone };
