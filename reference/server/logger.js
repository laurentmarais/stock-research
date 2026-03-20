import fs from 'fs';
import path from 'path';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes()) +
    ':' +
    pad2(d.getSeconds())
  );
}

function toLine(level, message, meta) {
  const base = `[${timestamp()}] [${level}] ${message}`;
  if (meta === undefined) return base;

  if (meta instanceof Error) {
    return `${base} | ${meta.stack || meta.message}`;
  }

  try {
    return `${base} | ${JSON.stringify(meta)}`;
  } catch {
    return `${base} | ${String(meta)}`;
  }
}

export function createLogger({ logFilePath }) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  const stream = fs.createWriteStream(logFilePath, { flags: 'a' });

  function clear() {
    try {
      fs.truncateSync(logFilePath, 0);
    } catch {
      // ignore
    }
  }

  function write(level, message, meta) {
    const line = toLine(level, message, meta);
    stream.write(line + '\n');

    // Keep logs visible in container/stdout too.
    if (level === 'ERROR') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  function raw(line) {
    stream.write(line + '\n');
    // eslint-disable-next-line no-console
    console.log(line);
  }

  function separator(label) {
    const line = `-------------------- ${label} --------------------`;
    raw(line);
  }

  function header(label) {
    const text = String(label ?? '').toUpperCase();
    raw(text);
    raw('-'.repeat(text.length));
  }

  return {
    info: (message, meta) => write('INFO', message, meta),
    warn: (message, meta) => write('WARN', message, meta),
    error: (message, meta) => write('ERROR', message, meta),
    clear,
    header,
    separator
  };
}
