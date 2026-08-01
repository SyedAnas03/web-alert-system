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
    // Used only for the self-service "forgot password" flow (see routes/auth.js).
    // We store a hash of the token, never the raw token - same principle as passwords.
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
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
