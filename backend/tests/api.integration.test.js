'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters-long';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const app = require('../src/server');
const { authorize } = require('../src/middleware/auth');

test('GET /api/health reste accessible pour le monitoring', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
});

test('une route API protégée refuse une requête sans session', async () => {
  const response = await request(app).get('/api/utilisateurs');
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, 'Authentification requise.');
});

test('authorize refuse un rôle qui ne possède pas la route', () => {
  let statusCode;
  let body;
  const middleware = authorize('admin');
  middleware(
    { user: { id: 7, role: 'enseignant' } },
    { status(code) { statusCode = code; return this; }, json(value) { body = value; } },
    () => { throw new Error('next ne doit pas être appelé'); }
  );
  assert.equal(statusCode, 403);
  assert.match(body.error, /Accès refusé/);
});
