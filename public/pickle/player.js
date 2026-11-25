import {
  api,
  poll,
  clock,
  Court,
  Fireworks,
  avatarSvg,
  escapeHtml,
  playerMap,
  renderBracket,
  renderPodium,
  renderScoreboard,
  teamNames,
  teamOf,
  teamStatus,
} from '/pickle/shared.js';

const STORAGE_KEY = 'pkb:me';
const $ = (id) => document.getElementById(id);

let me = loadMe();
let data = null;
let poller = null;
let sentBall = 0;
const court = new Court($('court'), { meId: me?.playerId });
const fireworks = new Fireworks($('fireworks'));
const aimButtons = [...document.querySelectorAll('#aim button')];

function loadMe() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveMe(value) {
  me = value;
  court.meId = value?.playerId ?? null;
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else localStorage.removeItem(STORAGE_KEY);
}

function showJoin(message = '') {
  $('join').hidden = false;
  $('game').hidden = true;
  $('join-error').textContent = message;
  fireworks.stop();
}

// ---------- Join ----------
$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) {
    $('join-error').textContent = '닉네임을 입력해 주세요.';
    return;
  }
  const button = e.submitter || e.target.querySelector('button');
  button.disabled = true;
  try {
    const res = await api('join', { name });
    saveMe(res);
    $('join-error').textContent = '';
    start();
  } catch (err) {
    $('join-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('leave').addEventListener('click', async () => {
  const inTournament = data?.state.phase === 'playing';
  const msg = inTournament ? '나가면 로봇이 대신 경기해요. 정말 나갈까요?' : '대기실에서 나갈까요?';
  if (!confirm(msg)) return;
  try {
    await api('leave', { playerId: me.playerId, token: me.token });
  } catch {}
  saveMe(null);
  showJoin();
});

// ---------- Swinging ----------
function myBall() {
  const m = data?.state.match;
  if (!m || data.state.phase !== 'playing' || m.stage !== 'rally' || !m.ball) return null;
  return m.ball.to === me?.playerId ? m.ball : null;
}

function opponents() {
  const m = data?.state.match;
  if (!m) return [];
  const { teams } = data.state;
  const mineA = teams[m.a].members.includes(me?.playerId);
  const mineB = teams[m.b].members.includes(me?.playerId);
  if (!mineA && !mineB) return [];
  const opp = teams[mineA ? m.b : m.a].members;
  return [...opp].sort((x, y) => court.posOf(x).x - court.posOf(y).x);
}

async function swing(index) {
  const ball = myBall();
  const target = opponents()[index];
  if (!ball || !target || sentBall === ball.no) return;
  const now = clock.now();
  if (now < ball.windowStart - 80) {
    setHint('아직 일러요! 원이 맞을 때 눌러요', '');
    return;
  }
  sentBall = ball.no;
  court.flash(me.playerId, 'swing');
  try {
    const res = await api('hit', { playerId: me.playerId, token: me.token, ballNo: ball.no, aim: target, offset: Math.round(now - ball.arriveAt) });
    if (!res.ok && res.reason === 'early') sentBall = 0;
    if (!res.ok && res.reason === 'late') setHint('아쉽게 놓쳤어요!', '');
    apply(res);
  } catch {
    sentBall = 0;
  }
}

aimButtons.forEach((btn, i) => btn.addEventListener('click', () => swing(i)));
document.addEventListener('keydown', (e) => {
  if (e.repeat || $('controls').hidden) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') swing(0);
  if (e.key === 'ArrowRight' || e.key === 'd') swing(1);
});

let lastHint = '';
function setHint(text, tone) {
  if (text === lastHint) return;
  lastHint = text;
  $('hint').textContent = text;
  $('hint').dataset.tone = tone;
}

let vibratedFor = 0;
function controlsFrame() {
  requestAnimationFrame(controlsFrame);
  if ($('controls').hidden || !data) return;
  const m = data.state.match;
  const ball = myBall();
  const now = clock.now();
  const hot = Boolean(ball && now >= ball.windowStart && now <= ball.windowEnd && sentBall !== ball.no);
  $('aim').classList.toggle('is-hot', hot);
  for (const btn of aimButtons) btn.disabled = !ball || sentBall === ball?.no;
  if (hot && vibratedFor !== ball.no) {
    vibratedFor = ball.no;
    navigator.vibrate?.(30);
  }
  if (m.stage === 'intro') setHint('곧 경기가 시작돼요. 준비!', '');
  else if (m.stage === 'point') setHint('득점! 다음 서브를 준비하세요', '');
  else if (m.stage === 'end') setHint('경기 종료', '');
  else if (ball && sentBall === ball.no) setHint('받아쳤어요!', '');
  else if (hot) setHint('지금 치세요!', 'hot');
  else if (ball) setHint('공이 날아오고 있어요...', '');
  else if (m.ball && teamOf(data.state, me.playerId)?.members.includes(m.ball.to)) setHint('파트너 차례예요', '');
  else setHint('상대 팀 차례예요', '');
}
requestAnimationFrame(controlsFrame);

// ---------- Rendering ----------
function apply(next) {
  if (!next?.state) return;
  if (data && next.state.version < data.state.version && next.state.gameId === data.state.gameId) return;
  data = next;
  render();
}

function renderStatus(players) {
  const { state } = data;
  const el = $('status');
  if (state.phase === 'lobby') {
    el.dataset.tone = '';
    el.innerHTML = '진행자가 시작하면 랜덤으로 2인 1팀이 정해져요. <small>잠시만 기다려 주세요</small>';
    return;
  }
  const team = teamOf(state, me.playerId);
  const partner = team?.members.find((id) => id !== me.playerId);
  const partnerName = escapeHtml(players.get(partner)?.name ?? '');
  const status = teamStatus(state, team?.id);
  const text = {
    playing: ['play', `경기 중! 파트너: ${partnerName}`],
    waiting: ['', `파트너: ${partnerName} <small>· 다음 경기를 기다리며 관전 중</small>`],
    won: ['win', `승리! 파트너 ${partnerName}와 다음 라운드로`],
    lost: ['out', `아쉽게 패배했어요 <small>· 이제 관전 모드예요</small>`],
    out: ['out', `탈락 · 관전 중 <small>· 파트너: ${partnerName}</small>`],
    champion: ['win', `우승! 파트너 ${partnerName}와 함께 정상에 섰어요`],
    none: ['out', '관전 중'],
  }[status];
  el.dataset.tone = text[0];
  el.innerHTML = text[1];
}

function render() {
  const { state, players: list } = data;
  const players = playerMap(data);
  const self = players.get(me.playerId);
  if (!self || self.bot) {
    saveMe(null);
    showJoin(state.phase === 'lobby' ? '' : '토너먼트가 새로 시작됐거나 퇴장 처리되었어요. 다시 입장해 주세요.');
    return;
  }
  $('join').hidden = true;
  $('game').hidden = false;
  $('me-chip').innerHTML = `${avatarSvg(self.avatar)}<span>${escapeHtml(self.name)}</span>`;
  renderStatus(players);

  const lobby = state.phase === 'lobby';
  $('lobby').hidden = !lobby;
  if (lobby) {
    const humans = list.filter((p) => !p.bot);
    $('lobby-count').textContent = `${humans.length} / ${data.maxPlayers}명`;
    $('roster').innerHTML = humans
      .map((p) => `<li class="${p.id === me.playerId ? 'is-me' : ''}">${avatarSvg(p.avatar)}${escapeHtml(p.name)}</li>`)
      .join('');
  }

  const playing = state.phase === 'playing';
  $('court').hidden = !playing;
  court.update(data);
  renderScoreboard($('scoreboard'), data, me.playerId);

  const m = state.match;
  const inMatch = playing && m && [m.a, m.b].some((t) => state.teams[t].members.includes(me.playerId));
  $('controls').hidden = !inMatch;
  if (inMatch) {
    opponents().forEach((id, i) => {
      aimButtons[i].querySelector('b').textContent = players.get(id)?.name ?? '';
      aimButtons[i].setAttribute('aria-label', `${players.get(id)?.name ?? ''}에게 받아치기`);
    });
  }

  const champion = state.phase === 'champion';
  $('ceremony').hidden = !champion;
  if (champion) {
    renderPodium($('podium'), data, me.playerId);
    const first = state.podium?.first;
    $('ceremony-title').textContent = first !== null && first !== undefined ? `${teamNames(data, first, players)} 우승!` : '우승을 축하합니다!';
    fireworks.start();
  } else {
    fireworks.stop();
  }

  $('bracket-panel').hidden = lobby;
  if (!lobby) renderBracket($('bracket'), data, me.playerId);
}

function intervalFor() {
  if (!data) return 800;
  const { state } = data;
  if (state.phase === 'lobby') return 1500;
  if (state.phase === 'champion') return 2500;
  const m = state.match;
  const inMatch = m && [m.a, m.b].some((t) => state.teams[t].members.includes(me?.playerId));
  return inMatch ? 250 : 600;
}

function start() {
  poller?.stop();
  poller = poll(async () => {
    if (!me) return;
    apply(await api('state'));
  }, intervalFor);
}

if (me) start();
else showJoin();
