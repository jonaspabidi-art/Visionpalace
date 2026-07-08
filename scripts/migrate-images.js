// Engångsmigrering: flyttar base64-bilder (data:-URL:er) i inventory, lenses
// och sale_items till Supabase Storage och ersätter kolumnvärdet med URL:en.
// Se ATGARDSPLAN.md punkt 7.
//
//   Torrkörning (ändrar ingenting, visar vad som skulle göras):
//     node scripts/migrate-images.js --dry-run
//   Skarp körning:
//     node scripts/migrate-images.js
//
// Körs från repo-roten på servern (behöver .env med SUPABASE_URL och
// SUPABASE_SERVICE_KEY). Säkert att köra om: rader som redan migrerats
// matchar inte längre 'data:%' och hoppas över. En rad uppdateras först
// EFTER lyckad uppladdning — misslyckas något lämnas raden orörd och
// appen fortsätter fungera med base64-värdet.

require('dotenv').config();
const crypto = require('crypto');
const supabase = require('../server/lib/supabase');
const { uploadMedia } = require('../server/lib/upload');

const DRY = process.argv.includes('--dry-run');
const TABLES = ['inventory', 'lenses', 'sale_items'];

// Identiska bilder (t.ex. samma vara såld flera gånger) laddas bara upp en gång
const uploadedByHash = new Map(); // sha1(buffer) -> storage-URL

async function listIds(table) {
  const ids = [];
  let cursor = null;
  for (;;) {
    let q = supabase.from(table).select('id')
      .like('image', 'data:%')
      .order('id', { ascending: true })
      .limit(500);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    ids.push(...data.map(r => r.id));
    cursor = data[data.length - 1].id;
  }
  return ids;
}

async function imageToUrl(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/s);
  if (!m) return null;
  const [, mime, b64] = m;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return null;
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (uploadedByHash.has(hash)) return uploadedByHash.get(hash);
  if (DRY) {
    uploadedByHash.set(hash, `(dry:${Math.round(buf.length / 1024)}KB)`);
    return uploadedByHash.get(hash);
  }
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const res = await uploadMedia(buf, `migrated${ext}`, mime);
  const url = res.thumbUrl || res.url; // 800px-tumnageln räcker överallt i appen
  uploadedByHash.set(hash, url);
  return url;
}

async function migrateTable(table) {
  const ids = await listIds(table);
  console.log(`\n[${table}] ${ids.length} rad(er) med base64-bild`);
  let ok = 0, failed = 0, bytes = 0;
  for (const id of ids) {
    try {
      const { data: row, error } = await supabase.from(table).select('id, image').eq('id', id).single();
      if (error) throw new Error(error.message);
      if (!row?.image?.startsWith('data:')) { continue; } // redan migrerad
      bytes += row.image.length;
      const url = await imageToUrl(row.image);
      if (!url) throw new Error('kunde inte tolka/ladda upp bilden');
      if (!DRY) {
        const { error: upErr } = await supabase.from(table).update({ image: url }).eq('id', id);
        if (upErr) throw new Error(upErr.message);
      }
      ok++;
      console.log(`[${table}] ${id} ✓ ${DRY ? url : ''}`);
    } catch (e) {
      failed++;
      console.error(`[${table}] ${id} ✗ ${e.message} (raden lämnad orörd)`);
    }
  }
  console.log(`[${table}] klart: ${ok} migrerade, ${failed} misslyckade, ~${Math.round(bytes / 1024 / 1024 * 10) / 10} MB base64 i tabellen`);
  return failed;
}

(async () => {
  console.log(DRY ? '=== TORRKÖRNING — inga ändringar görs ===' : '=== SKARP KÖRNING ===');
  let totalFailed = 0;
  for (const table of TABLES) {
    totalFailed += await migrateTable(table).catch(e => { console.error(e.message); return 1; });
  }
  console.log(`\nFärdigt. Unika bilder ${DRY ? 'som skulle laddas upp' : 'uppladdade'}: ${uploadedByHash.size}.`);
  if (totalFailed) console.log(`${totalFailed} rad(er) misslyckades — kör om skriptet för att försöka igen (redan migrerade hoppas över).`);
  process.exit(totalFailed ? 1 : 0);
})();
