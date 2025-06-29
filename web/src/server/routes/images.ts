import { Router } from 'express';
import * as fs from 'fs';
import multer from 'multer';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('images');

// Create uploads directory in the control directory
const CONTROL_DIR =
  process.env.VIBETUNNEL_CONTROL_DIR || path.join(os.homedir(), '.vibetunnel/control');
const UPLOADS_DIR = path.join(CONTROL_DIR, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  logger.log(`Created uploads directory: ${UPLOADS_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// File filter to only allow images
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Check if file is an image
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

export function createImageRoutes(): Router {
  const router = Router();

  // Upload image endpoint
  router.post('/images/upload', upload.single('image'), (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      // Generate relative path for the terminal
      const relativePath = path.relative(process.cwd(), req.file.path);
      const absolutePath = req.file.path;

      logger.log(
        `Image uploaded by user ${req.userId}: ${req.file.filename} (${req.file.size} bytes)`
      );

      res.json({
        success: true,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: absolutePath,
        relativePath: relativePath,
      });
    } catch (error) {
      logger.error('Image upload error:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Serve uploaded images
  router.get('/images/:filename', (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(UPLOADS_DIR, filename);

      // Security check: ensure filename doesn't contain path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Get file stats for content length
      const stats = fs.statSync(filePath);
      const ext = path.extname(filename).toLowerCase();

      // Set appropriate content type
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      logger.error('Image serve error:', error);
      res.status(500).json({ error: 'Failed to serve image' });
    }
  });

  // List uploaded images
  router.get('/images', (_req: AuthenticatedRequest, res) => {
    try {
      const files = fs.readdirSync(UPLOADS_DIR);
      const images = files
        .filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
        })
        .map((file) => {
          const filePath = path.join(UPLOADS_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
            url: `/api/images/${file}`,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Sort by newest first

      res.json({
        images,
        count: images.length,
      });
    } catch (error) {
      logger.error('Image list error:', error);
      res.status(500).json({ error: 'Failed to list images' });
    }
  });

  // Delete image
  router.delete('/images/:filename', (req: AuthenticatedRequest, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(UPLOADS_DIR, filename);

      // Security check: ensure filename doesn't contain path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Delete the file
      fs.unlinkSync(filePath);
      logger.log(`Image deleted by user ${req.userId}: ${filename}`);

      res.json({ success: true, message: 'Image deleted successfully' });
    } catch (error) {
      logger.error('Image delete error:', error);
      res.status(500).json({ error: 'Failed to delete image' });
    }
  });

  return router;
}
