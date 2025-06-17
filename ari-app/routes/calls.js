const express = require("express");
const router = express.Router();
const { CallLog } = require("../db");

router.get("/", async (req, res) => {
  try {
    const calls = await CallLog.findAll({ order: [["createdAt", "DESC"]] });
    res.json(calls);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch calls" });
  }
});

module.exports = router;
