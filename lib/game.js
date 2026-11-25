import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { exec, usingRedis, KEY_PREFIX } from './store.js';

const K = {
  state: `${KEY_PREFIX}state`,
  players: `${KEY_PREFIX}players`,
  choices: `${KEY_PREFIX}choices`,
  names: `${KEY_PREFIX}names`,
  lock: `${KEY_PREFIX}hostlock`,
};
const MAX_PLAYERS = 30;
const CHOICE_GRACE_MS = 400;
// Many players poll at once; one shared read per instance per window keeps Redis load flat.
const STATE_CACHE_MS = 300;
const HOST_LOCK_MS = 5000;

const DEFAULT_BANK = [
  ['O', '바나나는 식물학적으로 베리류에 속한다.', '씨방 하나에서 자란 열매라 식물학적으로는 베리예요. 딸기는 오히려 베리가 아니에요.'],
  ['X', '금붕어의 기억력은 3초밖에 되지 않는다.', '금붕어는 몇 달 동안 기억을 유지하고 먹이 시간도 학습할 수 있어요.'],
  ['O', '문어의 심장은 3개다.', '아가미용 심장 2개와 온몸에 피를 보내는 심장 1개가 있어요.'],
  ['X', '번개는 같은 곳에 두 번 치지 않는다.', '높은 건물은 매년 여러 번 맞아요. 엠파이어스테이트 빌딩은 연간 약 20번이에요.'],
  ['O', '꿀은 상하지 않아 수천 년 동안 보관할 수 있다.', '수분이 적고 산성이라 세균이 못 자라요. 이집트 무덤에서 먹을 수 있는 꿀이 나왔어요.'],
  ['X', '만리장성은 우주에서 맨눈으로 보인다.', '폭이 좁고 주변과 색이 비슷해서 우주비행사들도 맨눈으로 보기 어렵다고 해요.'],
  ['O', '펭귄에게도 무릎이 있다.', '깃털과 몸속에 가려져 있을 뿐, 다리뼈와 무릎이 있어요.'],
  ['X', '사람은 뇌의 10%만 사용한다.', '뇌 영상을 보면 하루 동안 거의 모든 영역이 사용돼요.'],
  ['O', '달팽이에게도 이빨이 있다.', '치설이라는 혀에 수천 개의 작은 이빨이 줄지어 있어요.'],
  ['O', '북극곰의 피부는 검은색이다.', '검은 피부가 햇빛의 열을 흡수하고, 털은 투명한 빛깔이에요.'],
  ['O', '해파리는 뇌가 없다.', '뇌 대신 몸 전체에 퍼진 신경망으로 반응해요.'],
  ['X', '투우장의 소는 빨간색을 보면 흥분한다.', '소는 빨간색을 잘 구분하지 못해요. 천이 펄럭이는 움직임에 반응하는 거예요.'],
  ['O', '기린의 목뼈 개수는 사람과 같다.', '둘 다 7개예요. 기린은 뼈 하나하나가 아주 길 뿐이에요.'],
  ['X', '박쥐는 앞을 전혀 보지 못한다.', '박쥐는 눈으로도 볼 수 있고, 일부 종은 시력이 꽤 좋아요.'],
  ['O', '지구에서 가장 큰 사막은 남극이다.', '사막은 강수량으로 정해요. 남극은 비와 눈이 매우 적어 가장 큰 사막이에요.'],
].map(([answer, text, explain]) => ({ answer, text, explain }));

const cleanQuestion = (q) => ({
  text: String(q?.text ?? '').trim().slice(0, 120),
  answer: q?.answer === 'X' ? 'X' : 'O',
  explain: String(q?.explain ?? '').trim().slice(0, 200),
});

function shuffledOrder(bank, exclude = new Set()) {
  const order = bank.map((_, i) => i).filter((i) => !exclude.has(bank[i].text));
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// States saved before shuffling existed have no order; give them one lazily.
function ensureOrder(state) {
  if (!Array.isArray(state.order)) {
    state.order = shuffledOrder(state.bank).slice(state.bankIndex);
    state.bankIndex = 0;
  }
  if (!Array.isArray(state.asked)) state.asked = [];
}

function freshState(prev) {
  const bank = prev?.bank ?? DEFAULT_BANK;
  return {
    gameId: randomBytes(4).toString('hex'),
    phase: 'lobby',
    round: 0,
    question: null,
    endsAt: 0,
    seconds: prev?.seconds ?? 10,
    prizes: prev?.prizes ?? ['1등 경품', '2등 경품', '3등 경품'],
    bank,
    order: shuffledOrder(bank),
    asked: [],
    bankIndex: 0,
    lastResult: null,
    updatedAt: Date.now(),
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

async function load() {
  const [stateRaw, playersRaw, choicesRaw] = await exec([
    ['GET', K.state],
    ['HGETALL', K.players],
    ['HGETALL', K.choices],
  ]);
  const state = parse(stateRaw, null) || freshState();
  ensureOrder(state);
  const players = Object.values(playersRaw || {})
    .map((p) => parse(p, null))
    .filter(Boolean)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const choices = {};
  for (const [id, v] of Object.entries(choicesRaw || {})) {
    const [round, choice] = String(v).split(':');
    if (Number(round) === state.round) choices[id] = choice;
  }
  return { state, players, choices };
}

let cached = null; // { at, promise }

function loadCached() {
  if (cached && Date.now() - cached.at < STATE_CACHE_MS) return cached.promise;
  const entry = { at: Date.now(), promise: load() };
  entry.promise.catch(() => {
    if (cached === entry) cached = null;
  });
  cached = entry;
  return entry.promise;
}

const invalidate = () => {
  cached = null;
};

const nameKey = (name) => name.toLowerCase();

const saveState = (state) => {
  state.updatedAt = Date.now();
  return ['SET', K.state, JSON.stringify(state)];
};
const savePlayer = (p) => ['HSET', K.players, p.id, JSON.stringify(p)];

export function standings(players) {
  // Rank = 1 + number of players who strictly outlasted this one. Ties share a rank.
  const lasted = (p) => (p.alive ? Infinity : p.outRound);
  return players
    .map((p) => ({ id: p.id, rank: 1 + players.filter((o) => lasted(o) > lasted(p)).length }))
    .sort((a, b) => a.rank - b.rank);
}

function publicView({ state, players, choices }) {
  const { bank, order, asked, ...rest } = state;
  const view = {
    ...rest,
    bankSize: bank.length,
    nextBankIndex: order[state.bankIndex] ?? null,
    remaining: Math.max(0, order.length - state.bankIndex),
    orderSize: order.length,
    question: state.question && {
      text: state.question.text,
      answer: state.phase === 'question' ? null : state.question.answer,
      explain: state.phase === 'question' ? '' : state.question.explain || '',
    },
  };
  return {
    state: view,
    players: players.map(({ token, ...p }) => p),
    choices,
    standings: state.phase === 'ceremony' ? standings(players) : null,
    serverTime: Date.now(),
    maxPlayers: MAX_PLAYERS,
  };
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

function authPlayer(players, body) {
  const p = players.find((x) => x.id === body.playerId);
  if (!p || p.token !== body.token) throw new HttpError(404, '참가자 정보를 찾을 수 없습니다.');
  return p;
}

const randInt = (n) => randomBytes(1)[0] % n;

const playerActions = {
  async state() {
    return publicView(await loadCached());
  },

  async join(body) {
    const game = await load();
    const name = cleanName(body.name);
    if (!name) throw new HttpError(400, '닉네임을 입력해 주세요.');
    if (game.state.phase !== 'lobby') throw new HttpError(409, '이미 게임이 진행 중입니다. 다음 판을 기다려 주세요.');
    if (game.players.length >= MAX_PLAYERS) throw new HttpError(409, `정원(${MAX_PLAYERS}명)이 가득 찼습니다.`);
    if (game.players.some((p) => nameKey(p.name) === nameKey(name))) {
      throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
    }
    const id = randomBytes(6).toString('hex');
    // HSETNX reserves the nickname atomically, so simultaneous joins with the same name cannot both win.
    const [reserved] = await exec([['HSETNX', K.names, nameKey(name), id]]);
    if (!reserved) {
      const [owner] = await exec([['HGET', K.names, nameKey(name)]]);
      if (owner && game.players.some((p) => p.id === owner)) throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
      // Stale reservation left by a removed player: take it over.
      await exec([['HSET', K.names, nameKey(name), id]]);
    }
    const player = {
      id,
      token: randomBytes(16).toString('hex'),
      name,
      avatar: { c: randInt(10), e: randInt(5), a: randInt(6), m: randInt(4) },
      alive: true,
      outRound: null,
      joinedAt: Date.now(),
    };
    const [, count] = await exec([savePlayer(player), ['HLEN', K.players]]);
    // The capacity check above can race with other joins; roll back if we overflowed.
    if (count > MAX_PLAYERS) {
      await exec([
        ['HDEL', K.players, id],
        ['HDEL', K.names, nameKey(name)],
      ]);
      throw new HttpError(409, `정원(${MAX_PLAYERS}명)이 가득 찼습니다.`);
    }
    invalidate();
    return { playerId: player.id, token: player.token, gameId: game.state.gameId };
  },

  async choose(body) {
    const game = await load();
    const p = authPlayer(game.players, body);
    const choice = body.choice === 'O' || body.choice === 'X' ? body.choice : null;
    if (!choice) throw new HttpError(400, 'O 또는 X를 선택해 주세요.');
    if (game.state.phase !== 'question' || Date.now() > game.state.endsAt + CHOICE_GRACE_MS) {
      throw new HttpError(409, '지금은 선택할 수 없습니다.');
    }
    if (!p.alive) throw new HttpError(409, '탈락한 참가자는 선택할 수 없습니다.');
    await exec([['HSET', K.choices, p.id, `${game.state.round}:${choice}`]]);
    invalidate();
    return { ok: true };
  },

  async leave(body) {
    const game = await load();
    const p = authPlayer(game.players, body);
    await exec([
      ['HDEL', K.players, p.id],
      ['HDEL', K.choices, p.id],
      ['HDEL', K.names, nameKey(p.name)],
    ]);
    invalidate();
    return { ok: true };
  },

  async me(body) {
    const game = await loadCached();
    const p = game.players.find((x) => x.id === body.playerId);
    return { exists: Boolean(p && p.token === body.token), gameId: game.state.gameId };
  },
};

const hostActions = {
  async hostLogin() {
    const game = await load();
    return { ...publicView(game), bank: game.state.bank, storage: usingRedis ? 'redis' : 'memory' };
  },

  async settings(body, game) {
    const { state } = game;
    if (Array.isArray(body.prizes)) {
      const prizes = body.prizes.map((s) => String(s ?? '').trim().slice(0, 30)).slice(0, 10);
      if (prizes.length < 1) throw new HttpError(400, '경품 등수는 최소 1개 이상이어야 합니다.');
      state.prizes = prizes.map((s, i) => s || `${i + 1}등 경품`);
    }
    if (body.seconds !== undefined) {
      state.seconds = Math.min(60, Math.max(5, Math.round(Number(body.seconds)) || 10));
    }
    if (Array.isArray(body.bank)) {
      const bank = body.bank
        .map(cleanQuestion)
        .filter((q) => q.text)
        .slice(0, 100);
      state.bank = bank;
      state.order = shuffledOrder(bank, new Set(state.asked));
      state.bankIndex = 0;
    }
    await exec([saveState(state)]);
  },

  async ask(body, game) {
    const { state, players } = game;
    if (state.phase === 'question') throw new HttpError(409, '정답 공개 후 다음 문제를 낼 수 있습니다.');
    if (state.phase === 'ceremony') throw new HttpError(409, '시상식이 진행 중입니다. 새 게임을 시작해 주세요.');
    const alive = players.filter((p) => p.alive).length;
    if (alive < 1) throw new HttpError(409, '참가자가 1명 이상 있어야 문제를 낼 수 있습니다.');

    let question;
    if (body.text) {
      question = cleanQuestion(body);
    } else {
      question = state.bank[state.order[state.bankIndex]];
      if (!question) throw new HttpError(409, '문제 은행의 문제를 모두 사용했습니다. 직접 문제를 입력해 주세요.');
      state.bankIndex += 1;
      state.asked.push(question.text);
    }
    const seconds = Math.min(60, Math.max(5, Math.round(Number(body.seconds ?? state.seconds)) || 10));
    Object.assign(state, {
      phase: 'question',
      round: state.round + 1,
      question,
      seconds,
      endsAt: Date.now() + seconds * 1000,
      lastResult: null,
    });
    await exec([['DEL', K.choices], saveState(state)]);
  },

  async reveal(_body, game) {
    const { state, players, choices } = game;
    if (state.phase !== 'question') return;
    const answer = state.question.answer;
    const alive = players.filter((p) => p.alive);
    const wrong = alive.filter((p) => choices[p.id] !== answer);
    const allWrong = wrong.length === alive.length;
    const eliminated = allWrong ? [] : wrong;

    for (const p of eliminated) Object.assign(p, { alive: false, outRound: state.round });
    const counts = { O: 0, X: 0, none: 0 };
    for (const p of alive) counts[choices[p.id] || 'none'] += 1;

    Object.assign(state, {
      phase: 'reveal',
      endsAt: 0,
      lastResult: {
        answer,
        eliminated: eliminated.map((p) => p.id),
        allWrongSaved: allWrong,
        counts,
        survivors: alive.length - eliminated.length,
      },
    });
    await exec([...eliminated.map(savePlayer), saveState(state)]);
  },

  async ceremony(_body, game) {
    if (game.state.phase === 'question') throw new HttpError(409, '정답을 먼저 공개해 주세요.');
    game.state.phase = 'ceremony';
    await exec([saveState(game.state)]);
  },

  async rematch(_body, game) {
    const state = freshState(game.state);
    for (const p of game.players) Object.assign(p, { alive: true, outRound: null });
    await exec([['DEL', K.choices], ...game.players.map(savePlayer), saveState(state)]);
  },

  async reset(_body, game) {
    await exec([['DEL', K.choices, K.players, K.names], saveState(freshState(game.state))]);
  },

  async kick(body, game) {
    const p = game.players.find((x) => x.id === String(body.playerId));
    await exec([
      ['HDEL', K.players, String(body.playerId)],
      ['HDEL', K.choices, String(body.playerId)],
      ...(p ? [['HDEL', K.names, nameKey(p.name)]] : []),
    ]);
  },
};

const READ_ONLY_HOST = new Set(['hostLogin']);

async function withHostLock(fn) {
  const owner = randomBytes(6).toString('hex');
  const [ok] = await exec([['SET', K.lock, owner, 'NX', 'PX', HOST_LOCK_MS]]);
  if (!ok) throw new HttpError(409, '다른 진행자 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    return await fn();
  } finally {
    const [current] = await exec([['GET', K.lock]]);
    if (current === owner) await exec([['DEL', K.lock]]);
  }
}

export async function handle(action, body = {}) {
  try {
    if (playerActions[action]) return { status: 200, data: await playerActions[action](body) };
    if (hostActions[action]) {
      checkPin(body.pin);
      const run = async () => {
        const game = await load();
        const extra = await hostActions[action](body, game);
        invalidate();
        if (extra) return extra;
        const after = await load();
        return { ...publicView(after), bank: after.state.bank };
      };
      const data = READ_ONLY_HOST.has(action) ? await run() : await withHostLock(run);
      return { status: 200, data };
    }
    return { status: 404, data: { error: '알 수 없는 요청입니다.' } };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
    console.error('[game] unexpected error', err);
    return { status: 500, data: { error: '서버 오류가 발생했습니다.' } };
  }
}
