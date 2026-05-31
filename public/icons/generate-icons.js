// Run once: node generate-icons.js
// Generates simple SVG-based PNG icons for the PWA
const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Text "VP"
  ctx.fillStyle = '#4a9eff';
  ctx.font = `bold ${size * 0.38}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VP', size / 2, size / 2);

  fs.writeFileSync(`icon-${size}.png`, canvas.toBuffer('image/png'));
  console.log(`Created icon-${size}.png`);
}

makeIcon(192);
makeIcon(512);
