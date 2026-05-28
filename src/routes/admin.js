'use strict';
const express = require('express');
const db      = require('../database');

const router = express.Router();

// GET /api/admin/users
router.get('/users', (req, res) => {
  res.json(db.getAllUsers());
});

module.exports = router;
