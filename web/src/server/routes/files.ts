import { Router } from 'express';
import * as fs from 'fs';
import { access, readdir, stat, unlink } from 'fs/promises';
import * as mime from 'mime-types';
import multer from 'multer';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('files');

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

// File filter configuration
// Note: We intentionally do not restrict file types to provide maximum flexibility
// for users. While the terminal display may not support all file formats (e.g.,
// binary files, executables), users should be able to upload any file they need
// and receive the path in their terminal for further processing.
const fileFilter: multer.Options['fileFilter'] = (_req, _file, cb) => {
  // Accept all file types - no restrictions by design
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for general files
  },
});

export function createFileRoutes(): Router {
  const router = Router();

  // Upload file endpoint
  router.post(
    '/files/upload',
    upload.single('file'),
    (req: AuthenticatedRequest & { file?: Express.Multer.File }, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file provided' });
        }

        // Generate relative path for the terminal
        const relativePath = path.relative(process.cwd(), req.file.path);
        const absolutePath = req.file.path;

        logger.log(
          `File uploaded by user ${req.userId}: ${req.file.filename} (${req.file.size} bytes)`
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
        logger.error('File upload error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
      }
    }
  );

  // Serve uploaded files
  router.get('/files/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(UPLOADS_DIR, filename);

      // Security check: ensure filename doesn't contain path traversal
      // Only allow alphanumeric, hyphens, underscores, dots, and standard file extension patterns
      if (
        filename.includes('..') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('\0') ||
        !/^[a-zA-Z0-9._-]+$/.test(filename) ||
        filename.startsWith('.') ||
        filename.length > 255
      ) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      // Ensure the resolved path is within the uploads directory
      const resolvedPath = path.resolve(filePath);
      const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
      if (
        !resolvedPath.startsWith(resolvedUploadsDir + path.sep) &&
        resolvedPath !== resolvedUploadsDir
      ) {
        return res.status(400).json({ error: 'Invalid file path' });
      }

      // Check if file exists
      try {
        await access(filePath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }

      // Get file stats for content length
      const stats = await stat(filePath);

      // Use mime-types library to determine content type
      // It automatically falls back to 'application/octet-stream' for unknown types
      const contentType = mime.lookup(filename) || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      logger.error('File serve error:', error);
      res.status(500).json({ error: 'Failed to serve file' });
    }
  });

  // List uploaded files
  router.get('/files', async (_req: AuthenticatedRequest, res) => {
    try {
      const allFiles = await readdir(UPLOADS_DIR);
      const files = await Promise.all(
        allFiles.map(async (file) => {
          const filePath = path.join(UPLOADS_DIR, file);
          const stats = await stat(filePath);
          return {
            filename: file,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
            url: `/api/files/${file}`,
            extension: path.extname(file).toLowerCase(),
          };
        })
      );
      files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Sort by newest first

      res.json({
        files,
        count: files.length,
      });
    } catch (error) {
      logger.error('File list error:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Delete uploaded file
  router.delete('/files/:filename', async (req: AuthenticatedRequest, res) => {
    try {
      const filename = req.params.filename;

      // Security check: ensure filename doesn't contain path traversal
      if (
        filename.includes('..') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('\0') ||
        !/^[a-zA-Z0-9._-]+$/.test(filename) ||
        filename.startsWith('.') ||
        filename.length > 255
      ) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const filePath = path.join(UPLOADS_DIR, filename);

      // Ensure the resolved path is within the uploads directory
      const resolvedPath = path.resolve(filePath);
      const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
      if (
        !resolvedPath.startsWith(resolvedUploadsDir + path.sep) &&
        resolvedPath !== resolvedUploadsDir
      ) {
        return res.status(400).json({ error: 'Invalid file path' });
      }

      try {
        await unlink(filePath);
        logger.log(`File deleted by user ${req.userId}: ${filename}`);
        res.json({ success: true, message: 'File deleted successfully' });
      } catch {
        // File doesn't exist
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      logger.error('File deletion error:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  return router;
}
