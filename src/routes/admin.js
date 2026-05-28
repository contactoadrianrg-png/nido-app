'use strict';
const express = require('express');
const db      = require('../database');

const router = express.Router();

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    res.json(await db.getAllUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
