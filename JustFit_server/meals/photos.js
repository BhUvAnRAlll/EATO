// Photos the Super Admin uploads for meals, category tiles and banners (Admin › Orders › Meals). Checked from their bytes like
// program covers (JPEG, PNG or WebP, 2 MB, 320 × 240 to 6000 a side) and kept on the server's disk
// in MEAL_PHOTO_DIR (default uploads/meal-photos, git-ignored) under a name the server made. Members
// read them through a signed-in route that looks the name up from the meal's row.
const path = require("node:path");

const covers = require("../fitness/covers");

const mealPhotoLimits = { maxBytes: 2 * 1024 * 1024, minWidth: 320, minHeight: 240, maxSide: 6000 };
// A category tile's picture is small and roughly square; a banner is wide
const tileLimits = { maxBytes: 2 * 1024 * 1024, minWidth: 160, minHeight: 160, maxSide: 6000 };
const bannerLimits = { maxBytes: 2 * 1024 * 1024, minWidth: 600, minHeight: 300, maxSide: 6000 };
const photoDir = (env = process.env) => env.MEAL_PHOTO_DIR || path.join(__dirname, "..", "uploads", "meal-photos");
const { save, read, remove } = covers.fileStore(photoDir);

const checkMealPhoto = (body) => covers.checkPhoto(body, mealPhotoLimits);
const checkPhotoWith = (body, limits) => covers.checkPhoto(body, limits);

module.exports = { mealPhotoLimits, tileLimits, bannerLimits, photoDir, checkMealPhoto, checkPhotoWith, save, read, remove, send: covers.send };
