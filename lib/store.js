// Minimal Redis command layer: Upstash REST when configured, in-memory otherwise.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const usingRedis = Boolean(REDIS_URL && REDIS_TOKEN);

function toObject(flat) {
  if (!Array.isArray(flat)) return flat || {};
  const obj = {};
  for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
  return obj;
}

async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands.map((c) => c.map(String))),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  const data = await res.json();
  return data.map((entry, i) => {
    if (entry.error) throw new Error(entry.error);
    return commands[i][0].toUpperCase() === 'HGETALL' ? toObject(entry.result) : entry.result;
  });
}

const mem = (globalThis.__oxMemory ||= new Map());

function memCommand([cmd, key, ...args]) {
  switch (cmd.toUpperCase()) {
    case 'GET':
      return mem.has(key) ? mem.get(key) : null;
    case 'SET':
      mem.set(key, String(args[0]));
      return 'OK';
    case 'DEL':
      return [key, ...args].filter((k) => mem.delete(k)).length;
    case 'HSET': {
      const h = mem.get(key) instanceof Map ? mem.get(key) : new Map();
      let added = 0;
      for (let i = 0; i < args.length; i += 2) {
        if (!h.has(args[i])) added++;
        h.set(String(args[i]), String(args[i + 1]));
      }
      mem.set(key, h);
      return added;
    }
    case 'HDEL': {
      const h = mem.get(key);
      if (!(h instanceof Map)) return 0;
      return args.filter((f) => h.delete(f)).length;
    }
    case 'HGETALL': {
      const h = mem.get(key);
      return h instanceof Map ? Object.fromEntries(h) : {};
    }
    case 'HLEN': {
      const h = mem.get(key);
      return h instanceof Map ? h.size : 0;
    }
    default:
      throw new Error(`Unsupported command ${cmd}`);
  }
}

export async function exec(commands) {
  if (usingRedis) return redisPipeline(commands);
  return commands.map(memCommand);
}
