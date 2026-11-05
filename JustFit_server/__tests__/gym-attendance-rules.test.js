// QR attendance's pure rules (gym/attendanceRules.js): the signed QR code, the geofence, the GPS
// reading's checks, the dashboard's query and the CSV export.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const att = require("../gym/attendanceRules.js");

const key = att.deriveQrKey("x".repeat(40));
const otherKey = att.deriveQrKey("y".repeat(40));
// Forma Tumkur's entrance, and points north of it (1° of latitude ≈ 111,195 m)
const gym = { id: 7, latitude: 13.3392, longitude: 77.1012, radiusM: 100 };
const north = (metres) => gym.latitude + metres / 111195;
const now = 1_800_000_000_000;
const reading = (over = {}) => ({ latitude: north(50), longitude: gym.longitude, accuracy: 20, mocked: false, capturedAt: now - 5000, ...over });

describe("attendance QR codes", () => {
  it("round-trips the payload and accepts only the current version with the right key", () => {
    const payload = att.qrPayload(key, 7, 3);
    assert.match(payload, /^justfit:\/\/attendance\?b=7&v=3&k=[A-Za-z0-9_-]{22}$/);
    const qr = att.parseQr(payload);
    assert.deepEqual([qr.gymId, qr.version], [7, 3]);
    assert.equal(att.qrMatches(key, qr, 3), true);
    assert.equal(att.qrMatches(key, qr, 4), false, "a regenerated code voids the old one");
    assert.equal(att.qrMatches(key, qr, 0), false, "no code made yet");
    assert.equal(att.qrMatches(otherKey, qr, 3), false, "another server's key");
    assert.equal(att.qrMatches(key, { ...qr, gymId: 8 }, 3), false, "another gym's id with this token");
    assert.equal(att.qrMatches(key, { ...qr, token: "A".repeat(22) }, 3), false, "a forged token");
  });

  it("refuses anything that isn't exactly a justFit attendance code", () => {
    for (const text of [
      "", "hello", "https://example.com", "justfit://attendance?b=7&v=3", "justfit://attendance?b=0&v=1&k=" + "a".repeat(22),
      "justfit://attendance?b=7&v=3&k=" + "a".repeat(21), "justfit://attendance?b=7' OR 1=1&v=3&k=" + "a".repeat(22),
      "justfit://attendance?b=7&v=3&k=" + "a".repeat(22) + "&x=1", 42, null, "j".repeat(500),
    ]) assert.throws(() => att.parseQr(text), /isn't a justFit gym QR code/, String(text).slice(0, 40));
  });

  it("names only the branch: no member data, no secret", () => {
    const payload = att.qrPayload(key, 7, 1);
    assert.doesNotMatch(payload, /phone|member|name/i);
    assert.ok(!payload.includes(key.toString("base64url")));
  });
});

describe("attendance geofence", () => {
  it("measures distances in metres", () => {
    assert.ok(Math.abs(att.distanceMeters(gym, { latitude: north(100), longitude: gym.longitude }) - 100) < 1);
    assert.equal(Math.round(att.distanceMeters(gym, gym)), 0);
  });

  it("accepts a fresh, precise reading inside the radius and answers the distance", () => {
    assert.equal(att.judgePosition(gym, reading(), { now }), 50);
    assert.equal(att.judgePosition(gym, reading({ latitude: north(99) }), { now }), 99);
  });

  it("refuses outside the radius with the agreed message, and applies a changed radius", () => {
    assert.throws(() => att.judgePosition(gym, reading({ latitude: north(150) }), { now }), (e) => e.status === 403 && e.message === att.OUTSIDE);
    assert.throws(() => att.judgePosition(gym, reading({ latitude: north(150) }), { now, checkingOut: true }), (e) => e.message === att.OUTSIDE_OUT);
    assert.equal(att.judgePosition({ ...gym, radiusM: 200 }, reading({ latitude: north(150) }), { now }), 150);
  });

  it("refuses mock, stale, future, imprecise readings, and a gym without a location", () => {
    assert.throws(() => att.judgePosition(gym, reading({ mocked: true }), { now }), /mock location/);
    assert.throws(() => att.judgePosition(gym, reading({ capturedAt: now - 3 * 60 * 1000 }), { now }), /out of date/);
    assert.throws(() => att.judgePosition(gym, reading({ capturedAt: now + 5 * 60 * 1000 }), { now }), /out of date/);
    assert.throws(() => att.judgePosition(gym, reading({ accuracy: 400 }), { now }), /too weak/);
    assert.throws(() => att.judgePosition({ ...gym, latitude: null, longitude: null }, reading(), { now }), /hasn't set its location/);
  });
});

describe("attendance inputs", () => {
  it("checks the admin's location and radius", () => {
    assert.deepEqual(att.locationBody({ latitude: 13.33921234, longitude: 77.1012, radiusM: 150 }), { latitude: 13.339212, longitude: 77.1012, radiusM: 150 });
    for (const body of [
      { latitude: 91, longitude: 77, radiusM: 100 }, { latitude: 13, longitude: 181, radiusM: 100 },
      { latitude: "13", longitude: 77, radiusM: 100 }, { latitude: 0, longitude: 0, radiusM: 100 },
      { latitude: 13, longitude: 77, radiusM: 0 }, { latitude: 13, longitude: 77, radiusM: -5 },
      { latitude: 13, longitude: 77, radiusM: 1001 }, { latitude: 13, longitude: 77, radiusM: 100.5 },
      { latitude: 13, longitude: 77, radiusM: 100, gymId: 2 }, null, [],
    ]) assert.throws(() => att.locationBody(body), (e) => e.status === 400, JSON.stringify(body));
  });

  it("checks a member's scan and reading, refusing extra fields", () => {
    const qr = att.qrPayload(key, 7, 1);
    assert.deepEqual(Object.keys(att.scanBody({ qr }, { withPosition: false })), ["qr"]);
    const body = att.scanBody({ qr, latitude: 13.3, longitude: 77.1, accuracy: 12.6, mocked: false, capturedAt: now }, { withPosition: true });
    assert.deepEqual(body.position, { latitude: 13.3, longitude: 77.1, accuracy: 13, mocked: false, capturedAt: now });
    for (const extra of [{ memberId: 1 }, { gymId: 7 }, { distance: 0 }]) {
      assert.throws(() => att.scanBody({ qr, latitude: 13.3, longitude: 77.1, accuracy: 10, capturedAt: now, ...extra }, { withPosition: true }), /fields we don't use/);
    }
    for (const bad of [{ latitude: undefined }, { accuracy: 0 }, { accuracy: "10" }, { capturedAt: "now" }, { mocked: "no" }, { latitude: Number.NaN }]) {
      assert.throws(() => att.scanBody({ qr, latitude: 13.3, longitude: 77.1, accuracy: 10, capturedAt: now, ...bad }, { withPosition: true }), (e) => e.status === 400, JSON.stringify(bad));
    }
  });

  it("reads the history's filters, defaulting to today", () => {
    assert.deepEqual(att.historyQuery({}, "2026-11-04"), { from: "2026-11-04", to: "2026-11-04", status: "all", search: "", memberId: null, page: 1 });
    assert.deepEqual(att.historyQuery({ from: "2026-11-01", to: "2026-11-04", status: "completed", search: "  Asif  K ", memberId: "12", page: "2" }, "2026-11-04"),
      { from: "2026-11-01", to: "2026-11-04", status: "completed", search: "Asif K", memberId: 12, page: 2 });
    for (const q of [
      { from: "2026-11-05", to: "2026-11-04" }, { from: "2026-02-30" }, { from: "2024-01-01", to: "2026-11-04" }, { status: "deleted" },
      { status: "inside' OR '1'='1" }, { memberId: "1 OR 1=1" }, { page: "0" }, { search: "x".repeat(61) }, { sort: "id" },
    ]) assert.throws(() => att.historyQuery(q, "2026-11-04"), (e) => e.status === 400, JSON.stringify(q));
  });

  it("works out whole minutes", () => {
    assert.equal(att.durationMinutes("2026-11-04T10:00:00Z", "2026-11-04T11:15:29Z"), 75);
    assert.equal(att.durationMinutes("2026-11-04T10:00:00Z", "2026-11-04T09:00:00Z"), 0);
  });
});

describe("attendance CSV export", () => {
  it("writes a header and rows, quoting commas and neutralising formulas", () => {
    const csv = att.toCsv([
      { date: "2026-11-04", memberCode: "FOR-TUM-0001", memberName: "Asif, Khan", checkInTime: "2026-11-04 06:05", checkOutTime: "2026-11-04 07:20", durationMin: 75, status: "completed", inSource: "qr", checkInDistanceM: 34 },
      { date: "2026-11-04", memberCode: "FOR-TUM-0002", memberName: "=HYPERLINK(\"x\")", checkInTime: "2026-11-04 18:00", checkOutTime: null, durationMin: null, status: "inside", inSource: "staff", checkInDistanceM: null },
    ]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "Date,Member ID,Member,Check-in,Check-out,Duration (min),Status,Checked in by,Distance at check-in (m)");
    assert.equal(lines[1], '2026-11-04,FOR-TUM-0001,"Asif, Khan",2026-11-04 06:05,2026-11-04 07:20,75,Completed,QR scan,34');
    assert.equal(lines[2], `2026-11-04,FOR-TUM-0002,"'=HYPERLINK(""x"")",2026-11-04 18:00,,,Inside,Staff,`);
  });
});
