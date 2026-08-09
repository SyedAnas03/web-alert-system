// Shared helper for one-time codes (email verification at signup, and login 2FA).
// Same pattern as the password-reset token: we only ever store a HASH of the
// code, never the raw code, so a leaked database still doesn't hand out
// working codes.
const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOtp() {
  // crypto.randomInt is uniform (unlike Math.random) and cryptographically
  // sound - appropriate for anything security-relevant like this.
  const code = crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  const hash = hashOtp(code);
  const expires = new Date(Date.now() + OTP_TTL_MS);
  return { code, hash, expires };
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// Verifies a submitted code against the stored hash/expiry/purpose in one
// place, so every route checks it the same (correct) way.
function verifyOtp(user, submittedCode, expectedPurpose) {
  if (!user.otpCodeHash || !user.otpExpires || user.otpPurpose !== expectedPurpose) {
    return { ok: false, reason: "No pending code for this action. Request a new one." };
  }
  if (user.otpExpires.getTime() < Date.now()) {
    return { ok: false, reason: "That code has expired. Request a new one." };
  }
  // Constant-time comparison so response timing can't leak how many
  // characters matched.
  const submittedHash = hashOtp(String(submittedCode || "").trim());
  const a = Buffer.from(submittedHash);
  const b = Buffer.from(user.otpCodeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "Incorrect code." };
  }
  return { ok: true };
}

module.exports = { generateOtp, verifyOtp, OTP_TTL_MS };
