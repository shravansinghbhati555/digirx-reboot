/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * `pnpm dev:full` entry point.
 *
 * Bring up the infra dependencies (MongoDB, Redis, MinIO, face-svc)
 * via docker compose, then spawn `nest start --watch`. On Ctrl+C
 * (SIGINT) / parent process exit we tear the compose stack down so a
 * developer's "stop the server" gesture cleans up everything in one
 * go — no leftover containers running in the background after the
 * editor / terminal is closed.
 *
 * Run from the backend/ directory:
 *   pnpm dev:full
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

// docker-compose.yml lives at the project root, one level above
// backend/. Resolve absolutely so `cwd` of this script doesn't matter.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const IS_WINDOWS = process.platform === 'win32';

// ANSI helpers — keep teardown output visually distinct from the
// firehose of nest + container logs so the operator can see exactly
// what stopped and what didn't.
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const log = (msg) => console.log(`${cyan('[dev:full]')} ${msg}`);
const ok = (msg) => console.log(`${cyan('[dev:full]')} ${green('✓')} ${msg}`);
const warn = (msg) => console.log(`${cyan('[dev:full]')} ${yellow('!')} ${msg}`);
const err = (msg) => console.error(`${cyan('[dev:full]')} ${red('✗')} ${msg}`);

let dockerOk = false;
let nestChild = null;
let teardownStarted = false;

function runOnce(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: IS_WINDOWS, // PATH lookup is friendlier with shell:true on Windows.
      ...opts,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function dockerUp() {
  log('starting infra (docker compose up -d)…');
  await runOnce('docker', ['compose', 'up', '-d']);
  dockerOk = true;
  ok('infra up · mongo · redis · minio · face-svc');
}

async function dockerDown() {
  if (!dockerOk) {
    warn('infra was never marked up — skipping docker compose down');
    return;
  }
  log('stopping infra (docker compose down)…');
  log(dim('  → mongodb · redis · minio · minio-init · face-svc'));
  try {
    await runOnce('docker', ['compose', 'down']);
    ok('infra stopped · all containers down');
  } catch (e) {
    err(`docker compose down failed: ${e.message}`);
  }
}

function startNest() {
  log('starting backend (nest start --watch)…');
  nestChild = spawn(
    IS_WINDOWS ? 'nest.cmd' : 'nest',
    ['start', '--watch'],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: IS_WINDOWS,
      env: process.env,
    },
  );
  nestChild.on('exit', (code) => {
    if (teardownStarted) {
      ok(`nest exited (code ${code ?? 0})`);
      return;
    }
    warn(`nest exited unexpectedly (code ${code ?? 0}) — tearing down infra`);
    teardown(code ?? 0).catch(() => undefined);
  });
}

async function teardown(exitCode) {
  if (teardownStarted) {
    warn('teardown already in progress — ignoring duplicate signal');
    return;
  }
  teardownStarted = true;
  console.log(''); // visual separator after the Ctrl+C ^C glyph
  log('shutdown requested — beginning teardown');

  if (nestChild && nestChild.exitCode == null) {
    log('killing backend (nest)…');
    try {
      nestChild.kill('SIGINT');
      // Brief grace period so nest can flush its final logs before
      // docker compose down spams the terminal.
      await new Promise((r) => setTimeout(r, 400));
      if (nestChild.exitCode == null) {
        warn('nest didn\'t exit on SIGINT; force-killing');
        try { nestChild.kill('SIGKILL'); } catch { /* ignore */ }
      } else {
        ok('backend killed');
      }
    } catch (e) {
      err(`failed to kill nest: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    log('backend already stopped');
  }

  await dockerDown();
  ok('teardown complete — bye');
  process.exit(exitCode);
}

// Signal handling. Ctrl+C in Windows cmd / PowerShell sends SIGINT
// to Node; SIGTERM covers `kill <pid>` on macOS / Linux. The boolean
// guard makes teardown idempotent so a double Ctrl+C doesn't double-
// down docker.
process.on('SIGINT', () => { log('SIGINT received (Ctrl+C)'); teardown(0); });
process.on('SIGTERM', () => { log('SIGTERM received'); teardown(0); });

(async () => {
  try {
    await dockerUp();
    startNest();
  } catch (e) {
    err(`startup failed: ${e.message}`);
    await teardown(1);
  }
})();
