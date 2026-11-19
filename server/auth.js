// auth.js — email/password auth with bcrypt + JWT.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET is not set. Set it in .env before going live — tokens are insecure without it.');
}
const JWT_EXPIRES = '7d';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}
function checkPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET || 'dev-only-insecure-secret', { expiresIn: JWT_EXPIRES });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET || 'dev-only-insecure-secret');
}

// A user is owner if their email matches OWNER_EMAIL, or if they are the
// very first account created (bootstrap for a fresh install).
function isOwnerEmail(email) {
  const owner = (process.env.OWNER_EMAIL || '').toLowerCase().trim();
  return owner && email.toLowerCase().trim() === owner;
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, created_at: user.created_at };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ ok: false, error: 'INVALID_TOKEN', message: 'Session expired. Please sign in again.' });
  }
  const user = db.getUserById(payload.id);
  if (!user) return res.status(401).json({ ok: false, error: 'USER_NOT_FOUND', message: 'Account not found.' });
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ ok: false, error: 'OWNER_ONLY', message: 'This area is for the app owner only.' });
  }
  next();
}

module.exports = { hashPassword, checkPassword, signToken, verifyToken, isOwnerEmail, publicUser, requireAuth, requireOwner };
