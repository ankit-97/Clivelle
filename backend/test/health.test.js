import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

let server;
before(() => {
  server = app.listen(0);
});
after((done) => {
  server.close(done);
});

test('liveness endpoint responds without requiring SQL Server', async () => {
  const response = await request(server).get('/health/live');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'clivelle-api');
});

test('unknown API routes return a consistent 404 response', async () => {
  const response = await request(server).get('/api/v1/not-a-route');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});
