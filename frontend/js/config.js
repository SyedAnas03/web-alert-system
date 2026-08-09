// Auto-detects local dev vs. the deployed site, so you don't have to keep
// hand-editing this file when switching between them.
// - Running frontend via Live Server / localhost -> talks to your local backend on :5000
// - Running frontend from anywhere else (e.g. your deployed site) -> talks to your deployed backend
// If your local backend runs on a different port, change PORT below to match.
const LOCAL_BACKEND_PORT = 5000;
const DEPLOYED_BACKEND_URL = "https://web-alert-system.onrender.com";

const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const BACKEND_URL = isLocalHost ? `http://localhost:${LOCAL_BACKEND_PORT}` : DEPLOYED_BACKEND_URL;

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

// --- Profile picture helper ---
// Turns a stored avatarUrl into a full URL, or falls back to a plain-text
// initials badge (rendered by the caller) when the user hasn't uploaded one.
function resolveAvatarUrl(avatarUrl) {
  if (!avatarUrl) return "";
  return avatarUrl.startsWith("http") ? avatarUrl : `${BACKEND_URL}${avatarUrl}`;
}

function initials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB - must match backend/utils/avatarUpload.js
const AVATAR_MAX_DIMENSION = 2000; // px - must match backend/routes/auth.js

// --- Global fetch wrapper: catches the "signed in elsewhere" case ---
// Every page loads this file before any other script, so wrapping fetch here
// means every existing `fetch(...)` call in the app (no per-page changes
// needed) automatically reacts when the backend invalidates a token because
// the same account logged in on another browser/device.
(function installSessionGuard() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    if (response.status === 401 && getToken()) {
      try {
        const data = await response.clone().json();
        if (data && data.code === "SESSION_INVALIDATED") {
          sessionStorage.setItem("wasFlash", data.message);
          logout();
        }
      } catch {
        /* response wasn't JSON - ignore */
      }
    }
    return response;
  };
})();

// Shows (and clears) a one-time message left by logout(), e.g. the
// "signed in elsewhere" notice. Call this on index.html after the DOM is ready.
function showFlashMessage(targetElId) {
  const msg = sessionStorage.getItem("wasFlash");
  if (!msg) return;
  sessionStorage.removeItem("wasFlash");
  const el = document.getElementById(targetElId);
  if (el) el.textContent = msg;
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
