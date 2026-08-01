// Small wrapper around Nodemailer so the rest of the app can just call sendEmail(...).
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail(to, subject, text) {
  try {
    await transporter.sendMail({
      from: `"Web Alert System" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    // We log the error but don't crash the request just because email failed -
    // the web alert itself should still go through.
    console.error("Email sending failed:", err.message);
    return false;
  }
}

module.exports = sendEmail;
