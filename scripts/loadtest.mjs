// Simulates 30 players hitting the game at once. Usage: BASE=http://localhost:3000 PIN=1234 node scripts/loadtest.mjs
// Warning: resets the current game.
const BASE = process.env.BASE || 'http://localhost:3000';
const PIN = process.env.PIN || '1234';
const N = 30;

async function call(action, body) {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/game?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, ms: Date.now() - t };
}

const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];

const login = await call('hostLogin', { pin: PIN });
console.log('storage', login.data.storage);

const reset = await call('reset', { pin: PIN });
console.log('reset', reset.status, 'phase', reset.data.state?.phase, reset.data.error || '');

const joins = await Promise.all([
  ...Array.from({ length: N }, (_, i) => call('join', { name: `p${i}` })),
  ...Array.from({ length: 5 }, () => call('join', { name: 'p0' })),
  ...Array.from({ length: 3 }, (_, i) => call('join', { name: `extra${i}` })),
]);
const ok = joins.filter((j) => j.ok);
console.log(
  `joins ok=${ok.length} (expect ${N}) rejected=${joins.length - ok.length}`,
  [...new Set(joins.filter((j) => !j.ok).map((j) => j.data.error))],
);
const players = ok.map((j) => j.data);

const st = await call('state');
console.log('players in state', st.data.players.length, 'phase', st.data.state.phase);

const lat = [];
let pollErrors = 0;
let wrongPhase = 0;
await Promise.all(
  players.map(async () => {
    for (let k = 0; k < 10; k++) {
      const r = await call('state');
      lat.push(r.ms);
      if (!r.ok) pollErrors++;
      else if (r.data.state.phase !== 'lobby') wrongPhase++;
    }
  }),
);
console.log(`polls=${lat.length} errors=${pollErrors} wrongPhase=${wrongPhase} p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms max=${Math.max(...lat)}ms`);

const me = await Promise.all(players.map((p) => call('me', p)));
console.log('me exists', me.filter((m) => m.data.exists).length, '/', players.length);

const asks = await Promise.all([call('ask', { pin: PIN, seconds: 20 }), call('ask', { pin: PIN, seconds: 20 })]);
console.log('concurrent ask', asks.map((a) => `${a.status}:${a.data.error || 'round ' + a.data.state?.round}`));

const choices = await Promise.all(players.map((p, i) => call('choose', { ...p, choice: i % 2 ? 'X' : 'O' })));
console.log('choose ok', choices.filter((c) => c.ok).length, '/', players.length, 'p95', pct(choices.map((c) => c.ms), 0.95), 'ms');

const rev = await call('reveal', { pin: PIN });
console.log('reveal', rev.status, 'alive', rev.data.players?.filter((p) => p.alive).length, '(expect 15)', rev.data.error || '');

const end = await call('reset', { pin: PIN });
console.log('final reset', end.status, 'players', end.data.players?.length);
