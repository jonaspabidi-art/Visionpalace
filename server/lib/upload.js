const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const path = require('path');
const supabase = require('./supabase');

async function uploadMedia(buffer, originalname, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
  const fileId = uuidv4();
  const fileName = `${fileId}${ext}`;
  const thumbName = `${fileId}_thumb.jpg`;

  const { error: uploadErr } = await supabase.storage
    .from('media')
    .upload(fileName, buffer, { contentType: mimetype, upsert: false });
  if (uploadErr) throw uploadErr;

  const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName);

  let thumbUrl = null;
  if (!isVideo) {
    try {
      const thumbBuffer = await sharp(buffer).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      await supabase.storage.from('media').upload(thumbName, thumbBuffer, { contentType: 'image/jpeg' });
      const { data: { publicUrl: tu } } = supabase.storage.from('media').getPublicUrl(thumbName);
      thumbUrl = tu;
    } catch (e) { console.error('Thumbnail gen failed:', e.message); thumbUrl = publicUrl; }
  } else {
    thumbUrl = publicUrl;
  }

  return { url: publicUrl, thumbUrl, type: isVideo ? 'video' : 'image', fileName, thumbName };
}

module.exports = { uploadMedia };
