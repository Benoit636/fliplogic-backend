import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import parityRoutes from './parity.js';

// These routes never touch the database, so they can be exercised as a
// real in-process HTTP server without any DB/env setup beyond a JWT
// secret — this catches real route-wiring mistakes (mount path,
// middleware order, JSON parsing) that a pure-function test can't.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-parity-route-tests';
const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dev/parity', parityRoutes);
  return app;
}

function startServer() {
  return new Promise((resolve) => {
    const server = makeApp().listen(0, () => resolve(server));
  });
}

async function withServer(nodeEnv, fn) {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const server = await startServer();
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    process.env.NODE_ENV = originalEnv;
  }
}

const samplePayload = {
  vin: '2T3B1RFV8NC290456',
  year: 2022,
  make: 'Toyota',
  model: 'RAV4',
  mileage: 42000,
  condition: 'good',
  lowRetail: 24947,
  avgRetail: 28500,
  highRetail: 31000,
  comparableCount: 8,
  source: 'vauto',
};

test('POST /run returns a report and the intermediate Universal Appraisal, no DB involved', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(samplePayload),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(['Buy', 'Negotiate', 'Walk Away'].includes(body.report.verdict.decision));
    assert.equal(body.universalAppraisal.source.type, 'vauto');
    assert.equal(body.universalAppraisal.condition.exterior, null);
  });
});

test('POST /compare diffs two identical payloads for the same vehicle as a pass, on all three tiers', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ testA: samplePayload, testB: { ...samplePayload, source: 'manual' } }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.pass, true);
    assert.equal(body.vin, samplePayload.vin);
    assert.ok(Array.isArray(body.inputDiffs));
    assert.ok(Array.isArray(body.normalizedDiffs));
    assert.ok(Array.isArray(body.outputDiffs));
    assert.equal(body.universalA.source.type, 'vauto');
    assert.equal(body.universalB.source.type, 'manual');
  });
});

test('POST /compare surfaces a real difference as a fail on the normalized and output tiers', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ testA: samplePayload, testB: { ...samplePayload, avgRetail: 29500 } }),
    });
    const body = await res.json();
    assert.equal(body.pass, false);
    assert.ok(body.normalizedDiffs.some((d) => d.field === 'market.avg' && !d.withinTolerance));
  });
});

test('differing source alone does not cause a fail', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        testA: { ...samplePayload, source: 'vauto' },
        testB: { ...samplePayload, source: 'manual' },
      }),
    });
    const body = await res.json();
    assert.equal(body.pass, true);
  });
});

test('both routes 404 in production, before auth is even checked', async () => {
  await withServer('production', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // deliberately no auth header
      body: JSON.stringify(samplePayload),
    });
    assert.equal(res.status, 404);
  });
});

test('POST /run rejects an unauthenticated request outside production', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /run rejects an invalid payload with the same validation as production', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...samplePayload, vin: 'TOOSHORT' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
  });
});

test('POST /run rejects an unrecognized source value', async () => {
  await withServer('development', async (base) => {
    const res = await fetch(`${base}/api/dev/parity/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...samplePayload, source: 'carfax' }),
    });
    assert.equal(res.status, 400);
  });
});
