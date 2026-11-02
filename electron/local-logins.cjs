// Reads the logins other AI tools keep on this computer: their files, and on
// macOS their keychain items. A value only ever travels from the reader's
// stdout into memory: never into argv, a log or an error message.
const { execFile, spawn } = require('child_process');
const fs = require('fs');

const MAX_BYTES = 1024 * 1024;

function listDir(folder) {
  try {
    return fs.readdirSync(folder);
  } catch {
    return [];
  }
}

function readSmallFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Keychain item names only (the "svce" attribute), never their values.
// dump-keychain without -d does not touch any secret, so it never prompts.
function keychainServices() {
  if (process.platform !== 'darwin') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['dump-keychain'], { maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }
      const names = new Set();
      for (const match of String(stdout).matchAll(/"svce"<blob>="([^"\n]{1,200})"/g)) names.add(match[1]);
      resolve([...names]);
    });
  });
}

// One keychain value. macOS may ask the person to allow this once; the
// timeout leaves time to answer.
function readKeychain(service) {
  if (process.platform !== 'darwin') return Promise.resolve({ missing: true });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ error: 'The keychain could not be opened.' });
      return;
    }
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BYTES) chunks.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ error: 'The keychain could not be opened.' });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      chunks.length = 0;
      if (code === 0 && text) resolve({ text });
      // 44: no such item.
      else if (code === 44) resolve({ missing: true });
      else if (signal) resolve({ error: 'macOS did not answer in time. Allow Usage Monitor to read it, then try again.' });
      else resolve({ error: 'macOS did not allow reading it. Choose Always Allow when macOS asks, then try again.' });
    });
  });
}

async function readSource(source) {
  let got;
  if (source.kind === 'keychain') {
    got = await readKeychain(source.service);
  } else {
    const text = readSmallFile(source.path);
    got = text == null ? { missing: true } : { text };
  }
  if (got.text && source.profile) {
    const profileText = readSmallFile(source.profile);
    if (profileText != null) got.profileText = profileText;
  }
  return got;
}

module.exports = { listDir, keychainServices, readSource };
