import { handle } from '../lib/pickle.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'state';

  let result;
  if (req.method === 'GET' && action !== 'state') {
    result = { status: 405, data: { error: 'POST로 요청해 주세요.' } };
  } else {
    let body = {};
    try {
      body = req.method === 'POST' ? await readBody(req) : {};
    } catch {
      result = { status: 400, data: { error: '잘못된 요청입니다.' } };
    }
    result ||= await handle(action, body);
  }

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(result.data));
}
