'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters-long';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const app = require('../src/server');

test('GET /api/health est disponible', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
});

test('Transition année scolaire - Protection authentification des routes', async () => {
  const response = await request(app).get('/api/annees-scolaires');
  assert.equal(response.statusCode, 401);
});
