// Program cover photos (fitness/covers.js): the upload checks, reading an image's size from its
// header, and the files on disk (in a throwaway folder). No database, no server.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const covers = require("../fitness/covers.js");
const { png, jpegHeader, webpHeader, body } = require("./e2e/images.js");

const refused = (value, status, pattern) => {
  const result = covers.checkCover(value);
  assert.equal(result.ok, false, JSON.stringify(value).slice(0, 80));
  assert.equal(result.status, status);
  assert.match(result.error, pattern);
};

describe("program covers: what an upload must be", () => {
  it("accepts a JPEG, PNG or WebP of a usable size, typed from its bytes", () => {
    for (const [bytes, type] of [[png(640, 360), "image/png"], [jpegHeader(1280, 720), "image/jpeg"], [webpHeader(1600, 900), "image/webp"]]) {
      const result = covers.checkCover(body(bytes, type));
      assert.equal(result.ok, true, type);
      assert.equal(result.mediaType, type);
      assert.equal(result.bytes.length, bytes.length);
    }
  });

  it("reads the size from each format's header", () => {
    assert.deepEqual(covers.imageSize(png(640, 360), "image/png"), { width: 640, height: 360 });
    assert.deepEqual(covers.imageSize(jpegHeader(1280, 720), "image/jpeg"), { width: 1280, height: 720 });
    assert.deepEqual(covers.imageSize(webpHeader(1600, 900), "image/webp"), { width: 1600, height: 900 });
    assert.equal(covers.imageSize(Buffer.from([0xff, 0xd8, 0x00]), "image/jpeg"), null);
  });

  it("refuses anything that isn't { data, mediaType }, or has other fields", () => {
    for (const value of [null, "x", [], {}, { data: 1, mediaType: "image/png" }]) refused(value, 400, /data, mediaType/);
    refused({ ...body(png(640, 360), "image/png"), programId: "someone-else" }, 400, /Unexpected field: programId/);
    refused({ data: "not base64!!", mediaType: "image/png" }, 400, /couldn't be read/);
  });

  it("refuses other file types, a renamed file and a mismatched label", () => {
    refused(body(Buffer.from("<svg onload=alert(1)>"), "image/png"), 415, /JPEG, PNG or WebP/);
    refused(body(Buffer.from("%PDF-1.7 a report"), "application/pdf"), 415, /JPEG, PNG or WebP/);
    refused(body(Buffer.from("GIF89a......"), "image/gif"), 415, /JPEG, PNG or WebP/);
    refused(body(png(640, 360), "image/jpeg"), 415, /doesn't match/);
  });

  it("refuses more than 2 MB, and pictures too small or too big", () => {
    refused(body(png(640, 360, undefined, covers.coverLimits.maxBytes), "image/png"), 413, /max 2 MB/);
    refused(body(png(200, 200), "image/png"), 400, /too small/);
    refused(body(jpegHeader(7000, 3000), "image/jpeg"), 400, /too big/);
    refused(body(png(1, 1).subarray(0, 20), "image/png"), 415, /couldn't be read/);
  });
});

describe("program covers: the files", () => {
  let dir, env;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-covers-"));
    env = { COVER_DIR: dir };
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("saves a cover under a new random name, reads it back and deletes it", async () => {
    const bytes = png(640, 360);
    const key = await covers.save(bytes, "image/png", env);
    assert.match(key, /^[0-9a-f-]{36}\.png$/);
    assert.notEqual(await covers.save(bytes, "image/png", env), key, "every upload gets its own file");
    const file = await covers.read(key, env);
    assert.deepEqual({ type: file.mediaType, same: Buffer.compare(file.bytes, bytes) === 0 }, { type: "image/png", same: true });
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith(".part")), false, "no half-written files left");
    await covers.remove(key, env);
    assert.equal(await covers.read(key, env), null);
    await covers.remove(key, env); // already gone is fine
  });

  it("only ever reads a cover name inside the folder", async () => {
    fs.writeFileSync(path.join(dir, "secret.txt"), "not a cover");
    for (const key of ["../../.env", "secret.txt", "/etc/passwd", `${"a".repeat(36)}.png`, "00000000-0000-0000-0000-000000000000.svg", null, 7]) {
      assert.equal(covers.isKey(key), false, String(key));
      assert.equal(await covers.read(key, env), null);
    }
  });
});
