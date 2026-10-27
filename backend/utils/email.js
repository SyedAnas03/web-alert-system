// Small wrapper around email sending so the rest of the app can just call sendEmail(...).
// - If BREVO_API_KEY is set (e.g. on Render), emails go out over HTTPS via Brevo's API.
//   This works on hosts that block SMTP ports (like Render's free tier).
// - Otherwise it falls back to Gmail SMTP via Nodemailer (works fine on your own PC).
const nodemailer = require("nodemailer");

let transporter = null;
let configWarningLogged = false;

const useBrevo = () => Boolean(process.env.BREVO_API_KEY);

function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (!configWarningLogged) {
      console.warn(
        "[email] EMAIL_USER / EMAIL_PASS are not set - emails will silently fail " +
          "until they're added to your .env file (or BREVO_API_KEY is set)."
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

// Call this once at startup so config problems show up immediately in your logs.
async function verifyEmailConfig() {
  if (useBrevo()) {
    if (!process.env.EMAIL_FROM) {
      console.error("[email] BREVO_API_KEY is set but EMAIL_FROM is missing - emails will not send.");
      return;
    }
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
      });
      if (res.ok) {
        console.log("[email] Brevo API key verified - ready to send.");
      } else {
        console.error(
          "[email] Brevo verification FAILED (status " + res.status + "). Check BREVO_API_KEY and its permissions."
        );
      }
    } catch (err) {
      console.error("[email] Brevo verification FAILED. Reason:", describeError(err));
    }
    return;
  }

  const t = getTransporter();
  if (!t) return;
  try {
    await t.verify();
    console.log("[email] SMTP connection verified - ready to send.");
  } catch (err) {
    console.error("[email] SMTP verification FAILED - emails will not send. Reason:", describeError(err));
  }
}

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
  if (/self signed certificate|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) {
    return (
      msg +
      " -- couldn't reach the mail server. Many free hosts (like Render) block SMTP ports; use BREVO_API_KEY instead."
    );
  }
  return msg;
}

async function sendViaBrevo(to, subject, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Web Alert System", email: process.env.EMAIL_FROM },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error("Brevo error " + res.status + ": " + body);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(to, subject, text) {
  try {
    if (useBrevo()) {
      if (!process.env.EMAIL_FROM) {
        return { ok: false, error: "EMAIL_FROM not configured on the server." };
      }
      await sendViaBrevo(to, subject, text);
      return { ok: true };
    }

    const t = getTransporter();
    if (!t) return { ok: false, error: "EMAIL_USER/EMAIL_PASS not configured on the server." };

    await t.sendMail({
      from: `"Web Alert System" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    // Log the error but don't crash the request just because email failed -
    // the web alert itself should still go through.
    const description = describeError(err);
    console.error("[email] Sending failed:", description);
    return { ok: false, error: description };
  }
}

module.exports = sendEmail;
module.exports.verifyEmailConfig = verifyEmailConfig;