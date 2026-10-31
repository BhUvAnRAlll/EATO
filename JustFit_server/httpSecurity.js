// Response headers and the cross-origin policy for every answer the server gives.
//
// The justFit app is native, so browsers rarely talk to this server; these rules cost nothing
// there and close the browser-side holes for the Expo web build and anyone who opens an API
// address in a browser. Pure: no database and no network, so the rules are unit-tested.

// Headers on every response. A route may still override one (the media route sets its own
// Cache-Control, for example): res.set after this middleware wins.
function securityHeaders(req, res, next) {
  res.set({
    // The body is what its Content-Type says, never sniffed into HTML or script
    "X-Content-Type-Options": "nosniff",
    // Nothing here may be put in a frame, and a response is never a document that runs anything
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    // No path or token ever leaks to another site through the Referer header
    "Referrer-Policy": "no-referrer",
    // Personal data: never kept by a proxy or a browser cache
    "Cache-Control": "no-store",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  // Only over HTTPS (directly, or via a trusted proxy's X-Forwarded-Proto): a year of HTTPS-only
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

// Which browser origins may call the API, from the environment:
//   CORS_ORIGINS=https://admin.example.com,https://app.example.com   exactly those
//   unset in production                                               none (native apps send no Origin)
//   unset elsewhere                                                   any (Expo web on a local port)
// The app's requests carry no cookies, so credentials are never allowed.
function corsOptions(env = process.env) {
  const listed = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const origin of listed) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new Error(`CORS_ORIGINS must be origins such as https://admin.example.com, not "${origin}"`);
  }
  const origin = listed.length > 0 ? listed : env.NODE_ENV === "production" ? false : true;
  return {
    origin,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["Retry-After", "Content-Disposition"],
    maxAge: 600,
  };
}

module.exports = { securityHeaders, corsOptions };
