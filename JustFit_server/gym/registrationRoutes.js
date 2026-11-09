// Register your gym (Gym Hub ecosystem phase 1, 2026-11-09), mounted at /api/gym-registration in
// index.js behind requireUser and a per-user rate limit. A member starts an application, fills it
// in, adds the logo, photos and documents, and submits it for the justFit team to review
// (gym/registration.js). Every route reads the applicant from the session and answers 404 for an
// application that isn't theirs. Before migration 2026-12-27, a 503 naming it.
const express = require("express");

const { createRateLimiter, limitPerUser } = require("../rateLimit");
const registration = require("./registration");
const rules = require("./registrationRules");
const gymRules = require("./rules");
const gymProfile = require("./gymProfile");
const logos = require("./logos");
const covers = require("../fitness/covers");
const notices = require("../notifications/events");

const router = express.Router({ caseSensitive: true, strict: true });
const pool = (req) => req.app.locals.pool;
const today = () => gymRules.todayInIndia();

const MIGRATION = "Registering a gym needs the 2026-12-27-gym-registration migration on this server.";
const route = (handler) => (req, res, next) =>
  handler(req, res, next).catch((error) => {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code) || (error?.code === "WARN_DATA_TRUNCATED" && String(error.sqlMessage ?? "").includes("status"))) {
      return res.status(503).json({ error: MIGRATION });
    }
    next(error);
  });

const smallBody = express.json({ limit: "8kb" });
const documentBody = express.json({ limit: Math.ceil(rules.DOCUMENT_MAX_BYTES * (4 / 3)) + 1024 });
const photoBody = express.json({ limit: Math.ceil(gymProfile.photoLimits.maxBytes * (4 / 3)) + 1024 });
const logoBody = express.json({ limit: Math.ceil(2 * 1024 * 1024 * (4 / 3)) + 1024 });
// Changes and uploads: 60 an hour per member (GYM_REGISTRATION_CHANGES_PER_HOUR; the test server raises it)
const changeLimit = limitPerUser(createRateLimiter({ limit: Number(process.env.GYM_REGISTRATION_CHANGES_PER_HOUR) || 60, windowMs: 60 * 60 * 1000 }));
const gymId = (req) => gymRules.id(req.params.gymId, "application");

router.get("/", route(async (req, res) => {
  res.json(await registration.mine(pool(req), req.userId));
}));
router.post("/", changeLimit, smallBody, route(async (req, res) => {
  res.status(201).json(await registration.start(pool(req), req.userId, rules.applicationBody(req.body, { creating: true })));
}));
router.get("/:gymId", route(async (req, res) => {
  res.json(await registration.one(pool(req), req.userId, gymId(req)));
}));
router.patch("/:gymId", changeLimit, smallBody, route(async (req, res) => {
  const id = gymId(req);
  res.json(await registration.edit(pool(req), req.userId, id, rules.applicationBody(req.body, { creating: false })));
}));
router.post("/:gymId/submit", changeLimit, route(async (req, res) => {
  const id = gymId(req);
  const answer = await registration.submit(pool(req), req.userId, id);
  await notices.gymSubmitted(pool(req), id);
  res.json(answer);
}));

// Documents: photos or PDFs, private to the applicant and the justFit team
router.post("/:gymId/documents", changeLimit, documentBody, route(async (req, res) => {
  const id = gymId(req);
  const checked = registration.checkDocument(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.status(201).json(await registration.addDocument(pool(req), req.userId, id, checked));
}));
router.get("/:gymId/documents/:documentId", route(async (req, res) => {
  registration.sendDocument(res, await registration.ownDocument(pool(req), req.userId, gymId(req), gymRules.id(req.params.documentId, "document")));
}));
router.delete("/:gymId/documents/:documentId", changeLimit, route(async (req, res) => {
  res.json(await registration.removeDocument(pool(req), req.userId, gymId(req), gymRules.id(req.params.documentId, "document")));
}));

// The logo and the gallery (the first photo is the cover), with the gym profile's checks
router.put("/:gymId/logo", changeLimit, logoBody, route(async (req, res) => {
  const id = gymId(req);
  const checked = logos.checkLogo(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.json(await registration.setLogo(pool(req), req.userId, id, checked));
}));
router.get("/:gymId/logo", route(async (req, res) => {
  covers.send(res, await registration.ownLogo(pool(req), req.userId, gymId(req)));
}));
router.post("/:gymId/photos", changeLimit, photoBody, route(async (req, res) => {
  const id = gymId(req);
  const checked = gymProfile.checkGymPhoto(req.body);
  if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
  res.status(201).json(await registration.addPhoto(pool(req), req.userId, id, checked, today()));
}));
router.get("/:gymId/photos/:photoId", route(async (req, res) => {
  covers.send(res, await registration.ownPhoto(pool(req), req.userId, gymId(req), gymRules.id(req.params.photoId, "photo")));
}));
router.delete("/:gymId/photos/:photoId", changeLimit, route(async (req, res) => {
  res.json(await registration.removePhoto(pool(req), req.userId, gymId(req), gymRules.id(req.params.photoId, "photo"), today()));
}));

module.exports = { registrationRouter: router };
