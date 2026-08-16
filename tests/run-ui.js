// Kör webbläsartesterna med appen igång.
// Tidigare fick man starta tests/serve.js för hand först; glömde man det föll
// hela sviten på ERR_CONNECTION_REFUSED, vilket ser ut som ett trasigt test.
const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 5959;
const TESTS = [
  ['tests/ui-export-pdf.js', '/tmp'],
  ['tests/ui-export-pages.js', '/tmp'],
  ['tests/ui-discount.js'],
  ['tests/ui-client-history.js', '/tmp'],
  ['tests/ui-history-cancelled.js', '/tmp'],
  ['tests/ui-feed-media.js', '/tmp'],
  ['tests/ui-client-login.js'],
  ['tests/ui-feed-arrows.js', '/tmp'],
];

const ping = () => new Promise(res => {
  const req = http.get({ host: 'localhost', port: PORT, path: '/admin' }, r => {
    r.resume(); res(r.statusCode === 200);
  });
  req.on('error', () => res(false));
  req.setTimeout(1000, () => { req.destroy(); res(false); });
});

async function waitForServer(tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (await ping()) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

const run = (cmd, args) => new Promise(res => {
  spawn(cmd, args, { stdio: 'inherit' }).on('exit', code => res(code || 0));
});

(async () => {
  // Kör redan en server på porten (t.ex. startad för hand) återanvänds den
  const existing = await ping();
  const server = existing ? null : spawn('node', ['tests/serve.js'], { stdio: 'ignore' });
  const stop = () => { if (server) server.kill(); };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  if (!await waitForServer()) {
    console.error(`FAIL — appen svarade aldrig på port ${PORT}`);
    stop();
    process.exit(1);
  }

  let failed = 0;
  for (const [file, ...args] of TESTS) {
    const code = await run('node', [file, ...args]);
    if (code !== 0) failed = code;
  }
  stop();
  process.exit(failed);
})();
