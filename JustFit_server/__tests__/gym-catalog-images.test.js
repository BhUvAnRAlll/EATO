// Catalogue item images (gym/catalogImages.js): an item image's own limits on top of the covers'
// checks (fitness/covers.js checkPhoto). No database, no server.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const images = require("../gym/catalogImages.js");
const photos = require("../gym/photos.js");
const covers = require("../fitness/covers.js");
const { png, jpegHeader, webpHeader, body } = require("./e2e/images.js");

const refused = (value, status, pattern) => {
  const result = images.checkItemImage(value);
  assert.equal(result.ok, false, JSON.stringify(value).slice(0, 80));
  assert.equal(result.status, status);
  assert.match(result.error, pattern);
};

describe("catalogue images: what an upload must be", () => {
  it("accepts a JPEG, PNG or WebP of any shape, typed from its bytes", () => {
    for (const [bytes, type] of [[png(200, 120), "image/png"], [jpegHeader(1080, 1920), "image/jpeg"], [webpHeader(96, 400), "image/webp"]]) {
      const result = images.checkItemImage(body(bytes, type));
      assert.equal(result.ok, true, type);
      assert.equal(result.mediaType, type);
    }
  });

  it("refuses the wrong shape, type, label, size or extra fields", () => {
    refused(null, 400, /data, mediaType/);
    refused({ data: "x", mediaType: "image/png", itemId: 3 }, 400, /Unexpected field: itemId/);
    refused(body(Buffer.from("%PDF-1.4 ..............."), "application/pdf"), 415, /JPEG, PNG or WebP/);
    refused(body(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png"), 415, /JPEG, PNG or WebP/);
    refused(body(png(200, 200), "image/jpeg"), 415, /doesn't match/);
    refused(body(png(64, 200), "image/png"), 400, /too small/);
    refused(body(jpegHeader(7000, 100), "image/jpeg"), 400, /too big/);
    refused(body(png(200, 200, undefined, images.imageLimits.maxBytes), "image/png"), 413, /max 3 MB/);
  });

  it("keeps catalogue images in their own folder, apart from member photos and covers", () => {
    assert.match(images.imageDir({}), /uploads[/\\]catalog-images$/);
    assert.equal(images.imageDir({ CATALOG_IMAGE_DIR: "/tmp/x" }), "/tmp/x");
    assert.notEqual(images.imageDir({}), photos.photoDir({}));
    assert.notEqual(images.imageDir({}), covers.coverDir({}));
  });
});
