'use strict';
const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const db         = require('../database');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, contraseña y nombre son requeridos' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (await db.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }
    const hash   = await bcrypt.hash(password, 10);
    const userId = await db.createUser(email, hash, name);
    const user   = await db.findUserById(userId);
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin } });
  } catch (err) {
    console.error('[Auth] register error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin } });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const user = await db.findUserByEmail(email);
    if (!user) return res.json({ ok: true });

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    await db.createPasswordResetToken(user.id, token, expiresAt);

    const appUrl   = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetUrl = `${appUrl}/reset-password.html?token=${token}`;

    if (process.env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from:    process.env.SMTP_FROM || 'noreply@familia.app',
        to:      user.email,
        subject: 'Recuperación de contraseña - Mi Familia',
        html: `
          <p>Hola ${user.name},</p>
          <p>Haz clic en el siguiente enlace para restablecer tu contraseña. Expira en 1 hora.</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>Si no solicitaste esto, ignora este email.</p>
        `,
      });
    } else {
      console.log(`[Auth] Reset link for ${user.email}: ${resetUrl}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] forgot-password error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const row = await db.findPasswordResetToken(token);
    if (!row) return res.status(400).json({ error: 'Enlace inválido o expirado' });

    const hash = await bcrypt.hash(password, 10);
    await db.updateUserPassword(row.user_id, hash);
    await db.usePasswordResetToken(token);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] reset-password error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });

    const user = await db.findUserByEmail(req.user.email);
    const ok   = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(req.user.id, hash);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
