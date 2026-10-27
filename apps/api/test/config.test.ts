import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedAppOrigin } from '../src/config';

test('development accepts Vite localhost and private-network origins only', () => {
  process.env.NODE_ENV = 'development';
  process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
  delete process.env.ADDITIONAL_APP_ORIGINS;

  assert.equal(isAllowedAppOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedAppOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedAppOrigin('http://192.168.29.106:5173'), true);
  assert.equal(isAllowedAppOrigin('http://10.20.20.196:5173'), true);
  assert.equal(isAllowedAppOrigin('http://172.19.64.1:5173'), true);
  assert.equal(isAllowedAppOrigin('http://192.168.29.106:5174'), false);
  assert.equal(isAllowedAppOrigin('https://example.org:5173'), false);
});

test('production accepts only exact configured HTTPS origins', () => {
  process.env.NODE_ENV = 'production';
  process.env.APP_ORIGIN = 'https://assets.example.org';
  process.env.ADDITIONAL_APP_ORIGINS = 'https://www.assets.example.org';

  assert.equal(isAllowedAppOrigin('https://assets.example.org'), true);
  assert.equal(isAllowedAppOrigin('https://www.assets.example.org'), true);
  assert.equal(isAllowedAppOrigin('http://assets.example.org'), false);
  assert.equal(isAllowedAppOrigin('https://unknown.example.org'), false);
  assert.equal(isAllowedAppOrigin('http://192.168.1.20:5173'), false);

  delete process.env.ADDITIONAL_APP_ORIGINS;
  process.env.NODE_ENV = 'test';
});
