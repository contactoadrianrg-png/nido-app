'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('../database');

const router = express.Router();

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../public/uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `child_${req.params.id}_${Date.now()}${ext || '.jpg'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo imágenes'));
    cb(null, true);
  },
});

// GET /api/children
router.get('/children', async (req, res) => {
  try {
    res.json(await db.getChildren(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/children/:id/profile
router.get('/children/:id/profile', async (req, res) => {
  try {
    const profile = await db.getChildProfile(req.user.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Hijo no encontrado' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/children/:id/photo
router.post('/children/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const photoUrl = `/uploads/${req.file.filename}`;
    await db.updateChildPhoto(req.user.id, req.params.id, photoUrl);
    res.json({ success: true, photo_url: photoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/children/:id
router.put('/children/:id', async (req, res) => {
  try {
    const { name, emoji, birthdate } = req.body;
    if (!name || !emoji) return res.status(400).json({ error: 'name y emoji requeridos' });
    await db.updateChild(req.user.id, req.params.id, name.trim(), emoji.trim(), birthdate || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events
router.get('/events', async (req, res) => {
  try {
    const { childId, category, from, to, upcoming } = req.query;
    res.json(await db.getEvents(req.user.id, { childId, category, from, to, upcoming }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
router.post('/events', async (req, res) => {
  const { child_id, title, category, date, time, notes } = req.body;
  if (!child_id || !title || !category || !date) {
    return res.status(400).json({ error: 'child_id, title, category y date son requeridos' });
  }
  try {
    const id = await db.createEvent(req.user.id, { child_id, title: title.trim(), category, date, time, notes });
    res.json({ id, success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/events/:id', async (req, res) => {
  const { child_id, title, category, date, time, notes } = req.body;
  if (!child_id || !title || !category || !date) {
    return res.status(400).json({ error: 'child_id, title, category y date son requeridos' });
  }
  try {
    await db.updateEvent(req.user.id, req.params.id, { child_id, title: title.trim(), category, date, time, notes });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/events/:id', async (req, res) => {
  try {
    await db.deleteEvent(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats
router.get('/stats', async (req, res) => {
  try {
    res.json(await db.getStats(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
