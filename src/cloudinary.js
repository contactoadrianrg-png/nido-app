'use strict';
const cloudinary = require('cloudinary').v2;
const path       = require('path');
const fs         = require('fs');

const configured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
  console.log('[Cloudinary] configurado ✓');
} else {
  console.log('[Cloudinary] variables de entorno ausentes — usando almacenamiento local');
}

// Upload a Buffer to Cloudinary. Returns the secure URL.
function uploadStream(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

// Fallback: write buffer to local disk, return /uploads/<filename> URL.
function saveLocally(buffer, filename) {
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../public/uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}

/**
 * Upload an image buffer.
 * - If Cloudinary is configured: upload there, return secure_url.
 * - Otherwise: save to local disk, return /uploads/... URL.
 *
 * @param {Buffer} buffer    - file contents
 * @param {string} publicId  - Cloudinary public_id (used as filename on local too)
 * @returns {Promise<string>} permanent URL
 */
async function uploadPhoto(buffer, publicId) {
  if (configured) {
    return uploadStream(buffer, {
      public_id:     `nido/children/${publicId}`,
      overwrite:     true,
      resource_type: 'image',
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });
  }
  return saveLocally(buffer, `${publicId}.jpg`);
}

module.exports = { uploadPhoto, isCloudinaryConfigured: () => configured };
