// Small wrapper around Nodemailer so the rest of the app can just call sendEmail(...).
const nodemailer = require("nodemailer");

let transporter = null;
let configWarningLogged = false;

function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (!configWarningLogged) {
      console.warn(
        "[email] EMAIL_USER / EMAIL_PASS are not set - alert emails and password " +
          "reset emails will silently fail until they're added to your .env file."
      );
      configWarningLogged = true;
    }
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

// Call this once at startup so a bad Gmail App Password shows up immediately
// in your server logs instead of only failing later, silently, on the first
// real alert.
async function verifyEmailConfig() {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.verify();
    console.log("[email] SMTP connection verified - ready to send.");
  } catch (err) {
    console.error("[email] SMTP verification FAILED - emails will not send. Reason:", describeError(err));
  }
}

// Turns Gmail/Nodemailer's cryptic error codes into something you can actually
// act on. These cover the vast majority of cases that break student projects.
function describeError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/Invalid login|Username and Password not accepted/i.test(msg)) {
    return (
      msg +
      " -- Gmail rejected the credentials. Make sure EMAIL_PASS is a 16-character " +
      '"App Password" from myaccount.google.com/apppasswords (with 2-Step ' +
      "Verification turned on), NOT your normal Gmail password."
    );
  }
  if (/self signed certificate|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    return (
      msg +
      " -- couldn't reach Gmail's servers. Check outbound network/firewall rules on your host (this is common on some free hosting tiers)."
    );
  }
  return msg;
}

async function sendEmail(to, subject, text) {
  const t = getTransporter();
  if (!t) return { ok: false, error: "EMAIL_USER/EMAIL_PASS not configured on the server." };

  try {
    await t.sendMail({
      from: `"Web Alert System" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    // We log the error but don't crash the request just because email failed -
    // the web alert itself should still go through.
    const description = describeError(err);
    console.error("[email] Sending failed:", description);
    return { ok: false, error: description };
  }
}

module.exports = sendEmail;
module.exports.verifyEmailConfig = verifyEmailConfig;
