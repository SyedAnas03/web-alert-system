const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const User = require("../models/User");
const protect = require("../middleware/auth");
const sendEmail = require("../utils/email");
const { isStrongPassword, PASSWORD_POLICY_MESSAGE } = require("../utils/passwordPolicy");
const avatarUpload = require("../utils/avatarUpload");
const requireRole = require("../middleware/roleCheck");
const { generateOtp, verifyOtp } = require("../utils/otp");

// A code only has 1,000,000 possible values, so the generous global API
// limiter (200 req/15min) isn't tight enough on its own to stop it being
// brute-forced. This applies specifically to the OTP-checking routes.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes - matches the OTP's own expiry window
  max: 8,
  message: { message: "Too many attempts. Please wait a few minutes and try again." },
});

// Turns a user's id/role into a signed login token. `sid` is a fresh random id
// stamped onto the user record at the same time - see the single-session note
// in middleware/auth.js for why this matters.
function generateToken(user, sid) {
  return jwt.sign({ id: user._id, role: user.role, sid }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
}

// Starts a brand-new session for a user: generates a session id, saves it as
// the ONLY valid one on their record (implicitly logging out any other
// browser/device), and returns the token built around it.
async function startSession(user) {
  const sid = crypto.randomBytes(16).toString("hex");
  user.activeSessionId = sid;
  user.lastLoginAt = new Date();
  await user.save();
  return generateToken(user, sid);
}

// A short-lived, narrow-scope token that identifies "this specific login attempt
// is mid-way through 2FA" without granting any real access - it can only ever be
// used at /login/verify-otp or /login/resend-otp, never at a protected route,
// because `protect` requires a `sid` that this token deliberately doesn't have.
function generateOtpChallengeToken(user) {
  return jwt.sign({ id: user._id, purpose: "otp-pending" }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

function verifyOtpChallengeToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET); // throws on invalid/expired
  if (decoded.purpose !== "otp-pending") throw new Error("Wrong token type.");
  return decoded;
}

async function sendOtpEmail(user, purpose) {
  const { code, hash, expires } = generateOtp();
  user.otpCodeHash = hash;
  user.otpExpires = expires;
  user.otpPurpose = purpose;
  await user.save();

  const subject = purpose === "verify-email" ? "Verify your email — Web Alert System" : "Your login code — Web Alert System";
  const body =
    purpose === "verify-email"
      ? `Your email verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't create this account, you can ignore this email.`
      : `Your login code is: ${code}\n\nThis code expires in 10 minutes. If this wasn't you, someone may have your password — consider changing it.`;

  return sendEmail(user.email, subject, body);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, groups } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "An account with that email already exists." });
    }

    // Anyone can sign up as "user", "moderator", or "admin" here for demo/testing.
    // In a real deployment, only "user" should be self-registerable - staff roles
    // should be granted by an existing admin, never trusted from client input blindly.
    const allowedRoles = ["admin", "moderator", "user"];
    const user = await User.create({
      name,
      email,
      password,
      role: allowedRoles.includes(role) ? role : "user",
      groups: groups && groups.length ? groups : ["general"],
    });

    // Accounts start unverified - no session is issued until the email is
    // confirmed with the code we're about to send.
    const emailResult = await sendOtpEmail(user, "verify-email");
    if (!emailResult.ok) {
      console.error(`[register] Could not send verification email to ${user.email}:`, emailResult.error);
    }

    res.status(201).json({
      message: "Account created. Check your email for a 6-digit verification code.",
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ message: "Registration failed.", error: err.message });
  }
});

// POST /api/auth/verify-email - confirms the signup OTP and logs the user in
router.post("/verify-email", otpLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: "Email and code are required." });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid email or code." });

    if (user.emailVerified) {
      return res.status(400).json({ message: "This email is already verified. Try logging in." });
    }

    const result = verifyOtp(user, code, "verify-email");
    if (!result.ok) return res.status(400).json({ message: result.reason });

    user.emailVerified = true;
    user.otpCodeHash = null;
    user.otpExpires = null;
    user.otpPurpose = null;

    const token = await startSession(user); // startSession() also calls save()
    res.json({ token, user: publicProfile(user) });
  } catch (err) {
    res.status(500).json({ message: "Could not verify email.", error: err.message });
  }
});

// POST /api/auth/resend-verification - re-sends the signup OTP
router.post("/resend-verification", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    // Same generic response whether or not the account exists / is already
    // verified - avoids leaking which emails have accounts on this system.
    const generic = { message: "If that account needs verifying, a new code has been sent." };
    if (!user || user.emailVerified) return res.json(generic);

    await sendOtpEmail(user, "verify-email");
    res.json(generic);
  } catch (err) {
    res.status(500).json({ message: "Could not resend code.", error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.emailVerified) {
      // Give them a fresh code right away rather than making them hunt for
      // "resend" - they clearly still want in.
      await sendOtpEmail(user, "verify-email");
      return res.status(403).json({
        message: "Please verify your email first. We've sent a new code.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }

    if (user.twoFactorEnabled) {
      const emailResult = await sendOtpEmail(user, "login");
      if (!emailResult.ok) {
        return res.status(502).json({ message: "Could not send your login code. Please try again.", error: emailResult.error });
      }
      return res.json({
        requiresOtp: true,
        challengeToken: generateOtpChallengeToken(user),
        message: "Enter the code we just emailed you to finish logging in.",
      });
    }

    const token = await startSession(user);
    res.json({ token, user: publicProfile(user) });
  } catch (err) {
    res.status(500).json({ message: "Login failed.", error: err.message });
  }
});

// POST /api/auth/login/verify-otp - completes a 2FA login
router.post("/login/verify-otp", otpLimiter, async (req, res) => {
  try {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) return res.status(400).json({ message: "Code is required." });

    let decoded;
    try {
      decoded = verifyOtpChallengeToken(challengeToken);
    } catch {
      return res.status(401).json({ message: "This login attempt has expired. Please log in again." });
    }

    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "This login attempt has expired. Please log in again." });

    const result = verifyOtp(user, code, "login");
    if (!result.ok) return res.status(400).json({ message: result.reason });

    user.otpCodeHash = null;
    user.otpExpires = null;
    user.otpPurpose = null;

    const token = await startSession(user);
    res.json({ token, user: publicProfile(user) });
  } catch (err) {
    res.status(500).json({ message: "Could not verify code.", error: err.message });
  }
});

// POST /api/auth/login/resend-otp - re-sends the login OTP for a pending 2FA login
router.post("/login/resend-otp", otpLimiter, async (req, res) => {
  try {
    const { challengeToken } = req.body;
    let decoded;
    try {
      decoded = verifyOtpChallengeToken(challengeToken);
    } catch {
      return res.status(401).json({ message: "This login attempt has expired. Please log in again." });
    }

    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "This login attempt has expired. Please log in again." });

    const emailResult = await sendOtpEmail(user, "login");
    if (!emailResult.ok) {
      return res.status(502).json({ message: "Could not send your login code.", error: emailResult.error });
    }
    res.json({ message: "A new code has been sent." });
  } catch (err) {
    res.status(500).json({ message: "Could not resend code.", error: err.message });
  }
});

// POST /api/auth/me/2fa/enable - turn on 2FA (shows the Verified badge)
router.post("/me/2fa/enable", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    user.twoFactorEnabled = true;
    await user.save();
    res.json(publicProfile(user));
  } catch (err) {
    res.status(500).json({ message: "Could not enable two-factor authentication.", error: err.message });
  }
});

// POST /api/auth/me/2fa/disable - turn off 2FA (requires password confirmation,
// since silently weakening your own account's security should never be a
// single accidental click)
router.post("/me/2fa/disable", protect, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Enter your password to confirm." });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: "Incorrect password." });

    user.twoFactorEnabled = false;
    await user.save();
    res.json(publicProfile(user));
  } catch (err) {
    res.status(500).json({ message: "Could not disable two-factor authentication.", error: err.message });
  }
});

// --- Below: routes for the logged-in user to manage their own profile ---

// Shape the fields we're willing to hand back to the client in one place, so
// every route below stays consistent (and never leaks the password hash).
function publicProfile(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    groups: user.groups,
    phone: user.phone || "",
    avatarUrl: user.avatarUrl || "",
    lastLoginAt: user.lastLoginAt,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

// GET /api/auth/me - fetch my current profile (used to refresh groups after a change)
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json(publicProfile(user));
  } catch (err) {
    res.status(500).json({ message: "Could not load profile.", error: err.message });
  }
});

// PUT /api/auth/me - update my own name, phone, and alert group subscriptions.
// Deliberately does NOT allow changing role or email here - self-service is limited
// to what's safe for a user to control themselves.
router.put("/me", protect, async (req, res) => {
  try {
    const { groups, name, phone } = req.body;
    const update = {};

    if (groups !== undefined) {
      const cleanGroups = Array.isArray(groups) ? groups.map((g) => g.trim()).filter(Boolean) : [];
      update.groups = cleanGroups.length ? cleanGroups : ["general"];
    }

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ message: "Name can't be empty." });
      if (cleanName.length > 80) return res.status(400).json({ message: "Name is too long." });
      update.name = cleanName;
    }

    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();
      // Loose on purpose - just enough to catch obvious junk, not to enforce a
      // specific country format for a student project.
      if (cleanPhone && !/^[0-9+\-()\s]{6,20}$/.test(cleanPhone)) {
        return res.status(400).json({ message: "That doesn't look like a valid phone number." });
      }
      update.phone = cleanPhone;
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });

    res.json(publicProfile(user));
  } catch (err) {
    res.status(500).json({ message: "Could not update profile.", error: err.message });
  }
});

// POST /api/auth/me/avatar - upload/replace my profile picture.
// avatarUpload (utils/avatarUpload.js) already rejects anything over the size
// limit or with a disallowed mime type before this handler even runs; here we
// only need to double-check pixel dimensions, since a small file can still
// decode to a huge image.
router.post("/me/avatar", protect, avatarUpload.single("avatar"), async (req, res) => {
  const fs = require("fs");
  const path = require("path");
  const { imageSize } = require("image-size");

  try {
    if (!req.file) return res.status(400).json({ message: "No image file was uploaded." });

    const MAX_DIMENSION = 2000; // px, either side
    let dimensions;
    try {
      dimensions = imageSize(req.file.path);
    } catch {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: "That file doesn't look like a valid image." });
    }

    if (!dimensions.width || !dimensions.height || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: `Image dimensions must be ${MAX_DIMENSION}x${MAX_DIMENSION}px or smaller.` });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ message: "User not found." });
    }

    // Clean up the previous avatar file so uploads/avatars doesn't grow forever.
    if (user.avatarUrl) {
      const oldPath = path.join(__dirname, "..", user.avatarUrl.replace(/^\//, ""));
      fs.unlink(oldPath, () => {}); // ignore errors - file may already be gone
    }

    user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await user.save();

    res.json(publicProfile(user));
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ message: "Could not upload avatar.", error: err.message });
  }
});

// DELETE /api/auth/me/avatar - remove my profile picture (falls back to initials)
router.delete("/me/avatar", protect, async (req, res) => {
  const fs = require("fs");
  const path = require("path");
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (user.avatarUrl) {
      const oldPath = path.join(__dirname, "..", user.avatarUrl.replace(/^\//, ""));
      fs.unlink(oldPath, () => {});
    }
    user.avatarUrl = "";
    await user.save();

    res.json(publicProfile(user));
  } catch (err) {
    res.status(500).json({ message: "Could not remove avatar.", error: err.message });
  }
});

// POST /api/auth/forgot-password - request a reset link by email
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });

    // Always return the same generic message whether or not the email exists -
    // this stops someone from using this form to figure out who has an account.
    const genericResponse = { message: "If that email is registered, a reset link has been sent." };

    if (!user) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN}/reset-password.html?token=${rawToken}`;
    await sendEmail(
      user.email,
      "Reset your Web Alert System password",
      `You requested a password reset. This link expires in 1 hour:\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`
    );

    res.json(genericResponse);
  } catch (err) {
    res.status(500).json({ message: "Could not process request.", error: err.message });
  }
});

// POST /api/auth/reset-password/:token - set a new password using a valid reset link
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { password } = req.body;
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }

    const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired." });
    }

    user.password = password; // pre-save hook in models/User.js hashes this automatically
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Password updated. You can now log in with your new password." });
  } catch (err) {
    res.status(500).json({ message: "Could not reset password.", error: err.message });
  }
});

// POST /api/auth/test-email  (admin only) - sends a test email to the caller
// and reports back exactly why it failed, if it did. Point this at from your
// deployed site to diagnose "emails aren't sending" without digging through
// server logs.
router.post("/test-email", protect, requireRole("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const result = await sendEmail(
      user.email,
      "Web Alert System - test email",
      `This is a test email triggered from your account (${user.email}) to confirm outgoing mail is working.`
    );

    if (!result.ok) {
      return res.status(502).json({ message: "Test email failed to send.", error: result.error });
    }
    res.json({ message: `Test email sent to ${user.email}. Check your inbox (and spam folder).` });
  } catch (err) {
    res.status(500).json({ message: "Could not run the email test.", error: err.message });
  }
});

module.exports = router;
