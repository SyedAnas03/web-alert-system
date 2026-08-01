// Defines what an "Alert" (notification) looks like in the database.
const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    category: {
      type: String,
      enum: ["Emergency", "System Update", "General Announcement"],
      default: "General Announcement",
    },
    // Priority is a separate axis from category: category is WHAT KIND of alert it is,
    // priority is HOW URGENT it is. E.g. a "System Update" can still be "Critical".
    priority: {
      type: String,
      enum: ["Critical", "High", "Medium", "Low"],
      default: "Medium",
    },
    // Which group(s) this alert is targeted at. "general" reaches everyone.
    targetGroups: { type: [String], default: ["general"] },
    sendEmail: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Tracks which users have opened/acknowledged this alert - powers unread badges
    // for users and "Read by X / Acknowledged by Y" counts for admins.
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    acknowledgedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true } // gives us createdAt/updatedAt for free -> doubles as "alert history"
);

module.exports = mongoose.model("Alert", alertSchema);
