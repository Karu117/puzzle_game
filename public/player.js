import { api, startPolling, Arena, avatarSvg, renderTimer, renderCeremony } from '/common.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'oxq:me';

let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let watching = false;
let latest = null;
let pending = null; // optimistic choice: { round, choice }
let clock = () => Date.now();
let joinGraceUntil = 0;

const arena = new Arena($('arena'), { meId: session?.playerId });

function saveSession(s) {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  arena.setMe(s?.playerId ?? null);
}

/* ---------- Join ---------- */

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector('button');
  const name = $('name').value.trim();
  if (!name) {
    $('join-msg').textContent = '닉네임을 입력해 주세요.';
    $('name').focus();
    return;
  }
  btn.disabled = true;
  $('join-msg').textContent = '';
  try {
    const res = await api('join', { name });
    saveSession({ playerId: res.playerId, token: res.token });
    joinGraceUntil = Date.now() + 3000;
    watching = false;
    render(await api('state'));
  } catch (err) {
    $('join-msg').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('watch-btn').addEventListener('click', () => {
  watching = true;
  if (latest) render(latest);
});

$('leave-btn').addEventListener('click', async () => {
  if (session) {
    if (!confirm('게임에서 나갈까요? 다시 입장하면 새 참가자로 등록됩니다.')) return;
    api('leave', session).catch(() => {});
    saveSession(null);
  }
  watching = false;
  if (latest) render(latest);
});

/* ---------- Choosing ---------- */

async function choose(choice) {
  const me = latest && session && latest.players.find((p) => p.id === session.playerId);
  if (!me || !me.alive || latest.state.phase !== 'question' || clock() > latest.state.endsAt) return;
  const round = latest.state.round;
  pending = { round, choice };
  render(latest);
  navigator.vibrate?.(15);
  try {
    await api('choose', { ...session, choice });
  } catch (err) {
    if (pending?.round === round && pending.choice === choice) pending = null;
    $('status').textContent = err.message;
  }
}

$('btn-o').addEventListener('click', () => choose('O'));
$('btn-x').addEventListener('click', () => choose('X'));
$('arena').addEventListener('click', (e) => {
  const zone = e.target.closest('.zone[data-zone]');
  if (zone) choose(zone.dataset.zone);
});

/* ---------- Rendering ---------- */

function withPending(data) {
  if (!pending || !session || pending.round !== data.state.round || data.state.phase !== 'question') return data;
  return { ...data, choices: { ...data.choices, [session.playerId]: pending.choice } };
}

function renderJoin(data) {
  const { state, players, maxPlayers } = data;
  $('join').hidden = false;
  $('game').hidden = true;
  $('ceremony').hidden = true;
  $('join-count').textContent = `현재 ${players.length} / ${maxPlayers}명 입장`;
  $('join-preview').innerHTML = players
    .slice(-8)
    .map((p) => `<span class="mini-avatar">${avatarSvg(p.avatar)}</span>`)
    .join('');
  const open = state.phase === 'lobby' && players.length < maxPlayers;
  $('join-form').querySelector('button').disabled = !open;
  $('name').disabled = !open;
  $('watch-btn').hidden = open;
  if (!open) {
    $('join-msg').textContent =
      state.phase === 'lobby' ? '정원이 가득 찼어요. 관전으로 함께해요!' : '게임이 진행 중이에요. 다음 판에 참여할 수 있어요.';
  } else if ($('join-msg').dataset.auto) {
    $('join-msg').textContent = '';
  }
  $('join-msg').dataset.auto = open ? '' : '1';
}

function statusText(data, me) {
  const { state, choices } = data;
  const r = state.lastResult;
  if (!me) return watching ? '관전 중입니다.' : '';
  if (state.phase === 'lobby') return '입장 완료! 진행자가 시작할 때까지 기다려 주세요.';
  if (state.phase === 'question') {
    if (!me.alive) return '탈락했어요. 끝까지 함께 지켜봐요!';
    if (clock() > state.endsAt) return '시간 종료! 정답 공개를 기다리는 중…';
    const c = choices[me.id];
    return c ? `${c} 구역으로 이동했어요. 마감 전까지 바꿀 수 있어요.` : 'O 또는 X를 눌러 이동하세요!';
  }
  if (state.phase === 'reveal' && r) {
    if (r.allWrongSaved) return '전원 오답! 이번 라운드는 모두 살아남았어요.';
    if (r.eliminated.includes(me.id)) return '아쉬워요, 탈락!';
    if (!me.alive) return '관전 중입니다.';
    if (r.survivors === 1) return '최후의 1인! 곧 시상식이 시작됩니다.';
    return '정답! 살아남았어요.';
  }
  return '';
}

function render(raw) {
  latest = raw;
  const data = withPending(raw);
  const { state, players } = data;
  const me = session ? players.find((p) => p.id === session.playerId) : null;

  if (session && !me && Date.now() < joinGraceUntil) return;
  if (session && !me) {
    saveSession(null);
    $('join-msg').textContent = '게임에서 나가졌어요. 다시 입장해 주세요.';
  }
  if (!me && !watching) return renderJoin(data);

  $('join').hidden = true;
  $('game').hidden = false;

  const alive = players.filter((p) => p.alive).length;
  $('hud-round').textContent = state.round ? String(state.round) : '-';
  $('hud-alive').textContent = `${alive}명`;

  const kicker = $('q-kicker');
  const text = $('q-text');
  const card = $('question');
  card.dataset.answer = state.phase === 'reveal' ? state.question?.answer || '' : '';
  if (state.phase === 'lobby') {
    kicker.textContent = `대기실 · ${players.length}명`;
    text.textContent = '진행자가 곧 게임을 시작합니다.';
  } else if (state.question) {
    kicker.textContent = state.phase === 'reveal' ? `정답은 ${state.question.answer}!` : `문제 ${state.round}`;
    text.textContent = state.question.text;
  }

  arena.render(data);

  const canChoose = me?.alive && state.phase === 'question' && clock() <= state.endsAt;
  const myChoice = me ? data.choices[me.id] : null;
  for (const [id, c] of [['btn-o', 'O'], ['btn-x', 'X']]) {
    const b = $(id);
    b.disabled = !canChoose;
    b.setAttribute('aria-pressed', String(state.phase === 'question' && myChoice === c));
  }
  $('controls').hidden = !me || state.phase === 'ceremony';
  $('leave-btn').textContent = me ? '나가기' : '참가 화면으로';
  $('status').textContent = statusText(data, me);
  $('status').dataset.tone =
    state.phase === 'reveal' && me && state.lastResult?.eliminated.includes(me.id) ? 'bad' : state.phase === 'reveal' && me?.alive ? 'good' : '';

  const ceremony = $('ceremony');
  ceremony.hidden = state.phase !== 'ceremony';
  if (state.phase === 'ceremony') renderCeremony(ceremony, data, me?.id);
  else delete ceremony.dataset.key;
}

startPolling(
  (data, now) => {
    clock = now;
    if (pending && (data.state.round !== pending.round || data.choices[session?.playerId] === pending.choice)) pending = null;
    render(data);
  },
  () => {
    $('status').textContent = '서버 연결이 불안정해요. 다시 연결하는 중…';
  },
);

function frame() {
  if (latest) {
    const left = renderTimer($('timer'), latest.state, clock);
    if (latest.state.phase === 'question' && left <= 0 && !$('btn-o').disabled) render(latest);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
