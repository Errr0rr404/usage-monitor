// How a remote computer is reached. The home network comes first. When it
// cannot be reached (away from home Wi-Fi), the same computer is tried through
// a tunnel alias from ~/.ssh/config, by convention "<alias>-r". Pure functions:
// the main process passes in the ssh runner.
const { hostOf, explainSshError } = require('./computers.cjs');

const LAN_CONNECT_TIMEOUT_S = 4;
const TUNNEL_CONNECT_TIMEOUT_S = 10;
// While a computer is answering through the tunnel, the home network is
// tried again only this often, so a refresh every 5 seconds stays quick.
const LAN_RETRY_MS = 60 * 1000;

function cleanAlias(value) {
  const alias = String(value || '').trim();
  return /^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(alias) ? alias : '';
}

// The tunnel alias for a saved computer, or null. An explicit `fallback` on
// the computer wins. Otherwise "<name>-r" is used when ~/.ssh/config has it,
// where <name> is the saved alias, or the alias whose HostName is the saved address.
function tunnelFor(computer, hosts) {
  const aliases = new Map((hosts || []).map((host) => [String(host.alias).toLowerCase(), host]));
  const explicit = cleanAlias(computer?.fallback);
  if (explicit) return { target: explicit, port: null, explicit: true };
  const host = hostOf(computer?.target);
  if (!host) return null;
  const bases = [host];
  for (const entry of hosts || []) {
    if (entry.hostName && hostOf(entry.hostName) === host && !bases.includes(entry.alias.toLowerCase())) {
      bases.push(entry.alias.toLowerCase());
    }
  }
  for (const base of bases) {
    if (base.endsWith('-r')) continue;
    const entry = aliases.get(`${base}-r`);
    if (entry) return { target: entry.alias, port: null, explicit: false };
  }
  return null;
}

// Failures where another route could still work. A refused login or an
// untrusted key would fail the same way through the tunnel.
function isConnectivityFailure({ stderr = '', timedOut = false, code = 0 } = {}) {
  if (timedOut) return true;
  const text = String(stderr);
  if (/Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(text)) return false;
  if (/timed out|No route to host|Network is unreachable|Could not resolve hostname|Name or service not known|nodename nor servname|Connection refused|Connection (closed|reset)|Connection to .* (closed|timed out)|kex_exchange_identification|banner exchange|Host is down/i.test(text)) return true;
  // ssh exits 255 for its own connection errors.
  return code === 255 && !text.trim();
}

// The order to try. `last` is { route, lanAt } from the previous reading.
function planRoutes({ computer, tunnel, last = null, now = Date.now() }) {
  const lan = { route: 'lan', target: computer.target, port: computer.port || null, connectTimeout: LAN_CONNECT_TIMEOUT_S };
  if (!tunnel) return [{ ...lan, connectTimeout: undefined }];
  const viaTunnel = { route: 'tunnel', target: tunnel.target, port: tunnel.port || null, connectTimeout: TUNNEL_CONNECT_TIMEOUT_S };
  if (last?.route === 'tunnel' && now - (last.lanAt || 0) < LAN_RETRY_MS) return [viaTunnel, lan];
  return [lan, viaTunnel];
}

function tunnelNote(tunnel) {
  return tunnel?.target ? ` (${tunnel.target})` : '';
}

// Reads one computer over its routes. run(step) resolves to
// { ok: true, reading } or { ok: false, error, network } and never throws.
// `memory` is a Map the caller keeps between readings.
async function readRoutes({ computer, hosts, run, memory = new Map(), now = () => Date.now() }) {
  const tunnel = tunnelFor(computer, hosts);
  const steps = planRoutes({ computer, tunnel, last: memory.get(computer.id) || null, now: now() });
  const tunnelName = tunnel ? tunnel.target : null;
  const failures = [];
  for (const step of steps) {
    const result = await run(step);
    if (result.ok) {
      const before = memory.get(computer.id);
      memory.set(computer.id, { route: step.route, lanAt: step.route === 'lan' ? now() : before?.lanAt || 0 });
      return { ...result.reading, via: step.route, tunnel: tunnelName };
    }
    failures.push({ step, result });
    if (!result.network) break;
  }
  // Nothing answered: next time start from the home network again.
  memory.delete(computer.id);
  if (failures.length === 1) return { ok: false, error: failures[0].result.error, via: null, tunnel: tunnelName };
  const parts = failures.map(({ step, result }) => `${step.route === 'lan' ? 'Home network' : `Tunnel${tunnelNote(step)}`}: ${result.error}`);
  return { ok: false, error: parts.join(' '), via: null, tunnel: tunnelName };
}

// What one ssh attempt returned, as { ok, reading | error, network }.
function judgeAttempt(result, parseProbe, { target } = {}) {
  if (result.spawnError) return { ok: false, error: 'SSH is not installed on this computer.', network: false };
  if (result.timedOut) return { ok: false, error: 'No answer in time.', network: true };
  if (result.code !== 0 && !String(result.stdout).includes('@@end')) {
    return { ok: false, error: explainSshError(result.stderr, result.code, { target }), network: isConnectivityFailure(result) };
  }
  const reading = parseProbe(result.stdout);
  return reading?.ok ? { ok: true, reading } : { ok: false, error: reading?.error || 'The reading failed.', network: false };
}

module.exports = {
  LAN_CONNECT_TIMEOUT_S,
  TUNNEL_CONNECT_TIMEOUT_S,
  LAN_RETRY_MS,
  tunnelFor,
  isConnectivityFailure,
  planRoutes,
  readRoutes,
  judgeAttempt,
};
