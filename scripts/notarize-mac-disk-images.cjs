const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required to notarize the Mac disk images.`);
    process.exit(1);
  }
  return value;
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function staple(file) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      run('xcrun', ['stapler', 'staple', file]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      execFileSync('sleep', [String(attempt * 10)]);
    }
  }
  throw lastError;
}

function runCapture(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

function diskImages() {
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter((name) => name.endsWith('.dmg'))
    .map((name) => path.join(distDir, name));
}

function mountedVolume(attachOutput) {
  const lines = attachOutput.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const volume = last.split('\t').pop();
  if (!volume || !volume.startsWith('/Volumes/')) {
    throw new Error(`Could not find the mounted disk image volume in:\n${attachOutput}`);
  }
  return volume;
}

function assess(appPath) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  run('xcrun', ['stapler', 'validate', appPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
}

function assessDiskImage(dmgPath) {
  const attachOutput = runCapture('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly']);
  const volume = mountedVolume(attachOutput);
  try {
    const appPath = path.join(volume, 'Usage Monitor.app');
    if (!fs.existsSync(appPath)) {
      throw new Error(`Usage Monitor.app was not on ${volume}`);
    }
    assess(appPath);
    const copyPath = path.join(os.tmpdir(), `usage-monitor-gatekeeper-${process.pid}`);
    fs.rmSync(copyPath, { recursive: true, force: true });
    run('ditto', [appPath, copyPath]);
    run('xattr', ['-w', 'com.apple.quarantine', '0083;00000000;Safari;00000000-0000-0000-0000-000000000000', copyPath]);
    assess(copyPath);
    fs.rmSync(copyPath, { recursive: true, force: true });
  } finally {
    run('hdiutil', ['detach', volume]);
  }
}

function main() {
  if (process.platform !== 'darwin') return;
  const key = requireEnv('APPLE_API_KEY');
  const keyId = requireEnv('APPLE_API_KEY_ID');
  const issuer = requireEnv('APPLE_API_ISSUER');
  const images = diskImages();
  if (!images.length) {
    console.error('No disk images were found in dist/.');
    process.exit(1);
  }
  for (const image of images) {
    console.log(`Notarizing ${path.basename(image)}`);
    run('xcrun', [
      'notarytool', 'submit', image,
      '--key', key,
      '--key-id', keyId,
      '--issuer', issuer,
      '--wait',
    ]);
    staple(image);
    run('xcrun', ['stapler', 'validate', image]);
    assessDiskImage(image);
  }
}

main();
