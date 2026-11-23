'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./db');
const { HttpError } = require('./validate');

const ALLOWED = { 'image/jpeg': [[0xff, 0xd8, 0xff]], 'image/png': [[0x89, 0x50, 0x4e, 0x47]], 'image/webp': [[0x52, 0x49, 0x46, 0x46]], 'application/pdf': [[0x25, 0x50, 0x44, 0x46]] };
const MAX_BYTES = 4 * 1024 * 1024;

// Accepts {filename, mime, data(base64)}; validates type by declared mime AND magic bytes.
function saveUpload({ ownerId, kind, file, bookingId = null, caption = null, imagesOnly = false }) {
  if (!file || typeof file.data !== 'string') throw new HttpError(400, 'No file received.');
  const mime = String(file.mime || '').toLowerCase();
  if (!ALLOWED[mime] || (imagesOnly && mime === 'application/pdf')) throw new HttpError(400, imagesOnly ? 'Only JPG, PNG or WebP images are allowed.' : 'Only JPG, PNG, WebP or PDF files are allowed.');
  const buf = Buffer.from(file.data.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'The file is empty.');
  if (buf.length > MAX_BYTES) throw new HttpError(400, 'Each file must be 4 MB or smaller.');
  if (!ALLOWED[mime].some((sig) => sig.every((b, i) => buf[i] === b))) throw new HttpError(400, 'The file content does not match its type.');
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(cfg.uploadDir, id), buf, { mode: 0o600 });
  store.run('INSERT INTO files (id,owner_user_id,kind,original_name,mime,size,booking_id,caption,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, ownerId, kind, String(file.filename || 'file').slice(0, 120), mime, buf.length, bookingId, caption ? String(caption).slice(0, 200) : null, Date.now());
  return id;
}
const readUpload = (id) => fs.readFileSync(path.join(cfg.uploadDir, id));

module.exports = { saveUpload, readUpload };
