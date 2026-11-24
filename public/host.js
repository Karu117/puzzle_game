import { api, startPolling, Arena, avatarSvg, renderTimer, renderCeremony, escapeHtml } from '/common.js';

const $ = (id) => document.getElementById(id);
const PIN_KEY = 'oxq:pin';

let pin = sessionStorage.getItem(PIN_KEY) || '';
let latest = null;
let bank = [];
let prizesDraft = null;
let clock = () => Date.now();
let autoRevealRound = 0;
let ceremonyDismissed = false;
let poller = null;

const arena = new Arena($('arena'));

async function hostCall(action, body = {}) {
  const res = await api(action, { ...body, pin });
  if (res.bank) {
    bank = res.bank;
    renderBank();
  }
  if (res.state) render(res);
  return res;
}

async function run(btn, action, body) {
  if (btn) btn.disabled = true;
  $('ctrl-msg').textContent = '';
  try {
    await hostCall(action, body);
  } catch (err) {
    $('ctrl-msg').textContent = err.message;
    if (err.status === 401) logout();
  } finally {
    if (btn) btn.disabled = false;
    if (latest) render(latest);
  }
}

/* ---------- Login ---------- */

async function login(candidate) {
  pin = candidate;
  try {
    const res = await api('hostLogin', { pin });
    sessionStorage.setItem(PIN_KEY, pin);
    bank = res.bank;
    $('storage').textContent = res.storage === 'redis' ? '저장소: Redis' : '저장소: 메모리 (로컬 전용)';
    $('storage').dataset.tone = res.storage === 'redis' ? 'good' : 'warn';
    $('login').hidden = true;
    $('dash').hidden = false;
    $('seconds').value = String(res.state.seconds);
    renderBank();
    render(res);
    poller ||= startPolling((data, now) => {
      clock = now;
      render(data);
    });
  } catch (err) {
    $('login-msg').textContent = err.message;
    sessionStorage.removeItem(PIN_KEY);
  }
}

function logout() {
  sessionStorage.removeItem(PIN_KEY);
  location.reload();
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('login-msg').textContent = '';
  login($('pin').value.trim());
});

if (pin) login(pin);

/* ---------- Controls ---------- */

$('ask-next').addEventListener('click', (e) => run(e.currentTarget, 'ask', { seconds: Number($('seconds').value) }));
$('reveal').addEventListener('click', (e) => run(e.currentTarget, 'reveal'));
$('to-ceremony').addEventListener('click', (e) => {
  ceremonyDismissed = false;
  run(e.currentTarget, 'ceremony');
});
$('rematch').addEventListener('click', (e) => {
  if (confirm('참가자는 그대로 두고 모두 부활시켜 새 게임을 시작할까요?')) run(e.currentTarget, 'rematch');
});
$('reset').addEventListener('click', (e) => {
  if (confirm('모든 참가자를 내보내고 게임을 초기화할까요?')) run(e.currentTarget, 'reset');
});
$('seconds').addEventListener('change', () => run(null, 'settings', { seconds: Number($('seconds').value) }));

$('custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('custom-text').value.trim();
  if (!text) {
    $('ctrl-msg').textContent = '문제를 입력해 주세요.';
    return;
  }
  const answer = new FormData(e.target).get('custom-answer');
  run(e.submitter, 'ask', { text, answer, seconds: Number($('seconds').value) }).then(() => {
    if (latest?.state.question?.text === text) $('custom-text').value = '';
  });
});

$('close-ceremony').addEventListener('click', () => {
  ceremonyDismissed = true;
  if (latest) render(latest);
});

/* ---------- Prizes ---------- */

function renderPrizes() {
  const list = prizesDraft || latest?.state.prizes || [];
  $('prize-count').textContent = String(list.length);
  $('prize-minus').disabled = list.length <= 1;
  $('prize-plus').disabled = list.length >= 10;
  const ol = $('prize-list');
  if (ol.children.length !== list.length || !prizesDraft) {
    ol.innerHTML = list
      .map(
        (name, i) => `<li><label for="prize-${i}">${i + 1}등</label><input id="prize-${i}" data-i="${i}" maxlength="30" value="${escapeHtml(name)}" placeholder="${i + 1}등 경품" /></li>`,
      )
      .join('');
  }
}

$('prize-list').addEventListener('input', (e) => {
  prizesDraft ||= [...latest.state.prizes];
  prizesDraft[Number(e.target.dataset.i)] = e.target.value;
});
$('prize-minus').addEventListener('click', () => {
  prizesDraft = [...(prizesDraft || latest.state.prizes)].slice(0, -1);
  renderPrizes();
});
$('prize-plus').addEventListener('click', () => {
  const list = [...(prizesDraft || latest.state.prizes)];
  list.push(`${list.length + 1}등 경품`);
  prizesDraft = list;
  renderPrizes();
});
$('prize-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prizes = prizesDraft || latest.state.prizes;
  prizesDraft = null;
  await run(e.submitter, 'settings', { prizes });
  $('ctrl-msg').textContent = `경품 ${prizes.length}개 등수를 저장했어요.`;
});

/* ---------- Question bank ---------- */

function renderBank() {
  const ta = $('bank');
  if (document.activeElement !== ta) ta.value = bank.map((q) => `${q.answer} ${q.text}`).join('\n');
}

$('bank-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const parsed = $('bank')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([OoXx])[\s.:|)-]+(.+)$/);
      return m ? { answer: m[1].toUpperCase(), text: m[2].trim() } : null;
    });
  const bad = parsed.findIndex((q) => !q);
  if (bad !== -1) {
    $('ctrl-msg').textContent = '';
    $('bank-progress').textContent = `${bad + 1}번째 줄 형식을 확인해 주세요. (예: O 문제 내용)`;
    return;
  }
  $('bank').blur();
  await run(e.submitter, 'settings', { bank: parsed });
  $('bank-progress').textContent = `${parsed.length}문제를 저장했어요.`;
});

/* ---------- Render ---------- */

function render(data) {
  latest = data;
  const { state, players, choices } = data;
  const alive = players.filter((p) => p.alive);
  const phase = state.phase;

  $('hud-round').textContent = state.round ? String(state.round) : '-';
  $('hud-alive').textContent = `${alive.length}명`;

  const card = $('question');
  card.dataset.answer = phase === 'reveal' ? state.question?.answer || '' : '';
  if (phase === 'lobby') {
    $('q-kicker').textContent = `대기실 · ${players.length}/${data.maxPlayers}명`;
    $('q-text').textContent = players.length
      ? `${players.length}명 입장! 인원이 다 차지 않아도 지금 바로 시작할 수 있어요.`
      : '참가자 입장을 기다리는 중입니다.';
  } else if (state.question) {
    $('q-kicker').textContent = phase === 'reveal' || phase === 'ceremony' ? `정답은 ${state.question.answer}!` : `문제 ${state.round}`;
    $('q-text').textContent = state.question.text;
  }

  arena.render(data);

  const r = state.lastResult;
  let result = '';
  if (phase === 'question') {
    const chosen = alive.filter((p) => choices[p.id]).length;
    result = `${alive.length}명 중 ${chosen}명 선택 완료`;
  } else if (phase === 'reveal' && r) {
    result = r.allWrongSaved
      ? `전원 오답! 모두 생존 (O ${r.counts.O} · X ${r.counts.X} · 미선택 ${r.counts.none})`
      : `${r.eliminated.length}명 탈락, ${r.survivors}명 생존 (O ${r.counts.O} · X ${r.counts.X} · 미선택 ${r.counts.none})`;
    if (r.survivors === 1) result += ' · 최후의 1인 결정!';
  }
  $('result').textContent = result;

  const next = bank[state.bankIndex];
  $('next-preview').innerHTML = next
    ? `<span class="next-label">다음 문제 ${state.bankIndex + 1}/${bank.length}</span><span class="next-text"><b class="ans ans-${next.answer}">${next.answer}</b>${escapeHtml(next.text)}</span>`
    : `<span class="next-label">문제 은행 소진</span><span class="next-text">직접 문제를 내거나 문제 은행에 추가하세요.</span>`;

  const canAsk = (phase === 'lobby' || phase === 'reveal') && alive.length >= 1;
  $('ask-next').disabled = !canAsk || !next;
  $('ask-next').textContent = phase === 'lobby' ? `게임 시작 (${players.length}명)` : '다음 문제 출제';
  $('custom-form').querySelector('button').disabled = !canAsk;
  $('reveal').disabled = phase !== 'question';
  $('to-ceremony').disabled = phase === 'question' || phase === 'ceremony' || players.length === 0;
  $('to-ceremony').classList.toggle('is-pulse', phase === 'reveal' && r?.survivors === 1);

  if (!prizesDraft) renderPrizes();

  $('player-count').textContent = `${players.length}/${data.maxPlayers}`;
  $('player-list').innerHTML = players
    .map(
      (p) => `<li class="${p.alive ? '' : 'is-out'}">
        <span class="mini-avatar">${avatarSvg(p.avatar)}</span>
        <span class="pl-name">${escapeHtml(p.name)}</span>
        <span class="pl-state">${p.alive ? (phase === 'question' ? choices[p.id] || '…' : '생존') : `R${p.outRound} 탈락`}</span>
        <button type="button" class="link-btn" data-kick="${p.id}" aria-label="${escapeHtml(p.name)} 내보내기">내보내기</button>
      </li>`,
    )
    .join('');

  const ceremony = $('ceremony');
  const showCeremony = phase === 'ceremony' && !ceremonyDismissed;
  ceremony.hidden = !showCeremony;
  $('close-ceremony').hidden = !showCeremony;
  if (showCeremony) renderCeremony(ceremony, data, null);
  if (phase !== 'ceremony') {
    ceremonyDismissed = false;
    delete ceremony.dataset.key;
  }
}

$('player-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-kick]')?.dataset.kick;
  const p = latest?.players.find((x) => x.id === id);
  if (p && confirm(`${p.name} 님을 내보낼까요?`)) run(null, 'kick', { playerId: id });
});

function frame() {
  if (latest) {
    const left = renderTimer($('timer'), latest.state, clock);
    const { phase, round } = latest.state;
    if (phase === 'question' && left <= 0 && autoRevealRound !== round) {
      autoRevealRound = round;
      setTimeout(() => latest?.state.phase === 'question' && run(null, 'reveal'), 700);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
