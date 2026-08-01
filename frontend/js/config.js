// ⚠️ DEPLOYMENT: change this one line once your backend is deployed (e.g. to Render).
// Example after deploying: const BACKEND_URL = "https://your-app-name.onrender.com";
const BACKEND_URL = "http://localhost:5000";

const API_BASE = `${BACKEND_URL}/api`;
const SOCKET_BASE = BACKEND_URL;

function saveSession(token, user) {
  localStorage.setItem("wasToken", token);
  localStorage.setItem("wasUser", JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem("wasToken");
}

function getUser() {
  const raw = localStorage.getItem("wasUser");
  return raw ? JSON.parse(raw) : null;
}

function updateStoredUser(user) {
  localStorage.setItem("wasUser", JSON.stringify(user));
}

function logout() {
  localStorage.removeItem("wasToken");
  localStorage.removeItem("wasUser");
  window.location.href = "index.html";
}

// Redirect helpers used at the top of protected pages
function requireLogin() {
  if (!getToken()) window.location.href = "index.html";
}

function requireAdmin() {
  requireLogin();
  const user = getUser();
  if (!user || user.role !== "admin") window.location.href = "user.html";
}

// Dashboard access for both admins and moderators - moderators just have fewer
// actions available once they're in (enforced both in the UI and by the backend).
function requireStaff() {
  requireLogin();
  const user = getUser();
  if (!user || (user.role !== "admin" && user.role !== "moderator")) window.location.href = "user.html";
}

// --- Dark / light mode ---
// Applied immediately (see inline snippet in each page's <head>) to avoid a flash;
// this just wires up the toggle button and keeps the choice saved for next visit.
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("wasTheme", next);
  document.querySelectorAll("[data-theme-icon]").forEach((el) => {
    el.textContent = next === "dark" ? "☀️" : "🌙";
  });
}

function initThemeIcon() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  document.querySelectorAll("[data-theme-icon]").forEach((el) => {
    el.textContent = current === "dark" ? "☀️" : "🌙";
  });
}

// --- Password show/hide toggle ---
// btn is the toggle button itself; inputId is the password field it controls.
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector("[data-eye-icon]");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  icon.textContent = showing ? "visibility" : "visibility_off";
  btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
}
