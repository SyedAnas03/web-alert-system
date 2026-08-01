// This file's only job: connect to MongoDB when the server starts.
const mongoose = require("mongoose");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    // If we can't reach the database, there's no point running the server.
    process.exit(1);
  }
}

module.exports = connectDB;
