const multer = require('multer');
const { anyAuth } = require('../lib/auth');
const { uploadMedia } = require('../lib/upload');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

module.exports = (io) => {
  const router = require('express').Router();

  // Upload media
  router.post('/upload', anyAuth, upload.array('files', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Inga filer' });
    const results = [];
    for (const file of req.files) {
      try {
        const result = await uploadMedia(file.buffer, file.originalname, file.mimetype);
        results.push(result);
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }
    res.json({ files: results });
  });

  return router;
};
