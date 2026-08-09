// Runs before protected routes. Checks that a valid login token was sent, AND
// that it's still the most recent login for that account (single-session rule).
const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function protect(req, res, next) {
  const authHeader = req.headers.authorization; // expected format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided. Please log in." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // A token minted before this feature existed won't carry a `sid` - treat
    // that the same as a stale session and force a fresh login.
    const user = await User.findById(decoded.id).select("activeSessionId role");
    if (!user || !decoded.sid || decoded.sid !== user.activeSessionId) {
      return res.status(401).json({
        message: "You've been logged out because this account was signed in from another browser/device.",
        code: "SESSION_INVALIDATED",
      });
    }

    req.user = decoded; // attaches { id, role, sid } to the request for later use
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
  }
}

module.exports = protect;
