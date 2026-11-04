// Gym member photos (gym/photos.js): a member photo's own limits on top of the covers' checks
// (fitness/covers.js checkPhoto). No database, no server.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const photos = require("../gym/photos.js");
const covers = require("../fitness/covers.js");
const { png, jpegHeader, webpHeader, body } = require("./e2e/images.js");

const refused = (value, status, pattern) => {
  const result = photos.checkMemberPhoto(value);
  assert.equal(result.ok, false, JSON.stringify(value).slice(0, 80));
  assert.equal(result.status, status);
  assert.match(result.error, pattern);
};

describe("gym member photos: what an upload must be", () => {
  it("accepts a square JPEG, PNG or WebP, typed from its bytes, smaller than a cover may be", () => {
    for (const [bytes, type] of [[png(200, 200), "image/png"], [jpegHeader(1080, 1080), "image/jpeg"], [webpHeader(96, 96), "image/webp"]]) {
      const result = photos.checkMemberPhoto(body(bytes, type));
      assert.equal(result.ok, true, type);
      assert.equal(result.mediaType, type);
    }
    assert.equal(covers.checkCover(body(png(200, 200), "image/png")).ok, false, "covers keep their own minimum");
  });

  it("refuses the wrong shape, type, label, size or extra fields", () => {
    refused(null, 400, /data, mediaType/);
    refused({ data: "x", mediaType: "image/png", memberId: 3 }, 400, /Unexpected field: memberId/);
    refused(body(Buffer.from("GIF89a................"), "image/gif"), 415, /JPEG, PNG or WebP/);
    refused(body(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png"), 415, /JPEG, PNG or WebP/);
    refused(body(png(200, 200), "image/jpeg"), 415, /doesn't match/);
    refused(body(png(64, 64), "image/png"), 400, /too small/);
    refused(body(jpegHeader(7000, 7000), "image/jpeg"), 400, /too big/);
    refused(body(png(200, 200, undefined, photos.photoLimits.maxBytes), "image/png"), 413, /max 3 MB/);
  });

  it("keeps member photos in their own folder, apart from the covers", () => {
    assert.match(photos.photoDir({}), /uploads[/\\]member-photos$/);
    assert.equal(photos.photoDir({ MEMBER_PHOTO_DIR: "/tmp/x" }), "/tmp/x");
    assert.notEqual(photos.photoDir({}), covers.coverDir({}));
  });
});
