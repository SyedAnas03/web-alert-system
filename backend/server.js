require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const alertRoutes = require("./routes/alerts");
const userRoutes = require("./routes/users");

const app = express();
const server = http.createServer(app); // Socket.IO needs the raw http server, not just Express

// --- Database ---
connectDB();

// --- Socket.IO setup ---
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || "*" },
  // Defaults (25s/20s) can leave a "ghost" connection counted as online for up to
  // ~45 seconds after a tab closes uncleanly. Shorter values here mean the
  // "online now" count updates noticeably faster after logout/close.
  pingInterval: 8000,
  pingTimeout: 5000,
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  io.emit("onlineCount", io.engine.clientsCount);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    io.emit("onlineCount", io.engine.clientsCount);
  });
});

// Make `io` reachable from inside route files via req.app.get("io")
app.set("io", io);

// --- Core middleware ---
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));
app.use(express.json());

// --- Security: rate limiting on all API endpoints ---
// Stops one client from hammering the server with requests (basic abuse/DoS protection).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per window
  message: { message: "Too many requests, please try again later." },
});
app.use("/api", apiLimiter);

// --- Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/users", userRoutes);

app.get("/", (req, res) => {
  res.send("Web Alert System API is running.");
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
