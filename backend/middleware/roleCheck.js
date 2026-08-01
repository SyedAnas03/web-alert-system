// Restricts a route to specific roles, e.g. adminOnly("admin") for admin-only routes.
// Must run AFTER the `protect` middleware, since it relies on req.user being set.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "You don't have permission to do that." });
    }
    next();
  };
}

module.exports = requireRole;
