#!/usr/bin/env node
/**
 * Batch runner for the Phase 5 vAuto-vs-independent parity test.
 *
 * Reads a fixtures file of { label, testA, testB } cases — one per
 * vehicle, testA being what vAuto Capture actually sent and testB the
 * identical deal entered manually — POSTs each pair to the dev-only
 * POST /api/dev/parity/compare endpoint (Audit §9), and prints/writes a
 * combined pass/fail report. No acquisition logic lives in this script;
 * it only calls the one real engine through the one real endpoint.
 *
 * Usage:
 *   node scripts/parity-batch.mjs \
 *     --fixtures scripts/parity-fixtures.example.json \
 *     --base-url http://localhost:4000 \
 *     --token "$PARITY_API_TOKEN" \
 *     --out scripts/parity-report.json
 *
 * All flags are optional and fall back to env vars / sensible defaults —
 * see parseArgs() below. Exits non-zero if any case fails or errors, so
 * it's usable as a CI gate later without changes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    fixtures: process.env.PARITY_FIXTURES || path.join(SCRIPT_DIR, 'parity-fixtures.example.json'),
    baseUrl: process.env.PARITY_API_URL || 'http://localhost:4000',
    token: process.env.PARITY_API_TOKEN || null,
    out: process.env.PARITY_OUT || path.join(SCRIPT_DIR, 'parity-report.json'),
  };

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--fixtures') args.fixtures = value;
    else if (flag === '--base-url') args.baseUrl = value;
    else if (flag === '--token') args.token = value;
    else if (flag === '--out') args.out = value;
    else if (flag === '--help' || flag === '-h') {
      args.help = true;
      i -= 1; // --help takes no value
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/parity-batch.mjs [options]

  --fixtures <path>   JSON file of { cases: [{ label, testA, testB, tolerances? }] }
                       Default: scripts/parity-fixtures.example.json (or $PARITY_FIXTURES)
  --base-url <url>    Backend base URL. Default: http://localhost:4000 (or $PARITY_API_URL)
  --token <jwt>       FlipLogic auth token (Bearer). Required — or set $PARITY_API_TOKEN
  --out <path>        Where to write the combined JSON report.
                       Default: scripts/parity-report.json (or $PARITY_OUT)

The target server must be running with NODE_ENV !== 'production' — the
parity routes return 404 in production on purpose.`);
}

async function loadFixtures(fixturesPath) {
  let raw;
  try {
    raw = await readFile(fixturesPath, 'utf-8');
  } catch (err) {
    throw new Error(`Could not read fixtures file at ${fixturesPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Fixtures file at ${fixturesPath} is not valid JSON: ${err.message}`);
  }

  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`Fixtures file at ${fixturesPath} has no "cases" array (or an empty one).`);
  }
  return cases;
}

async function runCase(baseUrl, token, testCase, index) {
  const label = testCase.label || `Case ${index + 1}`;

  if (!testCase.testA || !testCase.testB) {
    return { label, pass: false, error: 'Fixture is missing testA and/or testB' };
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/api/dev/parity/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        testA: testCase.testA,
        testB: testCase.testB,
        tolerances: testCase.tolerances,
      }),
    });
  } catch (err) {
    return {
      label,
      pass: false,
      error: `Could not reach ${baseUrl} — is the backend running with NODE_ENV !== 'production'? (${err.message})`,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { label, pass: false, error: `Non-JSON response (HTTP ${response.status})` };
  }

  if (response.status === 404) {
    return { label, pass: false, error: 'Got 404 — the target server is likely running with NODE_ENV=production, where these routes are hidden on purpose.' };
  }
  if (response.status === 401) {
    return { label, pass: false, error: 'Got 401 — the --token / $PARITY_API_TOKEN is missing, expired, or invalid.' };
  }
  if (!response.ok || body.ok === false) {
    return { label, pass: false, error: body.error || `HTTP ${response.status}` };
  }

  return {
    label,
    vin: body.vin,
    pass: body.pass,
    fieldDiffs: body.fieldDiffs,
    missingInputs: body.missingInputs,
  };
}

function printResult(result) {
  const status = result.pass ? 'PASS' : 'FAIL';
  const vinPart = result.vin ? ` VIN ${result.vin}` : '';
  console.log(`[${status}]${vinPart} — ${result.label}`);

  if (result.error) {
    console.log(`         ${result.error}`);
    return;
  }

  if (!result.pass) {
    for (const diff of result.fieldDiffs) {
      if (!diff.withinTolerance) {
        console.log(`         ✗ ${diff.field}: testA=${diff.testA}  testB=${diff.testB}  diff=${diff.diff}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.token) {
    console.error('Missing --token (or $PARITY_API_TOKEN). Run with --help for usage.');
    process.exitCode = 1;
    return;
  }

  const cases = await loadFixtures(args.fixtures);
  console.log(`Running ${cases.length} parity case${cases.length === 1 ? '' : 's'} against ${args.baseUrl} ...\n`);

  const results = [];
  for (let i = 0; i < cases.length; i += 1) {
    const result = await runCase(args.baseUrl, args.token, cases[i], i);
    printResult(result);
    results.push(result);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    fixtures: args.fixtures,
    total: results.length,
    passed,
    failed,
    results,
  };

  await writeFile(args.out, JSON.stringify(report, null, 2));

  console.log(`\n${passed} / ${results.length} passed`);
  console.log(`Full report written to ${args.out}`);

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
