function compressImage(file, maxPx = 1920, quality = 0.85) {
  return new Promise(resolve => {
    if (file.type.startsWith('video')) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= maxPx && height <= maxPx) { resolve(file); return; }
      const scale = maxPx / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Instant local previews; compression + upload run in the background so the
// user can keep typing. item.url is set when the upload succeeds.
function uploadFiles(files) {
  const row = document.getElementById('media-prev-row');
  const items = Array.from(files).map(file => {
    const localUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const div = document.createElement('div');
    div.className = 'prev-thumb uploading';
    div.innerHTML = isVideo
      ? `<video src="${localUrl}" muted></video><button>×</button>`
      : `<img src="${localUrl}" alt=""><button>×</button>`;
    const item = {
      localUrl,
      type: isVideo ? 'video' : 'image',
      url: null,
      thumbUrl: null,
      uploadPromise: null,
      removed: false,
      _div: div
    };
    div.querySelector('button').onclick = () => {
      item.removed = true;
      pendingMedia = pendingMedia.filter(x => x !== item);
      div.remove();
    };
    row.appendChild(div);
    pendingMedia.push(item);
    return { item, file };
  });

  const up = (async () => {
    const compressed = await Promise.all(items.map(({ file }) => compressImage(file)));
    const form = new FormData();
    compressed.forEach((blob, i) => form.append('files', blob, items[i].file.name));
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-session-token': session.session_token }, body: form });
    if (!r.ok) throw new Error('upload failed');
    const d = await r.json();
    d.files.forEach((f, i) => {
      const { item } = items[i];
      item.url = f.url;
      item.thumbUrl = f.thumbUrl;
      if (item._div.parentElement) item._div.classList.remove('uploading');
    });
  })();

  // Silenced promise: never rejects. Failure is detected via item.url being null.
  const upSilenced = up.catch(() => {});
  upSilenced.then(() => {
    if (items.some(({ item }) => !item.url && !item.removed)) {
      items.forEach(({ item }) => {
        if (item._div.parentElement) item._div.classList.remove('uploading');
      });
      showToast('Upload failed. Please try again.', 'error');
    }
  });

  items.forEach(({ item }) => item.uploadPromise = upSilenced);
}

document.getElementById('file-input').addEventListener('change', e => {
  uploadFiles(Array.from(e.target.files));
  e.target.value = '';
});
