import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

let server;
before(() => { server = app.listen(0); });
after(done => { server.close(done); });

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

test('readiness reports that SQL Server is not configured', async () => {
  const response = await request(server).get('/health/ready');
  assert.equal(response.status, 503);
  assert.equal(response.body.database, 'not_configured');
});

test('catalog rejects invalid filters before querying SQL Server', async () => {
  const response = await request(server).get('/api/v1/products?page=0');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_QUERY');
});

test('catalog reports unavailable when SQL Server is not configured', async () => {
  const [categories, products] = await Promise.all([
    request(server).get('/api/v1/categories'),
    request(server).get('/api/v1/products')
  ]);
  for (const response of [categories, products]) {
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'DATABASE_NOT_CONFIGURED');
  }
});

test('CORS allows the local storefront origin', async () => {
  const response = await request(server).options('/api/v1/products')
    .set('Origin', 'http://127.0.0.1:4173')
    .set('Access-Control-Request-Method', 'GET');
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:4173');
});

test('CORS rejects unconfigured browser origins', async () => {
  const response = await request(server).get('/health/live').set('Origin', 'https://example.invalid');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('signup validates identity and password before contacting the database', async () => {
  const response = await request(server).post('/api/v1/auth/signup')
    .send({ fullName: 'A', email: '', phone: '', password: 'short', confirmPassword: 'short' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_SIGNUP');
});

test('sign-in validates the identifier and password before contacting the database', async () => {
  const response = await request(server).post('/api/v1/auth/signin')
    .send({ identifier: 'bad', password: 'short' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_SIGNIN');
});

test('customer resources require a valid persisted session', async () => {
  const [cart, addresses, orders, wishlist] = await Promise.all([
    request(server).get('/api/v1/customer/cart'),
    request(server).get('/api/v1/customer/addresses'),
    request(server).get('/api/v1/customer/orders'),
    request(server).get('/api/v1/customer/wishlist')
  ]);
  for (const response of [cart, addresses, orders, wishlist]) {
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTH_REQUIRED');
  }
});

test('newsletter rejects invalid email without a database connection', async () => {
  const response = await request(server).post('/api/v1/newsletter').send({ email: 'not-an-email' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_EMAIL');
});
