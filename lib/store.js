// Minimal Redis command layer: Upstash REST when configured, in-memory otherwise.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REQUEST_TIMEOUT_MS = 4000;

export const usingRedis = Boolean(REDIS_URL && REDIS_TOKEN);

// Local/preview runs share the Redis database with production, so keep their keys apart.
export const KEY_PREFIX = process.env.VERCEL_ENV === 'production' ? 'oxq:' : `oxq:${process.env.VERCEL_ENV || 'local'}:`;

if (!usingRedis && process.env.VERCEL) {
  console.warn('[store] Redis is not configured. Serverless instances will NOT share game state.');
}

function toObject(flat) {
  if (!Array.isArray(flat)) return flat || {};
  const obj = {};
  for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
  return obj;
}

async function redisPipeline(commands, attempt = 0) {
  let res;
  try {
    res = await fetch(`${REDIS_URL.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network hiccup or timeout: retry once, but only for read-only pipelines so writes never double-apply.
    if (attempt === 0 && commands.every(isReadOnly)) return redisPipeline(commands, 1);
    throw err;
  }
  if (res.status >= 500 && attempt === 0 && commands.every(isReadOnly)) return redisPipeline(commands, 1);
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  const data = await res.json();
  return data.map((entry, i) => {
    if (entry.error) throw new Error(entry.error);
    return commands[i][0].toUpperCase() === 'HGETALL' ? toObject(entry.result) : entry.result;
  });
}

const READ_ONLY = new Set(['GET', 'HGETALL', 'HLEN', 'HGET']);
const isReadOnly = (c) => READ_ONLY.has(String(c[0]).toUpperCase());

const mem = (globalThis.__oxMemory ||= new Map());
const memExpiry = (globalThis.__oxMemoryExpiry ||= new Map());

function memGet(key) {
  const exp = memExpiry.get(key);
  if (exp && exp <= Date.now()) {
    mem.delete(key);
    memExpiry.delete(key);
  }
  return mem.get(key);
}

function memHash(key, create) {
  const h = memGet(key);
  if (h instanceof Map) return h;
  if (!create) return null;
  const fresh = new Map();
  mem.set(key, fresh);
  return fresh;
}

function memCommand([cmd, key, ...args]) {
  switch (cmd.toUpperCase()) {
    case 'GET': {
      const v = memGet(key);
      return v === undefined ? null : v;
    }
    case 'SET': {
      const opts = args.slice(1).map((a) => String(a).toUpperCase());
      if (opts.includes('NX') && memGet(key) !== undefined) return null;
      mem.set(key, String(args[0]));
      const px = opts.indexOf('PX');
      if (px >= 0) memExpiry.set(key, Date.now() + Number(args[px + 2]));
      else memExpiry.delete(key);
      return 'OK';
    }
    case 'DEL':
      return [key, ...args].filter((k) => {
        memExpiry.delete(k);
        return mem.delete(k);
      }).length;
    case 'HSET': {
      const h = memHash(key, true);
      let added = 0;
      for (let i = 0; i < args.length; i += 2) {
        if (!h.has(String(args[i]))) added++;
        h.set(String(args[i]), String(args[i + 1]));
      }
      return added;
    }
    case 'HSETNX': {
      const h = memHash(key, true);
      if (h.has(String(args[0]))) return 0;
      h.set(String(args[0]), String(args[1]));
      return 1;
    }
    case 'HGET':
      return memHash(key)?.get(String(args[0])) ?? null;
    case 'HDEL': {
      const h = memHash(key);
      return h ? args.filter((f) => h.delete(String(f))).length : 0;
    }
    case 'HGETALL': {
      const h = memHash(key);
      return h ? Object.fromEntries(h) : {};
    }
    case 'HLEN':
      return memHash(key)?.size ?? 0;
    default:
      throw new Error(`Unsupported command ${cmd}`);
  }
}

export async function exec(commands) {
  if (usingRedis) return redisPipeline(commands);
  return commands.map(memCommand);
}
