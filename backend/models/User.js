// Defines what a "User" looks like in the database, and how passwords are handled.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, // stored as a hash, never plain text
    role: { type: String, enum: ["admin", "moderator", "user"], default: "user" },
    // Which alert categories this user wants to receive. Lets admins target groups.
    groups: { type: [String], default: ["general"] },
    // Optional self-service profile fields.
    phone: { type: String, trim: true, default: "" },
    avatarUrl: { type: String, default: "" },
    // Used only for the self-service "forgot password" flow (see routes/auth.js).
    // We store a hash of the token, never the raw token - same principle as passwords.
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    // --- Single active session enforcement ---
    // Every successful login generates a fresh random id and stamps it here AND
    // into the JWT payload (see routes/auth.js generateToken). The `protect`
    // middleware rejects any request whose token carries a stale id - so logging
    // in on a new device/browser silently invalidates every older token.
    activeSessionId: { type: String, default: null },
    lastLoginAt: { type: Date },

    // --- Email verification (required once, at signup) ---
    emailVerified: { type: Boolean, default: false },

    // --- Two-factor authentication (opt-in, toggled from the profile page) ---
    // When on, login requires the password AND a one-time code - see the
    // "Verified" badge on the profile page, which reflects this flag.
    twoFactorEnabled: { type: Boolean, default: false },

    // --- Shared OTP fields, reused for both the flows above ---
    // Only ONE OTP is ever "live" at a time per user - `otpPurpose` stops a
    // code issued for one flow (e.g. signup verification) from being replayed
    // to satisfy the other (e.g. a login challenge).
    otpCodeHash: { type: String, default: null },
    otpExpires: { type: Date, default: null },
    otpPurpose: { type: String, enum: ["verify-email", "login", null], default: null },
  },
  { timestamps: true }
);

// Before saving a user, automatically hash their password if it's new or changed.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Helper method: compare a plain-text login attempt against the stored hash.
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
