// Multer config for profile picture uploads.
// - Stores files on disk under backend/uploads/avatars (served statically in server.js)
// - Caps size at 2MB and only accepts common image types (checked by both
//   extension AND mime type, since either alone is easy to spoof)
// - Pixel-dimension checks happen after upload, in routes/auth.js, because
//   Multer only sees raw bytes, not decoded image data.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const AVATAR_DIR = path.join(__dirname, "..", "uploads", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${req.user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPG, PNG, or WEBP images are allowed."));
  }
  cb(null, true);
}

const avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
});

module.exports = avatarUpload;
module.exports.MAX_AVATAR_BYTES = MAX_AVATAR_BYTES;
