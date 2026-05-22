const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { requireRole } = require('../middleware/auth');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB max after client compression
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.post('/', requireRole('store_owner', 'superadmin'), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const apiBase = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
  res.json({ url: `${apiBase}/uploads/${req.file.filename}` });
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 3 MB)' });
  res.status(400).json({ error: err.message });
});

module.exports = router;
