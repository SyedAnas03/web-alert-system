const express = require("express");
const router = express.Router();
const Alert = require("../models/Alert");
const User = require("../models/User");
const protect = require("../middleware/auth");
const requireRole = require("../middleware/roleCheck");
const sendEmail = require("../utils/email");
const sendDiscordAlert = require("../utils/discord");

// This file needs access to the Socket.IO instance created in server.js.
// We attach it to the Express app object there, and read it back here via req.app.get("io").

// POST /api/alerts  (admin + moderator) - create + broadcast a new alert
// RBAC rule: moderators can send System Update / General Announcement alerts,
// but only admins can send Emergency alerts - Emergency is the highest-trust action
// in this system, so it's deliberately not delegated.
router.post("/", protect, requireRole("admin", "moderator"), async (req, res) => {
  try {
    const { title, message, category, priority, targetGroups, sendEmail: shouldEmail } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: "Title and message are required." });
    }

    if (category === "Emergency" && req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admins can send Emergency alerts." });
    }

    const alert = await Alert.create({
      title,
      message,
      category,
      priority: priority || "Medium",
      targetGroups: targetGroups && targetGroups.length ? targetGroups : ["general"],
      sendEmail: !!shouldEmail,
      createdBy: req.user.id,
    });

    // 1. Push it live to everyone connected right now via Socket.IO.
    const io = req.app.get("io");
    io.emit("newAlert", alert);

    // 2. Optionally email everyone in the targeted group(s).
    if (shouldEmail) {
      const recipients = await User.find({ groups: { $in: alert.targetGroups } });
      recipients.forEach((r) => {
        sendEmail(r.email, `[${alert.category}] ${alert.title}`, alert.message);
      });
    }

    // 3. Optionally mirror the alert to Discord (no-op if DISCORD_WEBHOOK_URL isn't set).
    sendDiscordAlert(alert);

    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ message: "Could not create alert.", error: err.message });
  }
});

// GET /api/alerts  (any logged-in user) - alert history, newest first
router.get("/", protect, async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ createdAt: -1 });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: "Could not fetch alerts.", error: err.message });
  }
});

// POST /api/alerts/:id/read  (any logged-in user) - marks an alert as read by the caller
router.post("/:id/read", protect, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { readBy: req.user.id } }, // $addToSet avoids duplicate entries
      { new: true }
    );
    if (!alert) return res.status(404).json({ message: "Alert not found." });
    res.json({ readBy: alert.readBy });
  } catch (err) {
    res.status(500).json({ message: "Could not mark alert as read.", error: err.message });
  }
});

// POST /api/alerts/:id/acknowledge  (any logged-in user) - "I'm safe" style check-in
router.post("/:id/acknowledge", protect, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { acknowledgedBy: req.user.id, readBy: req.user.id } },
      { new: true }
    );
    if (!alert) return res.status(404).json({ message: "Alert not found." });

    // Let the admin dashboard update its "Acknowledged by X" count live.
    const io = req.app.get("io");
    io.emit("alertAcknowledged", { alertId: alert._id, count: alert.acknowledgedBy.length });

    res.json({ acknowledgedBy: alert.acknowledgedBy });
  } catch (err) {
    res.status(500).json({ message: "Could not acknowledge alert.", error: err.message });
  }
});

// GET /api/alerts/stats  (admin only) - powers the dashboard's stats widgets + chart
router.get("/stats", protect, requireRole("admin"), async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [total, todayCount, categoryBreakdown, recentAlerts] = await Promise.all([
      Alert.countDocuments(),
      Alert.countDocuments({ createdAt: { $gte: startOfToday } }),
      Alert.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
      Alert.find({ createdAt: { $gte: sevenDaysAgo } }, "createdAt"),
    ]);

    // Bucket the last 7 days into day-by-day counts for the chart.
    const dayCounts = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      dayCounts[d.toISOString().slice(0, 10)] = 0;
    }
    recentAlerts.forEach((a) => {
      const key = a.createdAt.toISOString().slice(0, 10);
      if (key in dayCounts) dayCounts[key]++;
    });

    res.json({
      total,
      todayCount,
      categoryBreakdown: categoryBreakdown.map((c) => ({ category: c._id, count: c.count })),
      last7Days: Object.entries(dayCounts).map(([date, count]) => ({ date, count })),
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load stats.", error: err.message });
  }
});

// PUT /api/alerts/:id  (admin only) - update an existing alert
router.put("/:id", protect, requireRole("admin"), async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!alert) return res.status(404).json({ message: "Alert not found." });

    const io = req.app.get("io");
    io.emit("alertUpdated", alert);

    res.json(alert);
  } catch (err) {
    res.status(500).json({ message: "Could not update alert.", error: err.message });
  }
});

// DELETE /api/alerts/:id  (admin only)
router.delete("/:id", protect, requireRole("admin"), async (req, res) => {
  try {
    const alert = await Alert.findByIdAndDelete(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found." });

    const io = req.app.get("io");
    io.emit("alertDeleted", req.params.id);

    res.json({ message: "Alert deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete alert.", error: err.message });
  }
});

module.exports = router;
