export const POLL_MS = 800;

export async function api(action, body) {
  const res = await fetch(`/api/game?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
  return data;
}

/** Polls state, never overlapping requests, and tracks the server clock offset. */
export function startPolling(onData, onError) {
  let stopped = false;
  let offset = 0;
  const tick = async () => {
    if (stopped) return;
    const sentAt = Date.now();
    try {
      const data = await api('state');
      const rtt = Date.now() - sentAt;
      offset = data.serverTime + rtt / 2 - Date.now();
      onData(data, () => Date.now() + offset);
    } catch (err) {
      onError?.(err);
    }
    if (!stopped) setTimeout(tick, document.hidden ? POLL_MS * 3 : POLL_MS);
  };
  tick();
  return { stop: () => (stopped = true), now: () => Date.now() + offset };
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
        node.style.transform = `translate(${x}px, ${y}px)`;
        node._pos = { x, y };
        if (prev && Math.hypot(x - prev.x, y - prev.y) > 6) hop(node, x - prev.x, y - prev.y);
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

const HOP_MS = 720;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A bouncy, cartoon-style jump: crouch, stretch into the air leaning toward the target, squash on landing. */
function hop(node, dx, dy) {
  if (reducedMotion()) return;
  const body = node.querySelector('.avatar-body');
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(90, 26 + dist * 0.35);
  const lean = Math.sign(dx || 1) * Math.min(18, 6 + Math.abs(dx) * 0.06);
  const delay = Math.random() * 120;
  node.style.transitionDelay = `${delay}ms`;
  node.classList.add('is-hopping');

  body.getAnimations().forEach((a) => a.cancel());
  body.animate(
    [
      { transform: 'translateY(0) rotate(0) scale(1, 1)', offset: 0 },
      { transform: `translateY(4%) rotate(${-lean * 0.4}deg) scale(1.18, 0.78)`, offset: 0.12, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: `translateY(-${lift}px) rotate(${lean}deg) scale(0.88, 1.16)`, offset: 0.5, easing: 'cubic-bezier(.5,0,.9,.5)' },
      { transform: `translateY(0) rotate(${lean * 0.3}deg) scale(1.22, 0.74)`, offset: 0.82, easing: 'cubic-bezier(.2,.8,.3,1.4)' },
      { transform: `translateY(-6%) rotate(${-lean * 0.2}deg) scale(0.95, 1.06)`, offset: 0.92 },
      { transform: 'translateY(0) rotate(0) scale(1, 1)', offset: 1 },
    ],
    { duration: HOP_MS, delay, fill: 'none' },
  ).finished.then(
    () => node.classList.remove('is-hopping'),
    () => {},
  );

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
      { duration: 420, delay: delay + HOP_MS * 0.8, easing: 'ease-out', fill: 'backwards' },
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
    <canvas class="confetti" aria-hidden="true"></canvas>
    <div class="ceremony-inner">
      <p class="ceremony-kicker">시상식</p>
      <h2 class="ceremony-title">${headline}</h2>
      ${myLine}
      <div class="podium">${podium}</div>
      ${rest ? `<ol class="rest-list" aria-label="그 외 수상자">${rest}</ol>` : ''}
    </div>`;
  launchConfetti(root.querySelector('.confetti'));
}

function launchConfetti(canvas) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const colors = ['#2f6bff', '#ff4f5e', '#ffc23d', '#ffffff'];
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  };
  resize();
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height,
    w: (6 + Math.random() * 6) * devicePixelRatio,
    h: (10 + Math.random() * 8) * devicePixelRatio,
    vy: (2 + Math.random() * 3) * devicePixelRatio,
    vx: (Math.random() - 0.5) * 2 * devicePixelRatio,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (t) => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fading = t - start > 6000;
    let visible = 0;
    for (const b of bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      if (b.y > canvas.height && !fading) b.y = -20;
      if (b.y <= canvas.height) visible++;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (visible) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
