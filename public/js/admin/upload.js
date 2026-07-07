// ── Image compression (canvas, max 1920px, 85% quality) ──
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

// ── Broadcast send-button state ──
function updateBcSendBtn() {
  const uploading = pendingBcMedia.some(i => !i.removed && !i.url);
  const btn = document.getElementById('bc-send-btn');
  btn.disabled = uploading;
  btn.title = uploading ? 'Väntar på uppladdning…' : '';
}

// ── Media upload ──
function uploadFiles(files, arr, prevEl) {
  const isBcUpload = arr === pendingBcMedia;
  const items = Array.from(files).map(file => {
    const localUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const div = document.createElement('div');
    div.className = 'prev-sm uploading';
    div.innerHTML = isVideo
      ? `<video src="${localUrl}" muted></video><button>✕</button>`
      : `<img src="${localUrl}" alt=""><button>✕</button>`;
    const item = {
      localUrl,
      fileName: file.name,
      type: isVideo ? 'video' : 'image',
      url: null,
      thumbUrl: null,
      uploadPromise: null,
      removed: false,
      _div: div
    };
    div.querySelector('button').onclick = () => {
      item.removed = true;
      const idx = arr.indexOf(item);
      if (idx >= 0) arr.splice(idx, 1);
      div.remove();
      if (isBcUpload) updateBcSendBtn();
    };
    prevEl.appendChild(div);
    arr.push(item);
    return { item, file };
  });

  if (isBcUpload) updateBcSendBtn();

  const up = (async () => {
    const compressed = await Promise.all(items.map(({ file }) => compressImage(file)));
    const form = new FormData();
    compressed.forEach((blob, i) => form.append('files', blob, items[i].file.name));
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!r.ok) throw new Error('upload failed');
    const d = await r.json();
    d.files.forEach((f, i) => {
      const { item } = items[i];
      item.url = f.url;
      item.thumbUrl = f.thumbUrl;
      if (item._div.parentElement) item._div.classList.remove('uploading');
    });
  })();

  // Silenced promise: never rejects, so await Promise.all([uploadPromise]) only throws
  // if the JS engine itself is broken. Failure is detected via item.url being null.
  const upSilenced = up.catch(() => {});
  upSilenced.then(() => {
    if (isBcUpload) updateBcSendBtn();
    // Show alert only if items actually failed (url not set)
    if (items.some(({ item }) => !item.url && !item.removed)) {
      items.forEach(({ item }) => {
        if (item._div.parentElement) item._div.classList.remove('uploading');
      });
      alert('Uppladdning misslyckades');
    }
  });

  items.forEach(({ item }) => item.uploadPromise = upSilenced);
}

document.getElementById('bc-file').addEventListener('change', e => {
  uploadFiles(Array.from(e.target.files), pendingBcMedia, document.getElementById('bc-media-prev'));
  e.target.value = '';
});
document.getElementById('chat-file-input').addEventListener('change', e => {
  uploadFiles(Array.from(e.target.files), pendingChatMedia, document.getElementById('chat-media-prev'));
  e.target.value = '';
});
