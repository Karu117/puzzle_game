export const POLL_MS = 800;
const IDLE_POLL_MS = 1500;
const REQUEST_TIMEOUT_MS = 6000;

export async function api(action, body, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/game?action=${action}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
        if (res.status >= 500 && attempt < retries) throw Object.assign(err, { retryable: true });
        throw err;
      }
      return data;
    } catch (err) {
      const retryable = err.retryable || err.status === undefined;
      if (!retryable || attempt >= retries) {
        if (err.status === undefined) err.message = '서버 연결이 불안정해요. 다시 시도해 주세요.';
        throw err;
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

/** Polls state, never overlapping requests, and tracks the server clock offset. */
export function startPolling(onData, onError) {
  let stopped = false;
  let offset = 0;
  let failures = 0;
  let lastPhase = 'lobby';
  let timer = 0;
  const tick = async () => {
    if (stopped) return;
    const sentAt = Date.now();
    try {
      const data = await api('state');
      const rtt = Date.now() - sentAt;
      // Ignore offsets from very slow round trips; they skew the countdown.
      if (rtt < 1500 || failures > 0 || offset === 0) offset = data.serverTime + rtt / 2 - Date.now();
      failures = 0;
      lastPhase = data.state.phase;
      onData(data, () => Date.now() + offset);
    } catch (err) {
      failures++;
      onError?.(err, failures);
    }
    if (stopped) return;
    const base = lastPhase === 'question' || lastPhase === 'reveal' ? POLL_MS : IDLE_POLL_MS;
    const backoff = failures ? Math.min(5000, POLL_MS * 2 ** (failures - 1)) : 0;
    const jitter = Math.random() * 200;
    timer = setTimeout(tick, (document.hidden ? base * 3 : base) + backoff + jitter);
  };
  const wake = () => {
    if (document.hidden || stopped) return;
    clearTimeout(timer);
    tick();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  tick();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
    now: () => Date.now() + offset,
  };
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- Avatars ---------- */

const BODY_COLORS = ['#ffb84d', '#7ed6a5', '#7cb8ff', '#ff8fa8', '#b99cff', '#ffd95a', '#5fd3d0', '#ff9a6b', '#a3d65c', '#f59ad8'];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function avatarSvg({ c = 0, e = 0, a = 0, m = 0 } = {}) {
  const body = BODY_COLORS[c % BODY_COLORS.length];
  const dark = shade(body, -45);
  const ink = '#1d2340';

  const ears = [
    '',
    `<path d="M24 38 L28 12 L46 30 Z M76 38 L72 12 L54 30 Z" fill="${body}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>`,
    `<circle cx="27" cy="28" r="11" fill="${body}" stroke="${dark}" stroke-width="3"/><circle cx="73" cy="28" r="11" fill="${body}" stroke="${dark}" stroke-width="3"/><circle cx="27" cy="28" r="5" fill="${dark}" opacity=".35"/><circle cx="73" cy="28" r="5" fill="${dark}" opacity=".35"/>`,
    `<ellipse cx="37" cy="16" rx="7" ry="17" fill="${body}" stroke="${dark}" stroke-width="3"/><ellipse cx="63" cy="16" rx="7" ry="17" fill="${body}" stroke="${dark}" stroke-width="3"/>`,
    `<path d="M50 28 C50 18 50 14 50 10" stroke="#3c9a4f" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M50 14 C40 4 32 10 34 16 C40 18 46 16 50 14 Z" fill="#5cc46b"/><path d="M50 12 C58 2 68 6 66 12 C60 15 54 14 50 12 Z" fill="#5cc46b"/>`,
    `<path d="M38 28 L50 4 L62 28 Z" fill="#ffc23d" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="50" cy="5" r="4" fill="#ff4f5e"/><path d="M42 21 L58 21" stroke="#ff4f5e" stroke-width="3"/>`,
  ][a % 6];

  const eyes = [
    `<circle cx="39" cy="54" r="4.5" fill="${ink}"/><circle cx="61" cy="54" r="4.5" fill="${ink}"/>`,
    `<circle cx="39" cy="54" r="7" fill="${ink}"/><circle cx="61" cy="54" r="7" fill="${ink}"/><circle cx="41.5" cy="51.5" r="2.5" fill="#fff"/><circle cx="63.5" cy="51.5" r="2.5" fill="#fff"/>`,
    `<path d="M33 56 Q39 48 45 56 M55 56 Q61 48 67 56" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    `<circle cx="39" cy="54" r="5" fill="${ink}"/><path d="M55 54 L67 54" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<path d="M33 54 Q39 58 45 54 M55 54 Q61 58 67 54" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  ][e % 5];

  const mouth = [
    `<path d="M43 65 Q50 72 57 65" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    `<ellipse cx="50" cy="67" rx="4" ry="5" fill="${ink}"/>`,
    `<path d="M42 65 Q46 70 50 65 Q54 70 58 65" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    `<path d="M43 64 Q50 70 57 64" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M47 67 Q50 75 53 67" fill="#ff6b81"/>`,
  ][m % 4];

  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    ${a === 4 || a === 5 ? '' : ears}
    <ellipse cx="34" cy="90" rx="10" ry="6" fill="${dark}"/><ellipse cx="66" cy="90" rx="10" ry="6" fill="${dark}"/>
    <rect x="16" y="28" width="68" height="62" rx="31" fill="${body}" stroke="${dark}" stroke-width="3"/>
    ${a === 4 || a === 5 ? ears : ''}
    <ellipse cx="50" cy="74" rx="18" ry="10" fill="#fff" opacity=".35"/>
    <ellipse cx="29" cy="64" rx="6" ry="4" fill="#ff6b81" opacity=".45"/><ellipse cx="71" cy="64" rx="6" ry="4" fill="#ff6b81" opacity=".45"/>
    ${eyes}${mouth}
  </svg>`;
}

/* ---------- Arena ---------- */

function bestGrid(n, w, h) {
  let best = { cols: 1, rows: n, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(w / cols, h / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  return best;
}

export class Arena {
  constructor(root, { meId = null } = {}) {
    this.root = root;
    this.meId = meId;
    this.nodes = new Map();
    this.last = null;
    root.classList.add('arena');
    root.innerHTML = `
      <div class="zone zone-o" data-zone="O"><span class="zone-mark" aria-hidden="true">O</span><span class="zone-count"></span></div>
      <div class="zone zone-x" data-zone="X"><span class="zone-mark" aria-hidden="true">X</span><span class="zone-count"></span></div>
      <div class="zone zone-lobby" aria-hidden="true"></div>
      <div class="strip strip-wait"><span>고민 중</span></div>
      <div class="strip strip-out"><span>탈락</span></div>
      <div class="avatars" role="list" aria-label="참가자"></div>`;
    this.layer = root.querySelector('.avatars');
    this.resizeObserver = new ResizeObserver(() => this.last && this.render(this.last));
    this.resizeObserver.observe(root);
  }

  setMe(id) {
    this.meId = id;
  }

  render(data) {
    this.last = data;
    const { state, players, choices } = data;
    const lobby = state.phase === 'lobby';
    const reveal = state.phase === 'reveal' || state.phase === 'ceremony';
    const answer = state.question?.answer;
    const justOut = new Set(state.lastResult?.eliminated || []);

    this.root.dataset.phase = state.phase;
    this.root.dataset.answer = reveal && answer ? answer : '';

    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const regions = lobby
      ? { L: [0, 0, 1, 0.86] }
      : { O: [0, 0, 0.5, 0.72], X: [0.5, 0, 1, 0.72], W: [0, 0.72, 1, 0.86], OUT: [0, 0.86, 1, 1] };
    const groups = Object.fromEntries(Object.keys(regions).map((k) => [k, []]));

    for (const p of players) {
      if (lobby) groups.L.push(p);
      else if (!p.alive && !(state.phase === 'reveal' && justOut.has(p.id))) groups.OUT.push(p);
      else if (choices[p.id] === 'O' || choices[p.id] === 'X') groups[choices[p.id]].push(p);
      else groups.W.push(p);
    }

    const phaseKey = `${state.gameId}:${state.round}:${state.phase}`;
    const enteredReveal = state.phase === 'reveal' && this.phaseKey && this.phaseKey !== phaseKey;
    this.phaseKey = phaseKey;

    this.root.querySelector('.zone-o .zone-count').textContent = lobby ? '' : `${groups.O.length}명`;
    this.root.querySelector('.zone-x .zone-count').textContent = lobby ? '' : `${groups.X.length}명`;

    const seen = new Set();
    for (const [key, list] of Object.entries(groups)) {
      const [x0, y0, x1, y1] = regions[key];
      const pad = key === 'OUT' || key === 'W' ? 2 : 10;
      const rw = (x1 - x0) * W - pad * 2;
      const rh = (y1 - y0) * H - pad * 2;
      const grid = bestGrid(Math.max(list.length, 1), rw, rh);
      const maxSize = key === 'OUT' ? 26 : key === 'W' ? 34 : 64;
      const size = Math.max(14, Math.min(maxSize, grid.cell * 0.86));
      const usedCols = Math.min(grid.cols, list.length);
      const offsetX = (rw - usedCols * grid.cell) / 2;
      const offsetY = (rh - grid.rows * grid.cell) / 2;

      list.forEach((p, i) => {
        seen.add(p.id);
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        const cx = x0 * W + pad + offsetX + (col + 0.5) * grid.cell;
        const cy = y0 * H + pad + Math.max(0, offsetY) + (row + 0.5) * grid.cell;
        const node = this.node(p);
        const x = cx - size / 2;
        const y = cy - size / 2;
        const prev = node._pos;
        node.style.setProperty('--s', `${size}px`);
        const moved = prev && (Math.abs(x - prev.x) > 0.5 || Math.abs(y - prev.y) > 0.5);
        node._pos = { x, y };
        if (moved) travel(node, x, y, Math.hypot(x - prev.x, y - prev.y) > 24, i);
        else if (!prev) node.style.transform = `translate(${x}px, ${y}px)`;
        else if (enteredReveal && p.alive && answer && choices[p.id] === answer) cheer(node, i);
        node.classList.toggle('is-out', !p.alive && !lobby);
        node.classList.toggle('is-falling', state.phase === 'reveal' && justOut.has(p.id));
        node.classList.toggle('is-tiny', key === 'OUT' || key === 'W');
        node.classList.toggle('is-me', p.id === this.meId);
      });
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }

  node(p) {
    let node = this.nodes.get(p.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'avatar is-new';
      node.setAttribute('role', 'listitem');
      node.innerHTML = `<span class="avatar-dust" aria-hidden="true"><i></i><i></i><i></i></span><span class="avatar-body">${avatarSvg(p.avatar)}<span class="avatar-name">${escapeHtml(p.name)}</span></span>`;
      node.setAttribute('aria-label', p.name);
      this.layer.appendChild(node);
      this.nodes.set(p.id, node);
      requestAnimationFrame(() => node.classList.remove('is-new'));
    }
    return node;
  }
}

/* ---------- Avatar motion ---------- */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Current on-screen translate of a node, including any in-flight animation. */
function currentXY(node) {
  const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
  return { x: m.m41, y: m.m42 };
}

/**
 * Glide the avatar to (x, y) while it bounces along the way like a jelly:
 * the wrapper slides smoothly, the body does several small squash-and-stretch hops,
 * and the ground shadow shrinks on every bounce.
 */
function travel(node, x, y, bouncy, i) {
  const to = `translate(${x}px, ${y}px)`;
  if (reducedMotion()) {
    node.style.transform = to;
    return;
  }
  const from = currentXY(node);
  node.getAnimations().forEach((a) => a.cancel());
  node.style.transform = to;

  const dx = x - from.x;
  const dy = y - from.y;
  const dist = Math.hypot(dx, dy);

  if (!bouncy) {
    node.animate([{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: to }], {
      duration: 420,
      easing: 'cubic-bezier(.34,1.4,.64,1)',
    });
    return;
  }

  const hops = Math.max(3, Math.min(6, Math.round(dist / 55)));
  const hopMs = 300;
  const duration = hops * hopMs + 260;
  const delay = (i % 6) * 45 + Math.random() * 60;
  const lean = Math.sign(dx || 1) * 10;
  const lift = Math.max(14, Math.min(34, dist / hops));

  // Wrapper: one smooth glide that eases in, cruises, then settles past the target and back.
  node.classList.add('is-hopping');
  node.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px)`, offset: 0 },
      { transform: `translate(${from.x - dx * 0.04}px, ${from.y - dy * 0.04}px)`, offset: 0.08 },
      { transform: `translate(${x + dx * 0.035}px, ${y + dy * 0.035}px)`, offset: 0.86 },
      { transform: to, offset: 1 },
    ],
    { duration, delay, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'backwards' },
  ).finished.then(
    () => node.classList.remove('is-hopping'),
    () => {},
  );

  // Body: anticipation squash, a chain of bounces leaning toward the target, then a jiggly landing.
  const body = node.querySelector('.avatar-body');
  body.getAnimations().forEach((a) => a.cancel());
  const frames = [{ transform: 'translateY(0) rotate(0) scale(1,1)', offset: 0 }];
  const travelStart = 0.08;
  const travelEnd = 0.86;
  const span = (travelEnd - travelStart) / hops;
  frames.push({ transform: `translateY(0) rotate(${-lean * 0.5}deg) scale(1.22,0.76)`, offset: travelStart });
  for (let k = 0; k < hops; k++) {
    const o = travelStart + k * span;
    const h = lift * (k === 0 ? 1.15 : 1 - k * 0.06);
    frames.push({
      transform: `translateY(-${h}px) rotate(${lean}deg) scale(0.9,1.12)`,
      offset: o + span * 0.5,
      easing: 'cubic-bezier(.33,0,.67,0)',
    });
    frames.push({
      transform: `translateY(0) rotate(${lean * 0.4}deg) scale(1.16,0.84)`,
      offset: o + span,
      easing: 'cubic-bezier(.33,1,.67,1)',
    });
  }
  frames.push({ transform: `translateY(-10%) rotate(${-lean * 0.3}deg) scale(0.94,1.08)`, offset: 0.93 });
  frames.push({ transform: 'translateY(0) rotate(0) scale(1.04,0.97)', offset: 0.97 });
  frames.push({ transform: 'translateY(0) rotate(0) scale(1,1)', offset: 1 });
  body.animate(frames, { duration, delay, fill: 'backwards' });

  // Shadow: shrink at each peak, grow at each landing.
  const shadow = [{ transform: 'scale(1)', opacity: 1, offset: 0 }];
  for (let k = 0; k < hops; k++) {
    const o = travelStart + k * span;
    shadow.push({ transform: 'scale(0.5)', opacity: 0.45, offset: o + span * 0.5 });
    shadow.push({ transform: 'scale(1.1)', opacity: 1, offset: o + span });
  }
  shadow.push({ transform: 'scale(1)', opacity: 1, offset: 1 });
  try {
    node.animate(shadow, { duration, delay, pseudoElement: '::after' });
  } catch {}

  // Dust puffs on the final landing.
  const dust = node.querySelector('.avatar-dust');
  dust.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  [...dust.children].forEach((puff, k) => {
    const side = k - 1;
    puff.animate(
      [
        { opacity: 0, transform: 'translate(-50%, 0) scale(0.3)' },
        { opacity: 0.9, transform: `translate(calc(-50% + ${side * 70}%), -20%) scale(1)`, offset: 0.35 },
        { opacity: 0, transform: `translate(calc(-50% + ${side * 130}%), -60%) scale(1.4)` },
      ],
      { duration: 460, delay: delay + duration * 0.84, easing: 'ease-out', fill: 'backwards' },
    );
  });
}

/** Little double-jump celebration for players who picked the right answer. */
function cheer(node, i) {
  if (reducedMotion()) return;
  const body = node.querySelector('.avatar-body');
  body.animate(
    [
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(2%) scale(1.15, 0.85)', offset: 0.1 },
      { transform: 'translateY(-38%) scale(0.92, 1.1) rotate(-8deg)', offset: 0.3 },
      { transform: 'translateY(0) scale(1.12, 0.88)', offset: 0.5 },
      { transform: 'translateY(-26%) scale(0.95, 1.06) rotate(8deg)', offset: 0.7 },
      { transform: 'translateY(0) scale(1.08, 0.92)', offset: 0.88 },
      { transform: 'translateY(0) scale(1, 1)' },
    ],
    { duration: 900, delay: 250 + (i % 8) * 60, easing: 'ease-in-out' },
  );
}

/* ---------- Timer ---------- */

export function renderTimer(el, state, now) {
  if (state.phase !== 'question') {
    el.hidden = true;
    return 0;
  }
  const left = Math.max(0, state.endsAt - now());
  const secs = Math.ceil(left / 1000);
  el.hidden = false;
  el.style.setProperty('--p', String(left / (state.seconds * 1000)));
  el.querySelector('.timer-num').textContent = String(secs);
  el.classList.toggle('is-urgent', secs <= 3);
  return left;
}

/* ---------- Ceremony ---------- */

export function renderCeremony(root, data, meId) {
  const { state, players, standings } = data;
  const key = `${state.gameId}:${state.updatedAt}`;
  if (root.dataset.key === key) return;
  root.dataset.key = key;

  const byId = new Map(players.map((p) => [p.id, p]));
  const prizes = state.prizes || [];
  const rankGroups = new Map();
  for (const s of standings || []) {
    if (s.rank > prizes.length || !byId.has(s.id)) continue;
    if (!rankGroups.has(s.rank)) rankGroups.set(s.rank, []);
    rankGroups.get(s.rank).push(byId.get(s.id));
  }

  const people = (list, cls = '') =>
    list
      .map(
        (p) => `<div class="podium-person ${cls} ${p.id === meId ? 'is-me' : ''}">
          <div class="podium-avatar">${avatarSvg(p.avatar)}</div>
          <span class="podium-name">${escapeHtml(p.name)}${p.id === meId ? ' (나)' : ''}</span>
        </div>`,
      )
      .join('');

  const podiumRanks = [2, 1, 3].filter((r) => rankGroups.has(r));
  const podium = podiumRanks
    .map(
      (r) => `<div class="podium-col rank-${r}">
        ${r === 1 ? '<div class="crown" aria-hidden="true"></div>' : ''}
        <div class="podium-people">${people(rankGroups.get(r))}</div>
        <div class="podium-block"><strong>${r}등</strong><span>${escapeHtml(prizes[r - 1] || '')}</span></div>
      </div>`,
    )
    .join('');

  const rest = [...rankGroups.keys()]
    .filter((r) => r > 3)
    .sort((a, b) => a - b)
    .map(
      (r) => `<li><span class="rest-rank">${r}등</span><div class="rest-people">${people(rankGroups.get(r), 'is-small')}</div><span class="rest-prize">${escapeHtml(prizes[r - 1] || '')}</span></li>`,
    )
    .join('');

  const winners = rankGroups.get(1) || [];
  const headline =
    winners.length === 1 ? `${escapeHtml(winners[0].name)} 님 우승!` : winners.length > 1 ? '공동 우승!' : '시상식';

  const myRank = standings?.find((s) => s.id === meId)?.rank;
  const myLine = meId && myRank
    ? `<p class="ceremony-me">${myRank <= prizes.length ? `축하해요! ${myRank}등으로 <strong>${escapeHtml(prizes[myRank - 1])}</strong>을(를) 받아요.` : `최종 ${myRank}등! 다음 판에 다시 도전해요.`}</p>`
    : '';

  root.innerHTML = `
    <div class="ceremony-rays" aria-hidden="true"></div>
    <canvas class="fireworks" aria-hidden="true"></canvas>
    <div class="ceremony-flash" aria-hidden="true"></div>
    <div class="ceremony-inner">
      <p class="ceremony-kicker">시상식</p>
      <h2 class="ceremony-title">${headline}</h2>
      ${myLine}
      <div class="podium">${podium}</div>
      ${rest ? `<ol class="rest-list" aria-label="그 외 수상자">${rest}</ol>` : ''}
    </div>`;
  launchCelebration(root.querySelector('.fireworks'), root);
}

const FIREWORK_COLORS = ['#2f6bff', '#ff4f5e', '#ffc23d', '#ffffff', '#5ce0b8', '#ff8ad8'];

/** Canvas show: rockets that burst into glittering sparks, ring bursts, and a confetti shower. */
function launchCelebration(canvas, root) {
  if (reducedMotion()) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const resize = () => {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rockets = [];
  const sparks = [];
  const confetti = [];

  const launch = (x = W * (0.15 + Math.random() * 0.7), big = false) => {
    rockets.push({
      x,
      y: H + 10,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(H * 0.016 + Math.random() * 3.2),
      color: pick(FIREWORK_COLORS),
      big,
      trail: [],
    });
  };

  const burst = (r) => {
    const count = r.big ? 140 : 70 + Math.floor(Math.random() * 40);
    const ring = Math.random() < 0.35;
    const second = pick(FIREWORK_COLORS);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.1;
      const speed = ring ? 4.2 : 1 + Math.random() * (r.big ? 6.5 : 4.8);
      sparks.push({
        x: r.x,
        y: r.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        decay: 0.009 + Math.random() * 0.012,
        color: k % 3 === 0 ? second : r.color,
        size: r.big ? 2.6 : 2,
        glitter: Math.random() < 0.3,
      });
    }
    if (r.big) flash(root);
  };

  const rain = (n) => {
    for (let k = 0; k < n; k++) {
      confetti.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.6,
        w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 8,
        vy: 1.4 + Math.random() * 2.2,
        vx: (Math.random() - 0.5) * 1.4,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.25,
        sway: Math.random() * Math.PI * 2,
        color: pick(FIREWORK_COLORS),
      });
    }
  };

  // Choreography: warm-up volley, a big triple burst as 1st place rises, then a sustained show.
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(() => canvas.isConnected && fn(), ms));
  at(100, () => launch(W * 0.2));
  at(350, () => launch(W * 0.8));
  at(650, () => launch(W * 0.5));
  at(1000, () => {
    launch(W * 0.5, true);
    launch(W * 0.25, true);
    launch(W * 0.75, true);
    rain(160);
  });
  for (let t = 1800; t < 9000; t += 380 + Math.random() * 380) at(t, () => launch());
  at(4500, () => rain(80));
  at(9000, () => {
    launch(W * 0.3, true);
    launch(W * 0.7, true);
  });

  const start = performance.now();
  let last = start;
  const frame = (now) => {
    if (!canvas.isConnected) {
      timers.forEach(clearTimeout);
      removeEventListener('resize', resize);
      return;
    }
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (let k = rockets.length - 1; k >= 0; k--) {
      const r = rockets[k];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.vy += 0.06 * dt;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,220,150,0.6)';
      ctx.fillRect(r.x - 1, r.y + 3, 2, 6 + Math.random() * 6);
      if (r.vy >= -1.2 || r.y < H * 0.12) {
        burst(r);
        rockets.splice(k, 1);
      }
    }

    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k];
      s.vx *= 0.975;
      s.vy = s.vy * 0.975 + 0.05 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= s.decay * dt;
      if (s.life <= 0) {
        sparks.splice(k, 1);
        continue;
      }
      const twinkle = s.glitter ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
      ctx.globalAlpha = Math.max(0, s.life) * twinkle;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (0.6 + s.life * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (let k = confetti.length - 1; k >= 0; k--) {
      const c = confetti[k];
      c.sway += 0.05 * dt;
      c.x += (c.vx + Math.sin(c.sway) * 0.8) * dt;
      c.y += c.vy * dt;
      c.r += c.vr * dt;
      if (c.y > H + 20) {
        confetti.splice(k, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.r);
      ctx.scale(1, Math.cos(c.sway * 2));
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }

    const running = now - start < 11000 || rockets.length || sparks.length || confetti.length;
    if (running) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}

function flash(root) {
  const el = root.querySelector('.ceremony-flash');
  el?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
}
