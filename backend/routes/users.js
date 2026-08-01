const express = require("express");
const router = express.Router();
const User = require("../models/User");
const protect = require("../middleware/auth");
const requireRole = require("../middleware/roleCheck");
const { isStrongPassword, PASSWORD_POLICY_MESSAGE } = require("../utils/passwordPolicy");

// GET /api/users  (admin only) - list every registered user, newest first
router.get("/", protect, requireRole("admin"), async (req, res) => {
  try {
    const users = await User.find().select("-password -resetPasswordToken -resetPasswordExpires").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Could not load users.", error: err.message });
  }
});

// POST /api/users  (admin only) - create a user account directly, without them
// self-registering. Useful for onboarding staff/students in bulk or in person.
router.post("/", protect, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, role, groups } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }
    if (!["admin", "moderator", "user"].includes(role)) {
      return res.status(400).json({ message: "Role must be admin, moderator, or user." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "An account with that email already exists." });
    }

    const cleanGroups = Array.isArray(groups) ? groups.map((g) => g.trim()).filter(Boolean) : [];

    const user = await User.create({
      name,
      email,
      password,
      role,
      groups: cleanGroups.length ? cleanGroups : ["general"],
    });

    res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      groups: user.groups,
      createdAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: "Could not create user.", error: err.message });
  }
});

// PUT /api/users/:id/role  (admin only) - change a user's role
router.put("/:id/role", protect, requireRole("admin"), async (req, res) => {
  try {
    const { role } = req.body;
    if (!["admin", "moderator", "user"].includes(role)) {
      return res.status(400).json({ message: "Role must be admin, moderator, or user." });
    }

    // Safety rail: don't let an admin accidentally demote themselves and lock
    // themselves out of admin-only screens with no other admin to fix it.
    if (req.user.id === req.params.id && role !== "admin") {
      return res.status(400).json({ message: "You can't remove your own admin role." });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found." });

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Could not update role.", error: err.message });
  }
});

// PUT /api/users/:id/set-password  (admin only) - directly set a new password for a user
// This is different from the self-service "forgot password" flow: here, the admin
// picks the new password themselves (useful for helping a locked-out user in person).
router.put("/:id/set-password", protect, requireRole("admin"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    user.password = password; // pre-save hook hashes this automatically
    await user.save();

    res.json({ message: `Password updated for ${user.email}.` });
  } catch (err) {
    res.status(500).json({ message: "Could not update password.", error: err.message });
  }
});

// DELETE /api/users/:id  (admin only) - remove a user account
router.delete("/:id", protect, requireRole("admin"), async (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({ message: "You can't delete your own account while logged in as it." });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    res.json({ message: "User deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete user.", error: err.message });
  }
});

module.exports = router;
