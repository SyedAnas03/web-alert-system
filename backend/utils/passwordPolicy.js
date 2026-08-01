// Single source of truth for password strength - used at registration, self-service
// reset, and admin-set-password, so the rule is consistent everywhere it applies.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 10 characters and include at least one uppercase letter, one lowercase letter, one number, and one special character.";

function isStrongPassword(password) {
  return typeof password === "string" && STRONG_PASSWORD_REGEX.test(password);
}

module.exports = { isStrongPassword, PASSWORD_POLICY_MESSAGE };
