import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { exec, usingRedis, KEY_PREFIX } from './store.js';

// Separate keyspace from the O/X quiz so the two games never touch each other's data.
const PREFIX = KEY_PREFIX.replace(/^oxq:/, 'pkb:');
const K = { state: `${PREFIX}state`, lock: `${PREFIX}lock` };

const MAX_PLAYERS = 32;
const STATE_CACHE_MS = 150;
const LOCK_TTL_MS = 3000;
const LOCK_WAIT_MS = 3000;

const TIMING = {
  intro: 3500,
  serveDelay: 350,
  serveFlight: 1900,
  flightMax: 1700,
  flightMin: 1300,
  speedUpPerHit: 35,
  perfectBonus: 140,
  perfectMin: 1150,
  okPenalty: 180,
  windowEarly: 450,
  windowLate: 650,
  botMissDelay: 250,
  point: 1900,
  matchEnd: 5200,
};
const GRADE_PERFECT_MS = 130;
const GRADE_GOOD_MS = 320;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = (n = 6) => randomBytes(n).toString('hex');

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshState(prev) {
  return {
    gameId: newId(4),
    phase: 'lobby',
    target: prev?.target ?? 5,
    players: [],
    teams: [],
    rounds: [],
    match: null,
    podium: null,
    history: [],
    nextEventAt: null,
    version: 0,
    updatedAt: Date.now(),
  };
}

// ---------- Storage ----------

const parse = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

async function load() {
  const [raw] = await exec([['GET', K.state]]);
  return parse(raw) || freshState();
}

let cached = null;
function loadCached() {
  if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.promise;
  const entry = { at: Date.now(), promise: load() };
  entry.promise.catch(() => {
    if (cached === entry) cached = null;
  });
  cached = entry;
  return entry.promise;
}

function remember(state) {
  cached = { at: Date.now(), promise: Promise.resolve(state) };
}

async function save(state) {
  state.version = (state.version || 0) + 1;
  state.updatedAt = Date.now();
  state.nextEventAt = nextEventAt(state);
  await exec([['SET', K.state, JSON.stringify(state)]]);
  remember(state);
}

async function acquire(waitMs) {
  const owner = newId();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const [ok] = await exec([['SET', K.lock, owner, 'NX', 'PX', LOCK_TTL_MS]]);
    if (ok) return owner;
    if (Date.now() >= deadline) return null;
    await sleep(35 + randomInt(45));
  }
}

async function release(owner) {
  const [current] = await exec([['GET', K.lock]]);
  if (current === owner) await exec([['DEL', K.lock]]);
}

// Every write goes through this lock: the whole game lives in one key, so serialising writes keeps it consistent.
async function mutate(fn, now = Date.now()) {
  const owner = await acquire(LOCK_WAIT_MS);
  if (!owner) throw new HttpError(503, '요청이 몰리고 있어요. 잠시 후 다시 시도해 주세요.');
  try {
    const state = await load();
    tick(state, now);
    const result = await fn(state);
    tick(state, Date.now());
    await save(state);
    return { state, result };
  } finally {
    await release(owner);
  }
}

// Polls advance time-based events (missed balls, bot swings, next match) when they are due.
async function tryAdvance() {
  const owner = await acquire(0);
  if (!owner) return null;
  try {
    const state = await load();
    if (tick(state, Date.now())) await save(state);
    else remember(state);
    return state;
  } finally {
    await release(owner);
  }
}

// ---------- Helpers ----------

const playerById = (state, id) => state.players.find((p) => p.id === id);
const isBot = (state, id) => Boolean(playerById(state, id)?.bot);
const humans = (state) => state.players.filter((p) => !p.bot);

function allMatches(state) {
  return state.rounds.flat();
}

function findMatch(state, id) {
  return allMatches(state).find((m) => m.id === id) || null;
}

function sideMembers(state, match, side) {
  const teamIdx = side === 0 ? match.a : match.b;
  return state.teams[teamIdx]?.members ?? [];
}

function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10);
}

function checkPin(pin) {
  const expected = Buffer.from(String(process.env.HOST_PIN || '1234'));
  const given = Buffer.from(String(pin ?? ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, '진행자 PIN이 올바르지 않습니다.');
  }
}

function authPlayer(state, body) {
  const p = playerById(state, String(body.playerId ?? ''));
  if (!p || !p.token || p.token !== body.token) throw new HttpError(404, '참가자 정보를 찾을 수 없습니다.');
  return p;
}

// ---------- Tournament setup ----------

function makeBot(state) {
  const n = state.players.filter((p) => p.bot && !p.formerHuman).length + 1;
  const bot = {
    id: `bot-${newId(3)}`,
    name: `로봇 ${n}`,
    avatar: { c: randomInt(8), f: 4 },
    bot: true,
    joinedAt: Date.now(),
  };
  state.players.push(bot);
  return bot.id;
}

function formTeams(state) {
  const people = shuffle(humans(state).map((p) => p.id));
  const teams = [];
  if (people.length < 4) {
    for (const id of people) teams.push([id, makeBot(state)]);
  } else {
    for (let i = 0; i < people.length; i += 2) {
      teams.push(people[i + 1] ? [people[i], people[i + 1]] : [people[i], makeBot(state)]);
    }
  }
  state.teams = teams.map((members, i) => ({ id: i, members }));
}

function buildBracket(state) {
  const count = state.teams.length;
  let size = 1;
  while (size < count) size *= 2;
  const firstRoundMatches = size / 2;
  const byes = size - count;
  const order = shuffle(state.teams.map((t) => t.id));

  // Spread byes evenly through the first round instead of stacking them at the top.
  const isBye = (i) => Math.floor(((i + 1) * byes) / firstRoundMatches) > Math.floor((i * byes) / firstRoundMatches);
  const rounds = [];
  let cursor = 0;
  const first = [];
  for (let i = 0; i < firstRoundMatches; i++) {
    const a = order[cursor++];
    const b = isBye(i) ? null : order[cursor++];
    first.push({ id: `r0m${i}`, round: 0, a, b, winner: b === null ? a : null, bye: b === null, score: null });
  }
  rounds.push(first);
  for (let r = 1, n = firstRoundMatches / 2; n >= 1; r++, n /= 2) {
    rounds.push(Array.from({ length: n }, (_, i) => ({ id: `r${r}m${i}`, round: r, a: null, b: null, winner: null, bye: false, score: null })));
  }
  state.rounds = rounds;
  propagate(state);
}

function propagate(state) {
  for (let r = 1; r < state.rounds.length; r++) {
    state.rounds[r].forEach((m, i) => {
      m.a = state.rounds[r - 1][i * 2]?.winner ?? null;
      m.b = state.rounds[r - 1][i * 2 + 1]?.winner ?? null;
    });
  }
}

function nextPlayable(state) {
  return allMatches(state).find((m) => m.winner === null && m.a !== null && m.b !== null) || null;
}

function setupMatch(state, match, at) {
  state.match = {
    id: match.id,
    round: match.round,
    a: match.a,
    b: match.b,
    stage: 'intro',
    stageEndsAt: at + TIMING.intro,
    score: [0, 0],
    serving: randomInt(2),
    rotation: [0, 0],
    ballNo: 0,
    hits: 0,
    ball: null,
    lastPoint: null,
    lastHit: null,
    winnerSide: null,
  };
}

function computePodium(state) {
  const rounds = state.rounds;
  const final = rounds[rounds.length - 1][0];
  const loserOf = (m) => (m.bye || m.winner === null ? null : m.winner === m.a ? m.b : m.a);
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : [];
  return {
    first: final.winner,
    second: loserOf(final),
    third: semis.map(loserOf).filter((t) => t !== null),
  };
}

// ---------- Rally engine ----------

function makeBall(m, from, to, toSide, launchAt, flight, kind, grade = null) {
  const arriveAt = launchAt + flight;
  m.ballNo += 1;
  m.ball = {
    no: m.ballNo,
    from,
    to,
    toSide,
    kind,
    grade,
    launchAt,
    arriveAt,
    windowStart: arriveAt - TIMING.windowEarly,
    windowEnd: arriveAt + TIMING.windowLate,
  };
}

function startServe(state, at) {
  const m = state.match;
  const side = m.serving;
  const servers = sideMembers(state, m, side);
  const serverSlot = m.rotation[side] % servers.length;
  m.rotation[side] += 1;
  const receivers = sideMembers(state, m, 1 - side);
  // Pickleball serves go cross-court, so the receiver is the diagonal opponent.
  const receiver = receivers[1 - serverSlot] ?? receivers[0];
  m.stage = 'rally';
  m.hits = 0;
  m.lastHit = null;
  makeBall(m, servers[serverSlot], receiver, 1 - side, at + TIMING.serveDelay, TIMING.serveFlight, 'serve');
}

function flightAfterHit(hits, grade) {
  const base = Math.max(TIMING.flightMin, TIMING.flightMax - TIMING.speedUpPerHit * hits);
  if (grade === 'perfect') return Math.max(TIMING.perfectMin, base - TIMING.perfectBonus);
  if (grade === 'ok') return base + TIMING.okPenalty;
  return base;
}

function returnBall(state, hitterId, aimId, at, grade) {
  const m = state.match;
  const fromSide = m.ball.toSide;
  const opponents = sideMembers(state, m, 1 - fromSide);
  const target = opponents.includes(aimId) ? aimId : opponents[randomInt(opponents.length)];
  m.hits += 1;
  m.lastHit = { by: hitterId, grade, at };
  makeBall(m, hitterId, target, 1 - fromSide, at, flightAfterHit(m.hits, grade), 'hit', grade);
}

function awardPoint(state, at, reason) {
  const m = state.match;
  const scoringSide = 1 - m.ball.toSide;
  m.score[scoringSide] += 1;
  m.lastPoint = { side: scoringSide, missedBy: m.ball.to, reason, at, rally: m.hits };
  m.serving = scoringSide;
  m.ball = null;
  m.stage = 'point';
  m.stageEndsAt = at + TIMING.point;
}

function finishMatch(state, winnerSide, at) {
  const m = state.match;
  const bracketMatch = findMatch(state, m.id);
  bracketMatch.winner = winnerSide === 0 ? m.a : m.b;
  bracketMatch.score = [...m.score];
  propagate(state);
  state.history.push({ id: m.id, a: m.a, b: m.b, score: [...m.score], winner: bracketMatch.winner });
  Object.assign(m, { stage: 'end', winnerSide, ball: null, stageEndsAt: at + TIMING.matchEnd });
}

function botReturnChance(hits) {
  return Math.max(0.6, 0.9 - 0.025 * hits);
}

function nextEventAt(state) {
  if (state.phase !== 'playing' || !state.match) return null;
  const m = state.match;
  if (m.stage === 'rally') return isBot(state, m.ball.to) ? m.ball.arriveAt : m.ball.windowEnd;
  return m.stageEndsAt;
}

function step(state) {
  const m = state.match;
  if (m.stage === 'intro') return startServe(state, m.stageEndsAt);
  if (m.stage === 'rally') {
    const ball = m.ball;
    if (!isBot(state, ball.to)) return awardPoint(state, ball.windowEnd, 'miss');
    if (randomInt(1000) < botReturnChance(m.hits) * 1000) {
      const opponents = sideMembers(state, m, 1 - ball.toSide);
      const grade = randomInt(4) === 0 ? 'perfect' : 'good';
      return returnBall(state, ball.to, opponents[randomInt(opponents.length)], ball.arriveAt, grade);
    }
    return awardPoint(state, ball.arriveAt + TIMING.botMissDelay, 'miss');
  }
  if (m.stage === 'point') {
    const winner = m.score.findIndex((s) => s >= state.target);
    if (winner >= 0) return finishMatch(state, winner, m.stageEndsAt);
    return startServe(state, m.stageEndsAt);
  }
  if (m.stage === 'end') {
    const next = nextPlayable(state);
    if (next) return setupMatch(state, next, m.stageEndsAt);
    state.phase = 'champion';
    state.podium = computePodium(state);
    state.match = { ...m, stage: 'done' };
  }
}

// Replays every event that became due since the last write, using each event's own timestamp.
function tick(state, now) {
  let changed = false;
  for (let i = 0; i < 200; i++) {
    const at = nextEventAt(state);
    if (at === null || at > now) break;
    step(state);
    changed = true;
  }
  return changed;
}

// ---------- Public view ----------

function publicView(state) {
  const { players, ...rest } = state;
  return {
    state: rest,
    players: players.map(({ token, ...p }) => p),
    serverTime: Date.now(),
    maxPlayers: MAX_PLAYERS,
  };
}

// ---------- Actions ----------

const playerActions = {
  async state() {
    let state = await loadCached();
    if (state.nextEventAt && state.nextEventAt <= Date.now()) state = (await tryAdvance()) || state;
    return publicView(state);
  },

  async join(body) {
    const name = cleanName(body.name);
    if (!name) throw new HttpError(400, '닉네임을 입력해 주세요.');
    const { result } = await mutate((state) => {
      if (state.phase !== 'lobby') throw new HttpError(409, '이미 토너먼트가 진행 중입니다. 다음 판을 기다려 주세요.');
      const people = humans(state);
      if (people.length >= MAX_PLAYERS) throw new HttpError(409, `정원(${MAX_PLAYERS}명)이 가득 찼습니다.`);
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
      }
      const player = {
        id: newId(),
        token: newId(16),
        name,
        avatar: { c: randomInt(8), f: randomInt(4) },
        bot: false,
        joinedAt: Date.now(),
      };
      state.players.push(player);
      return { playerId: player.id, token: player.token, gameId: state.gameId };
    });
    return result;
  },

  async hit(body, receivedAt) {
    const { state, result } = await mutate((state) => {
      const p = authPlayer(state, body);
      const m = state.match;
      if (state.phase !== 'playing' || m?.stage !== 'rally') return { ok: false, reason: 'not-rally' };
      const ball = m.ball;
      if (ball.no !== Number(body.ballNo) || ball.to !== p.id) return { ok: false, reason: 'not-yours' };
      if (receivedAt < ball.windowStart) return { ok: false, reason: 'early' };
      if (receivedAt > ball.windowEnd) return { ok: false, reason: 'late' };
      const reported = Number(body.offset);
      const offset = Number.isFinite(reported) ? Math.abs(reported) : Math.abs(receivedAt - ball.arriveAt);
      const grade = offset <= GRADE_PERFECT_MS ? 'perfect' : offset <= GRADE_GOOD_MS ? 'good' : 'ok';
      returnBall(state, p.id, String(body.aim ?? ''), receivedAt, grade);
      return { ok: true, grade };
    }, receivedAt);
    return { ...result, ...publicView(state) };
  },

  async leave(body) {
    await mutate((state) => {
      const p = authPlayer(state, body);
      if (state.phase === 'lobby') {
        state.players = state.players.filter((x) => x.id !== p.id);
      } else {
        // Mid-tournament the team still needs two players, so a robot takes over the spot.
        Object.assign(p, { bot: true, formerHuman: true, token: null });
      }
    });
    return { ok: true };
  },

  async me(body) {
    const state = await loadCached();
    const p = playerById(state, String(body.playerId ?? ''));
    return { exists: Boolean(p && p.token && p.token === body.token), gameId: state.gameId };
  },
};

const hostActions = {
  async hostLogin() {
    const state = await load();
    return { ...publicView(state), storage: usingRedis ? 'redis' : 'memory' };
  },

  settings(body, state) {
    if (state.phase !== 'lobby') throw new HttpError(409, '대기실에서만 설정을 바꿀 수 있습니다.');
    const target = Math.round(Number(body.target));
    if ([3, 5, 7, 11].includes(target)) state.target = target;
  },

  start(_body, state) {
    if (state.phase !== 'lobby') throw new HttpError(409, '이미 토너먼트가 진행 중입니다.');
    if (humans(state).length < 2) throw new HttpError(409, '참가자가 2명 이상 있어야 시작할 수 있습니다.');
    formTeams(state);
    buildBracket(state);
    state.phase = 'playing';
    state.history = [];
    const first = nextPlayable(state);
    setupMatch(state, first, Date.now());
  },

  decide(body, state) {
    const m = state.match;
    if (state.phase !== 'playing' || !m || ['end', 'done'].includes(m.stage)) {
      throw new HttpError(409, '진행 중인 경기가 없습니다.');
    }
    const side = Number(body.side) === 1 ? 1 : 0;
    m.score[side] = Math.max(m.score[side], state.target);
    finishMatch(state, side, Date.now());
  },

  lobby(_body, state) {
    const keep = humans(state);
    Object.assign(state, freshState(state), { players: keep });
  },

  reset(_body, state) {
    Object.assign(state, freshState(state));
  },

  kick(body, state) {
    const p = playerById(state, String(body.playerId ?? ''));
    if (!p || p.bot) return;
    if (state.phase === 'lobby') state.players = state.players.filter((x) => x.id !== p.id);
    else Object.assign(p, { bot: true, formerHuman: true, token: null });
  },
};

export async function handle(action, body = {}) {
  const receivedAt = Date.now();
  try {
    if (playerActions[action]) return { status: 200, data: await playerActions[action](body, receivedAt) };
    if (hostActions[action]) {
      checkPin(body.pin);
      if (action === 'hostLogin') return { status: 200, data: await hostActions.hostLogin() };
      const { state } = await mutate((s) => hostActions[action](body, s));
      return { status: 200, data: publicView(state) };
    }
    return { status: 404, data: { error: '알 수 없는 요청입니다.' } };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
    console.error('[pickle] unexpected error', err);
    return { status: 500, data: { error: '서버 오류가 발생했습니다.' } };
  }
}
