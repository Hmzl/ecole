import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export function ensureUploadsDir() {
  if (!isServerless) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

export function getUploadsDir() {
  return uploadsDir;
}

export function isServerlessRuntime() {
  return isServerless;
}

/**
 * Persist an uploaded file (multer memory or disk).
 * @returns {Promise<string|null>} public URL or /uploads/... path
 */
export async function saveUploadedFile(file) {
  if (!file) return null;

  const ext = path.extname(file.originalname || '') || '';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const body = file.buffer || fs.readFileSync(file.path);
    const blob = await put(`uploads/${filename}`, body, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return blob.url;
  }

  if (isServerless) {
    throw Object.assign(
      new Error('Stockage photos non configuré. Ajoutez Vercel Blob (BLOB_READ_WRITE_TOKEN).'),
      { status: 503 }
    );
  }

  ensureUploadsDir();
  const dest = path.join(uploadsDir, filename);
  if (file.buffer) {
    fs.writeFileSync(dest, file.buffer);
  } else if (file.path) {
    fs.renameSync(file.path, dest);
  } else {
    return null;
  }
  return `/uploads/${filename}`;
}

export function readUploadBuffer(file) {
  if (!file) return null;
  if (file.buffer) return file.buffer;
  if (file.path) return fs.readFileSync(file.path);
  return null;
}

export function cleanupTempFile(file) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlink(file.path, () => {});
  }
}
