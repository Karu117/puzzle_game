import {
  api,
  poll,
  Court,
  Fireworks,
  avatarSvg,
  escapeHtml,
  playerMap,
  renderBracket,
  renderPodium,
  renderScoreboard,
  teamNames,
} from '/pickle/shared.js';

const PIN_KEY = 'pkb:host-pin';
const $ = (id) => document.getElementById(id);

let pin = sessionStorage.getItem(PIN_KEY) || '';
let data = null;
let poller = null;
const court = new Court($('court'));
const fireworks = new Fireworks($('fireworks'));

$('join-url').textContent = `${location.origin}/pickle`;

function showError(message = '') {
  $('host-error').textContent = message;
}

async function host(action, body = {}) {
  showError();
  try {
    const res = await api(action, { pin, ...body });
    apply(res);
    return res;
  } catch (err) {
    showError(err.message);
    if (err.status === 401) logout();
    return null;
  }
}

function logout() {
  sessionStorage.removeItem(PIN_KEY);
  pin = '';
  poller?.stop();
  $('dash').hidden = true;
  $('login').hidden = false;
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  pin = $('pin').value.trim();
  try {
    const res = await api('hostLogin', { pin });
    sessionStorage.setItem(PIN_KEY, pin);
    $('login-error').textContent = '';
    enter(res);
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

function enter(res) {
  $('login').hidden = true;
  $('dash').hidden = false;
  $('storage').textContent = res.storage === 'memory' ? '저장소: 메모리 (로컬 테스트용)' : '';
  apply(res);
  poller?.stop();
  poller = poll(async () => apply(await api('state')), () => (data?.state.phase === 'playing' ? 400 : 1200));
}

$('target').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) host('settings', { target: Number(v) });
});

$('start').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await host('start');
  render();
});

$('decide-0').addEventListener('click', () => decide(0));
$('decide-1').addEventListener('click', () => decide(1));

function decide(side) {
  const m = data?.state.match;
  if (!m) return;
  const name = teamNames(data, side === 0 ? m.a : m.b);
  if (confirm(`${name} 팀을 이 경기의 승자로 처리할까요?`)) host('decide', { side });
}

$('to-lobby').addEventListener('click', () => {
  if (confirm('현재 참가자는 그대로 두고 대기실로 돌아갈까요? 진행 중인 토너먼트는 종료됩니다.')) host('lobby');
});

$('reset').addEventListener('click', () => {
  if (confirm('모든 참가자를 내보내고 처음부터 시작할까요?')) host('reset');
});

$('roster').addEventListener('click', (e) => {
  const id = e.target.closest('button[data-kick]')?.dataset.kick;
  if (!id) return;
  const name = data.players.find((p) => p.id === id)?.name ?? '';
  const mid = data.state.phase !== 'lobby' ? ' (경기 중에는 로봇이 대신 뛰어요)' : '';
  if (confirm(`${name} 님을 내보낼까요?${mid}`)) host('kick', { playerId: id });
});

function apply(next) {
  if (!next?.state) return;
  if (data && next.state.version < data.state.version && next.state.gameId === data.state.gameId) return;
  data = next;
  render();
}

function teamPreview(n) {
  if (n < 2) return '2명 이상 모이면 시작할 수 있어요.';
  if (n < 4) return `${n}명이라 각자 로봇 파트너와 한 팀이 돼요.`;
  const teams = Math.ceil(n / 2);
  return `${teams}팀으로 토너먼트를 진행해요${n % 2 ? ' (1명은 로봇 파트너와 한 팀)' : ''}.`;
}

function render() {
  const { state, players: list } = data;
  const players = playerMap(data);
  const lobby = state.phase === 'lobby';
  const playing = state.phase === 'playing';
  const humans = list.filter((p) => !p.bot);

  $('lobby-panel').hidden = !lobby;
  $('count').textContent = String(humans.length);
  $('team-preview').textContent = teamPreview(humans.length);
  $('start').disabled = humans.length < 2;
  for (const b of $('target').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.target));

  $('court').hidden = !playing;
  court.update(data);
  renderScoreboard($('scoreboard'), data, null);

  const m = state.match;
  const canDecide = playing && m && !['end', 'done'].includes(m.stage);
  $('match-tools').hidden = !canDecide;
  if (canDecide) {
    $('decide-0').textContent = `${teamNames(data, m.a, players)} 승리 처리`;
    $('decide-1').textContent = `${teamNames(data, m.b, players)} 승리 처리`;
  }

  const champion = state.phase === 'champion';
  $('ceremony').hidden = !champion;
  if (champion) {
    renderPodium($('podium'), data, null);
    $('ceremony-title').textContent = `${teamNames(data, state.podium.first, players)} 우승!`;
    fireworks.start();
  } else fireworks.stop();

  renderBracket($('bracket'), data, null);

  $('players-count').textContent = `${humans.length} / ${data.maxPlayers}명`;
  $('roster').innerHTML = list
    .filter((p) => !p.bot || p.formerHuman)
    .map(
      (p) =>
        `<li>${avatarSvg(p.avatar)}${escapeHtml(p.name)}${p.formerHuman ? ' (로봇 대체)' : ''}${
          p.bot ? '' : `<button type="button" data-kick="${escapeHtml(p.id)}" aria-label="${escapeHtml(p.name)} 내보내기">×</button>`
        }</li>`,
    )
    .join('');
}

if (pin) {
  api('hostLogin', { pin })
    .then(enter)
    .catch(logout);
}
