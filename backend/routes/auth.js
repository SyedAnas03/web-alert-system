const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const router = express.Router();
const User = require("../models/User");
const protect = require("../middleware/auth");
const sendEmail = require("../utils/email");
const { isStrongPassword, PASSWORD_POLICY_MESSAGE } = require("../utils/passwordPolicy");

// Turns a user's id/role into a signed login token.
function generateToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
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

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, groups: user.groups },
    });
  } catch (err) {
    res.status(500).json({ message: "Registration failed.", error: err.message });
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

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, groups: user.groups },
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed.", error: err.message });
  }
});

// --- Below: routes for the logged-in user to manage their own profile ---
// GET /api/auth/me - fetch my current profile (used to refresh groups after a change)
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ id: user._id, name: user.name, email: user.email, role: user.role, groups: user.groups });
  } catch (err) {
    res.status(500).json({ message: "Could not load profile.", error: err.message });
  }
});

// PUT /api/auth/me - update my own alert group subscriptions
// Deliberately does NOT allow changing role or email here - self-service is limited
// to what's safe for a user to control themselves.
router.put("/me", protect, async (req, res) => {
  try {
    const { groups } = req.body;
    const cleanGroups = Array.isArray(groups)
      ? groups.map((g) => g.trim()).filter(Boolean)
      : ["general"];

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { groups: cleanGroups.length ? cleanGroups : ["general"] },
      { new: true }
    ).select("-password");

    res.json({ id: user._id, name: user.name, email: user.email, role: user.role, groups: user.groups });
  } catch (err) {
    res.status(500).json({ message: "Could not update profile.", error: err.message });
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

    const resetLink = `${process.env.CLIENT_ORIGIN}/reset-password.html?token=${rawToken}`;
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

module.exports = router;
