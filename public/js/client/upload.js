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

document.getElementById('file-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  const compressed = await Promise.all(files.map(f => compressImage(f)));
  const form = new FormData();
  compressed.forEach((blob, i) => form.append('files', blob, files[i].name));
  const r = await fetch('/api/upload', { method:'POST', headers:{'x-session-token':session.session_token}, body:form });
  if (!r.ok) { alert('Upload failed. Please try again.'); return; }
  const d = await r.json();
  const row = document.getElementById('media-prev-row');
  for (const f of d.files) {
    pendingMedia.push(f);
    const div = document.createElement('div');
    div.className = 'prev-thumb';
    div.innerHTML = f.type==='video'
      ? `<video src="${f.url}" muted></video><button onclick="rmMedia(this,'${f.url}')">×</button>`
      : `<img src="${f.thumbUrl}"><button onclick="rmMedia(this,'${f.url}')">×</button>`;
    row.appendChild(div);
  }
  e.target.value = '';
});

function rmMedia(btn, url) {
  pendingMedia = pendingMedia.filter(f=>f.url!==url);
  btn.closest('.prev-thumb').remove();
}
