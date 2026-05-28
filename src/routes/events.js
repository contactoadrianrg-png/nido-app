'use strict';
const express = require('express');
const db      = require('../database');

const router = express.Router();

// GET /api/children
router.get('/children', (req, res) => {
  res.json(db.getChildren(req.user.id));
});

// PUT /api/children/:id
router.put('/children/:id', (req, res) => {
  const { name, emoji } = req.body;
  if (!name || !emoji) return res.status(400).json({ error: 'name y emoji requeridos' });
  db.updateChild(req.user.id, req.params.id, name.trim(), emoji.trim());
  res.json({ success: true });
});

// GET /api/events
router.get('/events', (req, res) => {
  const { childId, category, from, to, upcoming } = req.query;
  res.json(db.getEvents(req.user.id, { childId, category, from, to, upcoming }));
});

// POST /api/events
router.post('/events', (req, res) => {
  const { child_id, title, category, date, time, notes } = req.body;
  if (!child_id || !title || !category || !date) {
    return res.status(400).json({ error: 'child_id, title, category y date son requeridos' });
  }
  try {
    const id = db.createEvent(req.user.id, { child_id, title: title.trim(), category, date, time, notes });
    res.json({ id, success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/events/:id', (req, res) => {
  const { child_id, title, category, date, time, notes } = req.body;
  if (!child_id || !title || !category || !date) {
    return res.status(400).json({ error: 'child_id, title, category y date son requeridos' });
  }
  try {
    db.updateEvent(req.user.id, req.params.id, { child_id, title: title.trim(), category, date, time, notes });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/events/:id', (req, res) => {
  db.deleteEvent(req.user.id, req.params.id);
  res.json({ success: true });
});

// GET /api/stats
router.get('/stats', (req, res) => {
  res.json(db.getStats(req.user.id));
});

module.exports = router;
