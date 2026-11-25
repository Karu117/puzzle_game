const API = '/api/pickle';
const REQUEST_TIMEOUT_MS = 5000;

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Server clock ----------
// Rally timing is judged on the server, so every client renders against an estimate of server time.
export const clock = {
  offset: 0,
  bestRtt: Infinity,
  sampledAt: 0,
  sample(serverTime, t0, t1) {
    const rtt = t1 - t0;
    const stale = t1 - this.sampledAt > 8000;
    if (rtt <= this.bestRtt * 1.3 || stale) {
      this.offset = serverTime - (performance.timeOrigin + t0 + rtt / 2);
      this.bestRtt = stale ? rtt : Math.min(this.bestRtt, rtt);
      this.sampledAt = t1;
    }
  },
  now() {
    return performance.timeOrigin + performance.now() + this.offset;
  },
};

export async function api(action, body) {
  const t0 = performance.now();
  const res = await fetch(`${API}?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const t1 = performance.now();
  const data = await res.json().catch(() => ({}));
  if (data?.serverTime) clock.sample(data.serverTime, t0, t1);
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했어요.'), { status: res.status, data });
  return data;
}

export function poll(fetcher, intervalFor) {
  let timer = null;
  let stopped = false;
  let inflight = false;
  let fails = 0;
  async function run() {
    if (stopped || inflight) return;
    clearTimeout(timer);
    inflight = true;
    try {
      await fetcher();
      fails = 0;
    } catch {
      fails += 1;
    }
    inflight = false;
    if (stopped) return;
    const base = document.hidden ? 3000 : intervalFor();
    timer = setTimeout(run, fails ? Math.min(4000, base * 2 ** fails) : base);
  }
  document.addEventListener('visibilitychange', () => !document.hidden && run());
  run();
  return {
    now: run,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// ---------- Avatars ----------
const BODY_COLORS = ['#7dd3a8', '#ffb36b', '#8ec5ff', '#ff9aa8', '#c6b4ff', '#ffd95e', '#6fd6d6', '#f4a3e0'];

export function avatarSvg({ c = 0, f = 0 } = {}) {
  const ink = '#14213d';
  const body = BODY_COLORS[c % BODY_COLORS.length];
  if (f === 4) {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><line x1="32" y1="4" x2="32" y2="13" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="5" r="4" fill="#d9f24a" stroke="${ink}" stroke-width="2.5"/><rect x="9" y="13" width="46" height="42" rx="13" fill="#cfd6e4" stroke="${ink}" stroke-width="3"/><rect x="16" y="23" width="32" height="16" rx="8" fill="${ink}"/><circle cx="25" cy="31" r="3.5" fill="#d9f24a"/><circle cx="39" cy="31" r="3.5" fill="#d9f24a"/><rect x="25" y="44" width="14" height="4" rx="2" fill="${ink}"/></svg>`;
  }
  const eyes = [
    `<circle cx="24" cy="30" r="3.6" fill="${ink}"/><circle cx="40" cy="30" r="3.6" fill="${ink}"/>`,
    `<path d="M20 31q4-5 8 0M36 31q4-5 8 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="24" cy="30" r="3.6" fill="${ink}"/><path d="M36 30h8" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M20 27l8 4-8 4M44 27l-8 4 8 4" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  ][f % 4];
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 26c0-12 10-20 22-20s22 8 22 20v8c0 13-10 22-22 22S10 47 10 34z" fill="${body}" stroke="${ink}" stroke-width="3"/><path d="M14 18c6-7 30-9 36 0" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity=".9"/>${eyes}<circle cx="18" cy="38" r="3.5" fill="#ff7d6b" opacity=".45"/><circle cx="46" cy="38" r="3.5" fill="#ff7d6b" opacity=".45"/><path d="M27 41q5 4 10 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/></svg>`;
}

// ---------- Labels ----------
export function playerMap(data) {
  return new Map(data.players.map((p) => [p.id, p]));
}

export function teamNames(data, teamIdx, players = playerMap(data)) {
  const team = data.state.teams[teamIdx];
  if (!team) return '';
  return team.members.map((id) => players.get(id)?.name ?? '?').join(' · ');
}

export function roundName(state, r) {
  const n = state.rounds[r]?.length ?? 0;
  if (n === 1) return '결승';
  if (n === 2) return '준결승';
  return `${n * 2}강`;
}

export function matchLabel(state, matchId) {
  const m = state.rounds.flat().find((x) => x.id === matchId);
  if (!m) return '';
  const playable = state.rounds[m.round].filter((x) => !x.bye);
  return `${roundName(state, m.round)} ${playable.indexOf(m) + 1}경기`;
}

export function teamOf(state, playerId) {
  return state.teams.find((t) => t.members.includes(playerId)) ?? null;
}

// Where a team stands in the tournament from one player's point of view.
export function teamStatus(state, teamIdx) {
  if (teamIdx === null || teamIdx === undefined) return 'none';
  if (state.phase === 'champion') return state.podium?.first === teamIdx ? 'champion' : 'out';
  const m = state.match;
  if (m && (m.a === teamIdx || m.b === teamIdx) && m.stage !== 'end') return 'playing';
  if (m && m.stage === 'end' && (m.a === teamIdx || m.b === teamIdx)) {
    return (m.winnerSide === 0 ? m.a : m.b) === teamIdx ? 'won' : 'lost';
  }
  const lost = state.rounds.flat().some((x) => x.winner !== null && !x.bye && (x.a === teamIdx || x.b === teamIdx) && x.winner !== teamIdx);
  return lost ? 'out' : 'waiting';
}

// ---------- Court ----------
const SLOT_POS = {
  bottom: [
    { x: 29, y: 81 },
    { x: 71, y: 81 },
  ],
  top: [
    { x: 71, y: 19 },
    { x: 29, y: 19 },
  ],
};

const GRADE_TEXT = { perfect: 'PERFECT!', good: 'GOOD', ok: 'OK' };

export class Court {
  constructor(root, { meId = null } = {}) {
    this.root = root;
    this.meId = meId;
    this.data = null;
    this.key = '';
    this.lastHitAt = 0;
    this.lastPointAt = 0;
    root.classList.add('pk-court-wrap');
    root.innerHTML = `
      <div class="pk-court" role="img" aria-label="피클볼 코트">
        <div class="pk-zone pk-zone-top"></div>
        <div class="pk-kitchen pk-kitchen-top"></div>
        <div class="pk-kitchen pk-kitchen-bottom"></div>
        <div class="pk-zone pk-zone-bottom"></div>
        <div class="pk-centerline pk-centerline-top"></div>
        <div class="pk-centerline pk-centerline-bottom"></div>
        <div class="pk-net" aria-hidden="true"></div>
        <div class="pk-layer"></div>
        <div class="pk-ball-shadow" hidden></div>
        <div class="pk-ball" hidden></div>
        <div class="pk-overlay" hidden></div>
      </div>
      <p class="sr-only" aria-live="polite"></p>`;
    this.court = root.querySelector('.pk-court');
    this.layer = root.querySelector('.pk-layer');
    this.ball = root.querySelector('.pk-ball');
    this.shadow = root.querySelector('.pk-ball-shadow');
    this.overlay = root.querySelector('.pk-overlay');
    this.live = root.querySelector('[aria-live]');
    this.size = { w: 1, h: 1 };
    new ResizeObserver(([e]) => {
      this.size = { w: e.contentRect.width, h: e.contentRect.height };
    }).observe(this.court);
    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get match() {
    const m = this.data?.state.match;
    return m && this.data.state.phase === 'playing' ? m : null;
  }

  sideOfPlayer(id) {
    const m = this.match;
    if (!m) return null;
    const teams = this.data.state.teams;
    if (teams[m.a]?.members.includes(id)) return 0;
    if (teams[m.b]?.members.includes(id)) return 1;
    return null;
  }

  // The viewer's own team is always drawn on the near (bottom) side.
  get flipped() {
    return this.sideOfPlayer(this.meId) === 1;
  }

  posOf(id) {
    const m = this.match;
    const side = this.sideOfPlayer(id);
    if (side === null) return { x: 50, y: 50 };
    const members = this.data.state.teams[side === 0 ? m.a : m.b].members;
    const slot = Math.max(0, members.indexOf(id));
    const screen = (side === 1) !== this.flipped ? 'top' : 'bottom';
    return SLOT_POS[screen][slot];
  }

  update(data) {
    this.data = data;
    const m = this.match;
    const key = m ? `${m.id}:${this.flipped}` : '';
    if (key !== this.key) {
      this.key = key;
      this.renderPlayers();
    }
    if (!m) {
      this.overlay.hidden = true;
      return;
    }
    if (m.lastHit && m.lastHit.at !== this.lastHitAt) {
      this.lastHitAt = m.lastHit.at;
      this.flash(m.lastHit.by, 'swing');
      this.pop(m.lastHit.by, GRADE_TEXT[m.lastHit.grade] || '', m.lastHit.grade);
    }
    if (m.lastPoint && m.lastPoint.at !== this.lastPointAt) {
      this.lastPointAt = m.lastPoint.at;
      this.flash(m.lastPoint.missedBy, 'dizzy');
      const players = playerMap(data);
      this.live.textContent = `${players.get(m.lastPoint.missedBy)?.name ?? ''} 실점. 점수 ${m.score[0]} 대 ${m.score[1]}`;
    }
    for (const el of this.layer.children) {
      el.classList.toggle('is-target', m.stage === 'rally' && m.ball?.to === el.dataset.id);
    }
    this.renderOverlay();
  }

  renderPlayers() {
    const m = this.match;
    this.layer.innerHTML = '';
    if (!m) return;
    const players = playerMap(this.data);
    const teams = this.data.state.teams;
    [m.a, m.b].forEach((teamIdx, side) => {
      for (const id of teams[teamIdx].members) {
        const p = players.get(id);
        const pos = this.posOf(id);
        const el = document.createElement('div');
        el.className = 'pk-player';
        el.dataset.id = id;
        el.dataset.side = String(side);
        el.dataset.screen = pos.y > 50 ? 'bottom' : 'top';
        if (id === this.meId) el.classList.add('is-me');
        el.style.left = `${pos.x}%`;
        el.style.top = `${pos.y}%`;
        el.innerHTML = `<div class="pk-ring" aria-hidden="true"></div><div class="pk-body">${avatarSvg(p?.avatar)}<span class="pk-paddle" aria-hidden="true"></span></div><span class="pk-tag">${escapeHtml(p?.name ?? '?')}${id === this.meId ? ' (나)' : ''}</span>`;
        this.layer.append(el);
      }
    });
  }

  flash(id, cls) {
    const el = [...this.layer.children].find((x) => x.dataset.id === id);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  pop(id, text, grade) {
    const el = [...this.layer.children].find((x) => x.dataset.id === id);
    if (!el || !text) return;
    const pop = document.createElement('span');
    pop.className = `pk-pop pk-pop-${grade}`;
    pop.textContent = text;
    el.append(pop);
    setTimeout(() => pop.remove(), 1100);
  }

  renderOverlay() {
    const m = this.match;
    const { state } = this.data;
    const players = playerMap(this.data);
    const nearSide = this.flipped ? 1 : 0;
    const teamIdx = (side) => (side === 0 ? m.a : m.b);
    let html = '';
    if (m.stage === 'intro') {
      const secs = Math.max(1, Math.ceil((m.stageEndsAt - clock.now()) / 1000));
      html = `<div class="pk-card pk-card-intro"><p class="pk-eyebrow">${escapeHtml(matchLabel(state, m.id))}</p>
        <p class="pk-vs-team" data-side="${1 - nearSide}">${escapeHtml(teamNames(this.data, teamIdx(1 - nearSide), players))}</p>
        <p class="pk-vs">VS</p>
        <p class="pk-vs-team" data-side="${nearSide}">${escapeHtml(teamNames(this.data, teamIdx(nearSide), players))}</p>
        <p class="pk-count">${secs}</p></div>`;
    } else if (m.stage === 'point' && m.lastPoint) {
      const scorer = teamNames(this.data, teamIdx(m.lastPoint.side), players);
      html = `<div class="pk-banner" data-side="${m.lastPoint.side}"><strong>득점!</strong> ${escapeHtml(scorer)}</div>`;
    } else if (m.stage === 'end') {
      const secs = Math.max(0, Math.ceil((m.stageEndsAt - clock.now()) / 1000));
      const isFinal = state.rounds[m.round].length === 1;
      html = `<div class="pk-card pk-card-end"><p class="pk-eyebrow">${escapeHtml(matchLabel(state, m.id))} 종료</p>
        <p class="pk-win-team" data-side="${m.winnerSide}">${escapeHtml(teamNames(this.data, teamIdx(m.winnerSide), players))}</p>
        <p class="pk-win-label">승리!</p>
        <p class="pk-final-score">${m.score[0]} : ${m.score[1]}</p>
        <p class="pk-next">${isFinal ? '곧 시상식이 시작됩니다' : `다음 경기 ${secs}초 후`}</p></div>`;
    }
    if (this.overlay.innerHTML !== html) this.overlay.innerHTML = html;
    this.overlay.hidden = !html;
  }

  frame() {
    const m = this.match;
    if (!m) return;
    if (m.stage === 'intro' || m.stage === 'end') this.renderOverlay();
    const b = m.stage === 'rally' ? m.ball : null;
    this.ball.hidden = this.shadow.hidden = !b;
    if (!b) return;
    const now = clock.now();
    const from = this.posOf(b.from);
    const to = this.posOf(b.to);
    // Start the ball just in front of the hitter's paddle so it travels toward the net.
    const lift = (p) => ({ x: p.x, y: p.y + (p.y > 50 ? -6 : 6) });
    const a = lift(from);
    const z = lift(to);
    const t = Math.min(1, Math.max(0, (now - b.launchAt) / (b.arriveAt - b.launchAt)));
    let x = a.x + (z.x - a.x) * t;
    let y = a.y + (z.y - a.y) * t;
    let height = Math.sin(Math.PI * t) * (b.kind === 'serve' ? 22 : 16);
    if (now > b.arriveAt) {
      const since = now - b.arriveAt;
      height = Math.abs(Math.sin(since / 110)) * 5 * Math.max(0, 1 - since / 700);
    }
    const { w, h } = this.size;
    const px = (x / 100) * w;
    const py = (y / 100) * h;
    const lifted = py - (height / 100) * h;
    const scale = 1 + height / 40;
    this.shadow.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) scale(${1 - height / 60})`;
    this.ball.style.transform = `translate(${px}px, ${lifted}px) translate(-50%, -50%) scale(${scale})`;

    const target = [...this.layer.children].find((el) => el.dataset.id === b.to);
    if (target) {
      const progress = Math.min(1, Math.max(0, (now - b.launchAt) / (b.arriveAt - b.launchAt)));
      target.style.setProperty('--ring', String(2.1 - 1.1 * progress));
      target.classList.toggle('is-hot', now >= b.windowStart && now <= b.windowEnd);
    }
  }
}

// ---------- Scoreboard ----------
export function renderScoreboard(el, data, meId) {
  const { state } = data;
  const m = state.match;
  if (!m || state.phase !== 'playing') {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const players = playerMap(data);
  const inA = state.teams[m.a].members.includes(meId);
  const inB = state.teams[m.b].members.includes(meId);
  const near = inB ? 1 : 0;
  const sides = [1 - near, near];
  const html = sides
    .map((side) => {
      const teamIdx = side === 0 ? m.a : m.b;
      const mine = (side === 0 && inA) || (side === 1 && inB);
      const serving = m.serving === side && m.stage !== 'end';
      return `<div class="pk-sb-team" data-side="${side}">
        <span class="pk-sb-names">${escapeHtml(teamNames(data, teamIdx, players))}${mine ? ' <em>내 팀</em>' : ''}</span>
        <span class="pk-sb-score">${serving ? '<span class="pk-serve-dot" aria-label="서브권"></span>' : ''}${m.score[side]}</span>
      </div>`;
    })
    .join('');
  const full = `<p class="pk-sb-label">${escapeHtml(matchLabel(state, m.id))} · ${state.target}점 선승</p><div class="pk-sb-rows">${html}</div>`;
  if (el.innerHTML !== full) el.innerHTML = full;
}

// ---------- Bracket ----------
export function renderBracket(el, data, meId) {
  const { state } = data;
  if (!state.rounds.length) {
    el.innerHTML = '<p class="pk-empty">진행자가 시작하면 대진표가 만들어져요.</p>';
    return;
  }
  const players = playerMap(data);
  const myTeam = teamOf(state, meId)?.id ?? null;
  const currentId = state.phase === 'playing' ? state.match?.id : null;
  const teamRow = (teamIdx, m, score) => {
    if (teamIdx === null) return `<li class="pk-bt pk-bt-empty">${m.bye && m.a !== null ? '부전승' : '미정'}</li>`;
    const won = m.winner !== null && m.winner === teamIdx;
    const lost = m.winner !== null && !m.bye && m.winner !== teamIdx;
    const cls = ['pk-bt', won && 'is-won', lost && 'is-lost', teamIdx === myTeam && 'is-mine'].filter(Boolean).join(' ');
    return `<li class="${cls}"><span>${escapeHtml(teamNames(data, teamIdx, players))}</span><b>${score ?? ''}</b></li>`;
  };
  const html = state.rounds
    .map((round, r) => {
      const cards = round
        .map((m) => {
          const live = m.id === currentId ? (state.match.score ?? null) : null;
          const score = live ?? m.score;
          return `<ol class="pk-bm${m.id === currentId ? ' is-live' : ''}${m.bye ? ' is-bye' : ''}" aria-label="${escapeHtml(matchLabel(state, m.id) || '부전승')}">
            ${teamRow(m.a, m, score?.[0])}${teamRow(m.b, m, score?.[1])}</ol>`;
        })
        .join('');
      return `<section class="pk-bround"><h3>${roundName(state, r)}</h3><div class="pk-bcards">${cards}</div></section>`;
    })
    .join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}

// ---------- Ceremony ----------
export function renderPodium(el, data, meId) {
  const { state } = data;
  const pod = state.podium;
  if (!pod) return;
  const players = playerMap(data);
  const card = (teamIdx, place, label) => {
    if (teamIdx === null || teamIdx === undefined) return '';
    const team = state.teams[teamIdx];
    const mine = team.members.includes(meId);
    const faces = team.members
      .map((id) => `<span class="pk-pod-face">${avatarSvg(players.get(id)?.avatar)}<span>${escapeHtml(players.get(id)?.name ?? '?')}</span></span>`)
      .join('');
    return `<li class="pk-pod pk-pod-${place}${mine ? ' is-mine' : ''}"><span class="pk-pod-rank">${label}</span><div class="pk-pod-faces">${faces}</div></li>`;
  };
  const html = `<ol class="pk-podium">${card(pod.second, 2, '준우승')}${card(pod.first, 1, '우승')}${pod.third.map((t) => card(t, 3, '3위')).join('')}</ol>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

export class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.colors = ['#d9f24a', '#ff6b4a', '#ffffff', '#7dd3a8', '#ffd95e'];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  start() {
    if (this.running || this.reduced) return;
    this.running = true;
    this.started = performance.now();
    this.nextBurst = 0;
    const loop = (t) => {
      if (!this.running) return;
      this.draw(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.parts = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  burst(x, y) {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    for (let i = 0; i < 60; i++) {
      const a = (Math.PI * 2 * i) / 60;
      const v = 2 + Math.random() * 3.5;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color, size: 2 + Math.random() * 2 });
    }
  }

  draw(t) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const elapsed = t - this.started;
    if (t >= this.nextBurst) {
      this.burst(w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.35));
      this.nextBurst = t + (elapsed < 6000 ? 350 : 1100);
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.vx *= 0.985;
      p.life -= 0.012;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
