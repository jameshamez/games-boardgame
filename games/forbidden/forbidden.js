'use strict';
// เกมคำต้องห้าม — เครื่องคนสร้างห้องเป็นตัวเดินเกม (แจกคำ นับเวลา ตัดสินการจับ) และเล่นด้วย
// ต้องโหลดหลัง words.js, fw-ui.js และ assets/net-*.js

const MIN_PLAYERS = 3;
const HOST_PID = 'host';

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('forbidden.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('forbidden.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

function inRoom() {
  try { return sessionStorage.getItem('forbidden.inRoom') === '1'; } catch { return false; }
}
function setInRoom(on) {
  try {
    if (on) sessionStorage.setItem('forbidden.inRoom', '1');
    else { sessionStorage.removeItem('forbidden.inRoom'); sessionStorage.removeItem('forbidden.cloudHost'); }
  } catch { /* ignore */ }
}

const S = {
  screen: inRoom() ? 'lobby' : 'home',   // home › lobby › play › end
  error: '',
  name: store.get('name', ''),
  joined: [],                             // [{pid, name, online, local?}] — คนสร้างห้องอยู่คนแรกเสมอ
  settings: Object.assign({ category: 'mix', minutes: 10, mode: 'out' }, store.get('settings', {})),
  players: [],                            // [{id, pid, name, word, words, alive, score, catches}]
  round: 0,
  endAt: null,                            // เวลาจบ (ms) — null = ไม่จำกัดเวลา
  paused: false,
  pausedLeft: null,                       // เวลาที่เหลือตอนกดหยุด
  events: [],                             // การจับทั้งหมดในรอบนี้
  eventSeq: 0,
  history: [],                            // ไว้ย้อนการจับที่กดผิด
  used: new Set(),
};

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => S.players.find(p => p.id === id);
const alivePlayers = () => S.players.filter(p => p.alive);
const roundKey = () => `r${S.round}`;

function syncHostEntry() {
  const host = S.joined.find(j => j.pid === HOST_PID);
  if (host) host.name = S.name;
  else S.joined.unshift({ pid: HOST_PID, name: S.name, online: true, local: true });
}

// ---------- แจกคำ ----------
function wordPool() {
  const sets = S.settings.category === 'mix' ? Object.values(WORD_SETS) : [WORD_SETS[S.settings.category]];
  return [...new Set(sets.flatMap(s => s.words))];
}
function drawWord() {
  let pool = wordPool().filter(w => !S.used.has(w));
  if (!pool.length) { S.used.clear(); pool = wordPool(); }
  const w = pool[Math.floor(Math.random() * pool.length)];
  S.used.add(w);
  return w;
}

// ---------- เวลา ----------
/** เวลาที่เหลือ (ms) — null = ไม่จำกัดเวลา */
function remaining() {
  if (!S.settings.minutes) return null;
  return S.paused ? S.pausedLeft : Math.max(0, S.endAt - Date.now());
}
const paused = () => S.paused;

setInterval(() => {
  if (S.screen !== 'play') return;
  const left = remaining();
  const el = document.querySelector('[data-host-timer]');
  if (el) el.textContent = left == null ? '∞' : `${Math.floor(left / 60000)}:${String(Math.ceil(left / 1000) % 60).padStart(2, '0')}`;
  if (left === 0 && !paused()) endGame();
}, 500);

// ---------- เดินเกม ----------
function startRound() {
  S.round += 1;
  S.used = new Set();
  S.players = S.joined.map((j, id) => {
    const word = drawWord();
    return { id, pid: j.pid, name: j.name, word, words: [word], alive: true, score: 0, catches: 0 };
  });
  S.events = [];
  S.history = [];
  S.paused = false;
  S.pausedLeft = null;
  S.endAt = S.settings.minutes ? Date.now() + S.settings.minutes * 60000 : null;
  S.screen = 'play';
  render();
}

function catchPlayer(catcherPid, targetId) {
  if (S.screen !== 'play' || paused()) return;
  const catcher = S.players.find(p => p.pid === catcherPid);
  const target = byId(targetId);
  if (!catcher || !target || catcher === target || !target.alive) return;
  if (S.settings.mode === 'out' && !catcher.alive) return;
  // หลายคนกดจับคนเดียวกันพร้อมกัน: นับครั้งเดียว
  const last = S.events[S.events.length - 1];
  if (last && last.target === target.id && Date.now() - last.at < 4000) return;

  S.history.push(JSON.stringify({ players: S.players, events: S.events }));
  S.eventSeq += 1;
  S.events.push({ seq: S.eventSeq, at: Date.now(), catcher: catcher.id, target: target.id, word: target.word });
  catcher.catches += 1;
  if (S.settings.mode === 'score') {
    catcher.score += 1;
    target.score -= 1;
    target.word = drawWord();
    target.words.push(target.word);
  } else {
    target.alive = false;
  }
  render();
  // เหลือคนเดียว: รอให้ทุกคนเห็นว่าใครโดนจับก่อน แล้วค่อยจบ (ถ้ายังไม่ได้กดย้อน)
  if (S.settings.mode === 'out' && alivePlayers().length <= 1) {
    setTimeout(() => { if (S.settings.mode === 'out' && alivePlayers().length <= 1) endGame(); }, 2500);
  }
}

function undoCatch() {
  const snap = S.history.pop();
  if (!snap) return;
  const { players, events } = JSON.parse(snap);
  S.players = players;
  S.events = events;
  if (S.screen === 'end') S.screen = 'play';
  render();
}

/** หยุดเวลาและห้ามจับชั่วคราว */
function togglePause() {
  if (S.paused) {
    if (S.settings.minutes) S.endAt = Date.now() + S.pausedLeft;
    S.paused = false;
  } else {
    S.pausedLeft = remaining();
    S.paused = true;
  }
  render();
}

function results() {
  const rows = S.players.map(p => ({ ...p }));
  if (S.settings.mode === 'score') {
    rows.sort((a, b) => b.score - a.score || b.catches - a.catches);
    const top = rows.length ? rows[0].score : 0;
    rows.forEach(r => { r.win = r.score === top; });
  } else {
    rows.sort((a, b) => (b.alive - a.alive) || b.catches - a.catches);
    rows.forEach(r => { r.win = r.alive; });
  }
  return rows;
}

function endGame() {
  if (S.screen !== 'play') return;
  S.screen = 'end';
  render();
}

// ---------- หน้าจอของแต่ละคน (ส่งให้เฉพาะเจ้าตัว) ----------
function viewFor(p) {
  if (S.screen === 'lobby') return { phase: 'lobby', name: p.name, count: S.joined.length };
  if (S.screen === 'end') {
    return {
      phase: 'end', mode: S.settings.mode,
      results: results().map(r => ({ name: r.name, words: r.words, alive: r.alive, score: r.score, win: r.win, isMe: r.id === p.id })),
    };
  }
  const last = S.events[S.events.length - 1];
  return {
    phase: 'play', key: roundKey(), mode: S.settings.mode, remaining: remaining(), paused: paused(),
    // คำของตัวเองจะส่งให้ก็ต่อเมื่อตกรอบแล้วเท่านั้น
    me: { id: p.id, name: p.name, alive: p.alive, score: p.score, catches: p.catches, word: p.alive ? undefined : p.word },
    others: S.players.filter(o => o.id !== p.id)
      .map(o => ({ id: o.id, name: o.name, word: o.word, alive: o.alive, score: o.score })),
    event: last ? {
      seq: last.seq, word: last.word,
      catcherName: byId(last.catcher).name, targetName: byId(last.target).name,
      targetIsMe: last.target === p.id, catcherIsMe: last.catcher === p.id,
    } : null,
  };
}

function publishViews() {
  if (!Net.active) return;
  const views = {};
  if (S.screen === 'lobby') S.joined.forEach(j => { if (!j.local) views[j.pid] = { phase: 'lobby', name: j.name, count: S.joined.length }; });
  else S.players.forEach(p => { if (p.pid !== HOST_PID) views[p.pid] = viewFor(p); });
  Net.publish(views);
}

// ---------- หน้าจอเครื่องคนสร้างห้อง ----------
const meUI = createFwUI(action => setTimeout(() => handleAction(HOST_PID, action)));

function render() {
  if (S.screen === 'home') $app.innerHTML = homeView();
  else if (S.screen === 'lobby') $app.innerHTML = lobbyView();
  else {
    $app.innerHTML = `${hostBar()}<section id="me" class="fw-me-panel"></section>`;
    meUI.mount(document.getElementById('me'));
    const me = S.players.find(p => p.pid === HOST_PID);
    if (me) meUI.setView(viewFor(me));
  }
  drawQr();
  publishViews();
}

function homeView() {
  return `
    <section class="hero">
      <div class="fw-logo">🤫</div>
      <h1>คำต้องห้าม</h1>
      <p>ทุกคนเห็นคำต้องห้ามของคนอื่น แต่ไม่รู้คำของตัวเอง — หลอกให้เพื่อนพูดออกมาให้ได้!</p>
    </section>

    <section class="panel home-card">
      <h3>🏠 สร้างห้องใหม่</h3>
      <input type="text" id="create-name" placeholder="ชื่อของคุณ" maxlength="20" value="${esc(S.name)}" autocomplete="nickname">
      ${S.error ? `<p class="warn">⚠️ ${esc(S.error)}</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="create">สร้างห้อง</button>
      <small class="muted">ได้เลขห้อง 6 หลักให้เพื่อนกรอก · คุณเล่นด้วย ไม่ต้องมีคนคุมเกม</small>
    </section>

    <section class="panel home-card">
      <h3>🔑 เข้าร่วมห้อง</h3>
      <form id="join-room" class="stack">
        <input type="text" name="code" maxlength="6" placeholder="เลขห้อง" autocapitalize="characters" autocomplete="off">
        <input type="text" name="name" placeholder="ชื่อของคุณ" maxlength="20" autocomplete="nickname">
        <button class="btn-block btn-big" type="submit">เข้าร่วม</button>
      </form>
    </section>`;
}

function lobbyView() {
  const n = S.joined.length;
  const join = Net.error ? `<p class="warn">⚠️ ${Net.error}</p>`
    : !Net.room ? '<p class="muted">กำลังเปิดห้อง…</p>'
    : `<div class="join-box">
        <div id="qr" class="qr" data-url="${esc(Net.joinUrl())}"></div>
        <div class="join-info">
          <p>เลขห้อง</p>
          <b class="room-code big">${Net.room}</b>
          <p class="muted">ให้เพื่อนเปิดเว็บนี้ › เข้าร่วมห้อง › กรอกเลขห้อง หรือสแกน QR</p>
          <code>${esc(Net.joinUrl())}</code>
        </div>
      </div>`;
  const cats = [['mix', { name: 'คละทุกหมวด', icon: '🎲', level: 'แนะนำ', desc: 'สุ่มจากทุกหมวด' }], ...Object.entries(WORD_SETS)];
  return `
    <button class="btn-ghost small-btn back-home" data-act="close">← ปิดห้อง</button>
    <section class="panel">
      <strong>ผู้เล่น (${n} คน)</strong>
      ${join}
      <div class="name-list">
        ${S.joined.map((j, i) => `
          <div class="row name-row">
            <span class="seat">${i + 1}</span>
            <span class="grow lobby-name"><i class="dot ${j.online ? 'on' : ''}"></i>${esc(j.name)}${j.local ? ' <small class="muted">· คุณ</small>' : ''}</span>
            ${j.local ? '' : `<button class="icon-btn" data-act="kick" data-pid="${j.pid}" aria-label="ลบ">✕</button>`}
          </div>`).join('')}
      </div>
    </section>

    <section class="panel">
      <strong>หมวดคำ</strong>
      <div class="fw-cats">${cats.map(([id, c]) => `
        <button class="fw-cat ${S.settings.category === id ? 'on' : ''}" data-act="cat" data-id="${id}">
          <span class="fw-cat-icon">${c.icon}</span><b>${c.name}</b><small>${c.level} · ${c.desc}</small>
        </button>`).join('')}
      </div>
      <div class="fw-settings">
        <label>เวลา
          <select data-setting="minutes">${TIME_OPTIONS.map(m =>
            `<option value="${m}" ${S.settings.minutes === m ? 'selected' : ''}>${m ? `${m} นาที` : 'ไม่จำกัด'}</option>`).join('')}</select></label>
        <label>โหมด
          <select data-setting="mode">
            <option value="out" ${S.settings.mode === 'out' ? 'selected' : ''}>ตกรอบ — รอดคนสุดท้ายชนะ</option>
            <option value="score" ${S.settings.mode === 'score' ? 'selected' : ''}>นับแต้ม — จับได้ +1 โดนจับ −1</option>
          </select></label>
      </div>
    </section>

    <div class="start-bar">
      ${n < MIN_PLAYERS ? `<p class="warn">ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (ตอนนี้ ${n} คน)</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>🤫 เริ่มเกม · แจกคำ</button>
    </div>`;
}

function hostBar() {
  if (S.screen === 'end') {
    return `<div class="fw-hostbar">
      <button class="btn-primary" data-act="again">🔁 เล่นอีกรอบ</button>
      <button data-act="to-lobby">⚙️ กลับห้อง (เปลี่ยนตั้งค่า)</button>
      ${S.history.length ? '<button data-act="undo">↩️ ยกเลิกการจับล่าสุด</button>' : ''}
    </div>`;
  }
  return `<div class="fw-hostbar">
    <span class="fw-host-timer" data-host-timer></span>
    <button data-act="pause">${paused() ? '▶️ ต่อ' : '⏸ หยุด'}</button>
    <button data-act="undo" ${S.history.length ? '' : 'disabled'}>↩️ ยกเลิกจับล่าสุด</button>
    <button data-act="end">⏹ จบเกม</button>
  </div>`;
}

function drawQr() {
  const el = document.getElementById('qr');
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text: el.dataset.url, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
}

// ---------- รับการกดจากมือถือ ----------
function handleAction(pid, a) {
  if (a.type === 'catch' && a.key === roundKey()) catchPlayer(pid, Number(a.target));
}

Net.onLobby = () => { if (S.screen === 'lobby') render(); else publishViews(); };
Net.onAction = handleAction;

// ---------- ปุ่มต่าง ๆ ----------
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const ACTIONS = {
    create() {
      const name = ($app.querySelector('#create-name')?.value || '').trim();
      if (!name) { S.error = 'ใส่ชื่อของคุณก่อน'; return render(); }
      S.error = '';
      S.name = name;
      store.set('name', name);
      S.joined = [];
      syncHostEntry();
      setInRoom(true);
      S.screen = 'lobby';
      Net.start().then(render);
      render();
    },
    close() {
      if (S.joined.some(j => !j.local) && !confirm('ปิดห้องนี้? เพื่อนในห้องจะต้องเข้าห้องใหม่')) return;
      Net.stop();
      setInRoom(false);
      S.joined = [];
      S.screen = 'home';
      render();
    },
    kick() { if (confirm('ลบผู้เล่นคนนี้ออกจากห้อง?')) Net.kick(btn.dataset.pid); },
    cat() {
      S.settings.category = btn.dataset.id;
      store.set('settings', S.settings);
      render();
    },
    start: startRound,
    again: startRound,
    'to-lobby'() { S.screen = 'lobby'; render(); },
    pause: togglePause,
    undo: undoCatch,
    end() { if (confirm('จบเกมตอนนี้?')) endGame(); },
  };
  ACTIONS[act]?.();
});

document.addEventListener('change', e => {
  const key = e.target.dataset.setting;
  if (!key) return;
  S.settings[key] = key === 'minutes' ? Number(e.target.value) : e.target.value;
  store.set('settings', S.settings);
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'join-room') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const code = String(f.get('code')).replace(/\s/g, '').toUpperCase();
  const name = String(f.get('name')).trim();
  const warn = msg => {
    e.target.querySelector('.warn')?.remove();
    e.target.insertAdjacentHTML('beforeend', `<p class="warn">⚠️ ${msg}</p>`);
  };
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return warn('เลขห้องไม่ถูกต้อง — ให้ถามเลขห้องจากคนสร้างห้อง');
  if (!name) return warn('ใส่ชื่อของคุณก่อน');
  location.href = `play.html?room=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
});

window.addEventListener('beforeunload', e => {
  if (S.screen === 'play') { e.preventDefault(); e.returnValue = ''; }
});

if (S.screen === 'lobby') { syncHostEntry(); Net.start().then(render); }
render();
