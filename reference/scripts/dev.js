const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');

function run(label, args, { env } = {}) {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    stdio: 'inherit',
    env: env || process.env
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    if (typeof code === 'number' && code !== 0) {
      process.exit(code);
    }
  });
  return child;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(false));
    // Don't specify host: match Node/Express default behavior (can bind :: / all interfaces).
    srv.listen({ port }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function pickPort(startPort) {
  let p = startPort;
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await isPortFree(p);
    if (ok) return p;
    p += 1;
  }
  return startPort;
}

(async () => {
  // Default to 3001 because 3000 is commonly occupied by Docker on dev machines.
  const preferred = Number(process.env.DEV_SERVER_PORT || process.env.PORT || 3001);
  const port = await pickPort(Number.isFinite(preferred) ? preferred : 3001);
  const apiTarget = `http://localhost:${port}`;

  if (port !== preferred) {
    // eslint-disable-next-line no-console
    console.log(`[dev] Port ${preferred} is in use; using ${port} instead.`);
  }

  const serverEnv = { ...process.env, PORT: String(port) };
  const clientEnv = { ...process.env, VITE_API_TARGET: apiTarget };

  const server = run('server', ['run', 'dev', '-w', 'server'], { env: serverEnv });
  const client = run('client', ['run', 'dev', '-w', 'client'], { env: clientEnv });

  function shutdown() {
    try { server.kill('SIGTERM'); } catch {}
    try { client.kill('SIGTERM'); } catch {}
    setTimeout(() => process.exit(0), 500).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
