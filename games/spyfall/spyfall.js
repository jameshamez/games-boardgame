'use strict';
// เกมสายลับ (Spyfall) — เครื่องคนสร้างห้องเป็นตัวเดินเกม (แจกบทบาท นับเวลา นับโหวต) และเล่นด้วย
// ต้องโหลดหลัง locations.js, sp-ui.js และ assets/net-*.js

const MIN_PLAYERS = 3;
const HOST_PID = 'host';

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('spyfall.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('spyfall.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

function inRoom() {
  try { return sessionStorage.getItem('spyfall.inRoom') === '1'; } catch { return false; }
}
function setInRoom(on) {
  try {
    if (on) sessionStorage.setItem('spyfall.inRoom', '1');
    else { sessionStorage.removeItem('spyfall.inRoom'); sessionStorage.removeItem('spyfall.cloudHost'); }
  } catch { /* ignore */ }
}

const S = {
  screen: inRoom() ? 'lobby' : 'home',   // home › lobby › play › end
  error: '',
  name: store.get('name', ''),
  joined: [],                             // [{pid, name, online, local?}] — คนสร้างห้องอยู่คนแรกเสมอ
  settings: Object.assign({ pack: 'mix', minutes: 8 }, store.get('settings', {})),
  players: [],                            // [{id, pid, name, spy, role}]
  round: 0,
  location: null,                         // สถานที่ของรอบนี้
  locations: [],                          // สถานที่ทั้งหมดที่เป็นไปได้ (ให้ทุกคนดู และให้สายลับเดา)
  first: null,                            // คนที่เริ่มถามก่อน
  endAt: null,
  paused: false,
  pausedLeft: null,
  accused: new Set(),                     // คนที่ใช้สิทธิ์กล่าวหาไปแล้วในรอบนี้ (คนละครั้ง)
  vote: null,                             // การโหวตที่กำลังเกิดขึ้น (กล่าวหา / หมดเวลา)
  voteSeq: 0,
  notice: null,                           // ข้อความแจ้งทุกคน { seq, text }
  result: null,
  scores: {},                             // แต้มสะสม pid → แต้ม
  gained: {},                             // แต้มที่ได้ในรอบนี้
  used: new Set(),                        // สถานที่ที่เล่นไปแล้ว (ไม่ให้ซ้ำจนกว่าจะครบ)
};

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => S.players.find(p => p.id === id);
const byPid = pid => S.players.find(p => p.pid === pid);
const spyPlayer = () => S.players.find(p => p.spy);
const roundKey = () => `r${S.round}`;

function syncHostEntry() {
  const host = S.joined.find(j => j.pid === HOST_PID);
  if (host) host.name = S.name;
  else S.joined.unshift({ pid: HOST_PID, name: S.name, online: true, local: true });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function locationPool() {
  const packs = S.settings.pack === 'mix' ? Object.values(LOCATION_PACKS) : [LOCATION_PACKS[S.settings.pack]];
  return packs.flatMap(p => p.list);
}

// ---------- เวลา ----------
/** เวลาที่เหลือ (ms) */
function remaining() {
  return S.paused ? S.pausedLeft : Math.max(0, S.endAt - Date.now());
}
function pauseClock() {
  if (S.paused) return;
  S.pausedLeft = remaining();
  S.paused = true;
}
function resumeClock() {
  if (!S.paused) return;
  S.endAt = Date.now() + S.pausedLeft;
  S.paused = false;
}

setInterval(() => {
  if (S.screen === 'play' && !S.vote && !S.paused && remaining() === 0) startFinalVote();
}, 500);

function notify(text) {
  S.notice = { seq: (S.notice ? S.notice.seq : 0) + 1, text };
}

// ---------- เดินเกม ----------
function startRound() {
  if (S.joined.length < MIN_PLAYERS) return;
  S.round += 1;
  const pool = locationPool();
  let fresh = pool.filter(l => !S.used.has(l.name));
  if (!fresh.length) { S.used.clear(); fresh = pool; }
  S.location = fresh[Math.floor(Math.random() * fresh.length)];
  S.used.add(S.location.name);
  S.locations = pool.map(l => ({ name: l.name, icon: l.icon }));

  const spyIdx = Math.floor(Math.random() * S.joined.length);
  const roles = shuffle(S.location.roles);
  let k = 0;
  S.players = S.joined.map((j, id) => {
    const spy = id === spyIdx;
    return { id, pid: j.pid, name: j.name, spy, role: spy ? null : roles[k++ % roles.length] };
  });
  S.first = Math.floor(Math.random() * S.players.length);
  S.accused = new Set();
  S.vote = null;
  S.notice = null;
  S.result = null;
  S.gained = {};
  S.paused = false;
  S.pausedLeft = null;
  S.endAt = Date.now() + S.settings.minutes * 60000;
  S.screen = 'play';
  render();
}

/** มีคนกล่าวหาว่าใครเป็นสายลับ: หยุดเวลา แล้วให้ทุกคน (ยกเว้นคนถูกกล่าวหา) โหวต — ต้องเห็นด้วยทุกคน */
function accuse(pid, targetId) {
  if (S.screen !== 'play' || S.vote) return;
  const by = byPid(pid), t = byId(targetId);
  if (!by || !t || by === t || S.accused.has(by.id)) return;
  S.accused.add(by.id);
  S.voteSeq += 1;
  S.vote = { kind: 'accuse', seq: S.voteSeq, by: by.id, target: t.id, votes: { [by.id]: true }, wasPaused: S.paused };
  pauseClock();
  render();
}

function voteAccuse(pid, seq, yes) {
  const V = S.vote;
  const p = byPid(pid);
  if (!V || V.kind !== 'accuse' || V.seq !== seq || !p || p.id === V.target || p.id in V.votes) return;
  V.votes[p.id] = !!yes;
  if (!yes) return cancelAccusation(`${p.name} ไม่เห็นด้วย — การกล่าวหา ${byId(V.target).name} ไม่ผ่าน เล่นต่อ!`);
  const voters = S.players.filter(o => o.id !== V.target);
  if (voters.every(o => V.votes[o.id] === true)) return convict(V.target, V.by);
  render();
}

function cancelAccusation(text) {
  const V = S.vote;
  if (!V || V.kind !== 'accuse') return;
  S.vote = null;
  if (!V.wasPaused) resumeClock();
  notify(text);
  render();
}

/** หมดเวลา: ทุกคนโหวตว่าใครคือสายลับ คนที่ได้มากที่สุด (ไม่เสมอ) ถูกจับ */
function startFinalVote() {
  if (S.screen !== 'play' || (S.vote && S.vote.kind === 'final')) return;
  pauseClock();
  S.pausedLeft = 0;
  S.voteSeq += 1;
  S.vote = { kind: 'final', seq: S.voteSeq, votes: {} };
  render();
}

function voteFinal(pid, seq, targetId) {
  const V = S.vote;
  const p = byPid(pid), t = byId(targetId);
  if (!V || V.kind !== 'final' || V.seq !== seq || !p || !t || p === t) return;
  V.votes[p.id] = t.id;
  if (S.players.every(o => o.id in V.votes)) return resolveFinal();
  render();
}

function finalTally() {
  const t = {};
  Object.values(S.vote.votes).forEach(id => { t[id] = (t[id] || 0) + 1; });
  return Object.entries(t).map(([id, n]) => ({ id: Number(id), n })).sort((a, b) => b.n - a.n);
}

function resolveFinal() {
  if (!S.vote || S.vote.kind !== 'final') return;
  const [top, second] = finalTally();
  if (top && (!second || second.n < top.n)) return convict(top.id, null);
  finish('spy', 'หมดเวลาแล้ว แต่โหวตไม่ลงตัว — สายลับหนีรอดไปได้!');
}

function convict(targetId, accuserId) {
  const t = byId(targetId);
  if (t.spy) {
    const how = accuserId != null ? `${byId(accuserId).name} ชี้ตัว` : 'ทุกคนโหวต';
    finish('agents', `${how} ${t.name} ถูกต้อง — จับสายลับได้!`, accuserId);
  } else {
    finish('spy', `${t.name} ไม่ใช่สายลับ! จับผิดคน — สายลับคือ ${spyPlayer().name}`);
  }
}

/** สายลับเปิดตัวแล้วเดาสถานที่ (ทำได้ทุกเมื่อที่ไม่ได้อยู่ระหว่างโหวต) */
function spyGuess(pid, name) {
  const p = byPid(pid);
  if (S.screen !== 'play' || S.vote || !p || !p.spy || !S.locations.some(l => l.name === name)) return;
  if (name === S.location.name) finish('spy', `สายลับ ${p.name} เดาถูกว่าทุกคนอยู่ที่ “${name}”!`, null, name);
  else finish('agents', `สายลับ ${p.name} เดาว่า “${name}” แต่ผิด!`, null, name);
}

/** จบรอบ แจกแต้ม: สายลับชนะ +2 (เดาถูก +4) · สายลับแพ้ ทุกคนที่เหลือ +1 คนชี้ตัวถูก +2 */
function finish(winner, text, accuserId = null, guess = null) {
  S.result = { winner, text, guess };
  S.gained = {};
  const spy = spyPlayer();
  if (winner === 'spy') S.gained[spy.pid] = guess ? 4 : 2;
  else S.players.filter(p => !p.spy).forEach(p => { S.gained[p.pid] = p.id === accuserId ? 2 : 1; });
  for (const [pid, n] of Object.entries(S.gained)) S.scores[pid] = (S.scores[pid] || 0) + n;
  S.vote = null;
  S.screen = 'end';
  render();
}

// ---------- หน้าจอของแต่ละคน (ส่งให้เฉพาะเจ้าตัว) ----------
function voteView(p) {
  const V = S.vote;
  if (!V) return null;
  if (V.kind === 'accuse') {
    const voters = S.players.filter(o => o.id !== V.target);
    return {
      kind: 'accuse', seq: V.seq, byName: byId(V.by).name, targetName: byId(V.target).name,
      targetIsMe: V.target === p.id, byMe: V.by === p.id,
      myVote: p.id in V.votes ? V.votes[p.id] : undefined,
      yes: voters.filter(o => V.votes[o.id] === true).length, need: voters.length,
    };
  }
  return {
    kind: 'final', seq: V.seq, myVote: p.id in V.votes ? V.votes[p.id] : undefined,
    done: Object.keys(V.votes).length, total: S.players.length,
  };
}

function viewFor(p) {
  if (S.screen === 'lobby') return { phase: 'lobby', name: p.name, count: S.joined.length };
  const scoreOf = o => S.scores[o.pid] || 0;
  if (S.screen === 'end') {
    const R = S.result;
    return {
      phase: 'end', winner: R.winner, text: R.text,
      won: p.spy ? R.winner === 'spy' : R.winner === 'agents',
      location: { name: S.location.name, icon: S.location.icon },
      spyName: spyPlayer().name,
      results: S.players.map(o => ({
        name: o.name, spy: o.spy, role: o.role, isMe: o.id === p.id,
        won: o.spy ? R.winner === 'spy' : R.winner === 'agents',
        gained: S.gained[o.pid] || 0, score: scoreOf(o),
      })).sort((a, b) => b.score - a.score),
    };
  }
  return {
    phase: 'play', key: roundKey(), remaining: remaining(), paused: S.paused,
    // สถานที่จริงส่งให้เฉพาะคนที่ไม่ใช่สายลับ
    me: { id: p.id, name: p.name, spy: p.spy, location: p.spy ? null : S.location.name,
      icon: p.spy ? null : S.location.icon, role: p.role, score: scoreOf(p) },
    firstName: byId(S.first).name, firstIsMe: S.first === p.id,
    locations: S.locations,
    others: S.players.filter(o => o.id !== p.id).map(o => ({ id: o.id, name: o.name })),
    canAccuse: !S.accused.has(p.id),
    vote: voteView(p),
    notice: S.notice,
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
const meUI = createSpUI(action => setTimeout(() => handleAction(HOST_PID, action)));

function render() {
  if (S.screen === 'home') $app.innerHTML = homeView();
  else if (S.screen === 'lobby') $app.innerHTML = lobbyView();
  else {
    $app.innerHTML = `${hostBar()}<section id="me" class="sp-me-panel"></section>`;
    meUI.mount(document.getElementById('me'));
    const me = byPid(HOST_PID);
    if (me) meUI.setView(viewFor(me));
  }
  drawQr();
  publishViews();
}

function homeView() {
  return `
    <section class="hero">
      <div class="sp-logo">🕵️</div>
      <h1>สายลับ</h1>
      <p>ทุกคนรู้ว่าอยู่ที่ไหน ยกเว้นสายลับหนึ่งคน — ถามตอบกันให้จับสายลับได้ ก่อนเขาจะเดาสถานที่ออก!</p>
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
  const all = Object.values(LOCATION_PACKS).reduce((a, p) => a + p.list.length, 0);
  const packs = [['mix', { name: 'คละทุกชุด', icon: '🎲', desc: `ทั้งหมด ${all} สถานที่` }],
    ...Object.entries(LOCATION_PACKS).map(([id, p]) => [id, { ...p, desc: `${p.desc} · ${p.list.length} แห่ง` }])];
  return `
    <button class="btn-ghost small-btn back-home" data-act="close">← ปิดห้อง</button>
    <section class="panel">
      <strong>ผู้เล่น (${n} คน)</strong>
      ${join}
      <div class="name-list">
        ${S.joined.map((j, i) => `
          <div class="row name-row">
            <span class="seat">${i + 1}</span>
            <span class="grow lobby-name"><i class="dot ${j.online ? 'on' : ''}"></i>${esc(j.name)}${j.local ? ' <small class="muted">· คุณ</small>' : ''}${S.scores[j.pid] ? ` <small class="sp-pts">${S.scores[j.pid]} แต้ม</small>` : ''}</span>
            ${j.local ? '' : `<button class="icon-btn" data-act="kick" data-pid="${j.pid}" aria-label="ลบ">✕</button>`}
          </div>`).join('')}
      </div>
    </section>

    <section class="panel">
      <strong>ชุดสถานที่</strong>
      <div class="sp-packs">${packs.map(([id, p]) => `
        <button class="sp-pack ${S.settings.pack === id ? 'on' : ''}" data-act="pack" data-id="${id}">
          <span class="sp-pack-icon">${p.icon}</span><b>${p.name}</b><small>${p.desc}</small>
        </button>`).join('')}
      </div>
      <div class="sp-settings">
        <label>เวลาต่อรอบ
          <select data-setting="minutes">${TIME_OPTIONS.map(m =>
            `<option value="${m}" ${S.settings.minutes === m ? 'selected' : ''}>${m} นาที</option>`).join('')}</select></label>
        ${Object.keys(S.scores).length ? '<button class="small-btn" data-act="reset-scores">🧹 ล้างแต้มสะสม</button>' : ''}
      </div>
    </section>

    <div class="start-bar">
      ${n < MIN_PLAYERS ? `<p class="warn">ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (ตอนนี้ ${n} คน)</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>🕵️ เริ่มเกม · แจกบทบาท</button>
    </div>`;
}

function hostBar() {
  if (S.screen === 'end') {
    return `<div class="sp-hostbar">
      <button class="btn-primary" data-act="again">🔁 เล่นรอบต่อไป</button>
      <button data-act="to-lobby">⚙️ กลับห้อง (เปลี่ยนตั้งค่า)</button>
    </div>`;
  }
  const V = S.vote;
  if (V && V.kind === 'accuse') {
    return `<div class="sp-hostbar floating"><button data-act="cancel-accuse">✖️ ยกเลิกการกล่าวหา</button></div>`;
  }
  if (V && V.kind === 'final') {
    return `<div class="sp-hostbar floating"><span class="muted">โหวตแล้ว ${Object.keys(V.votes).length}/${S.players.length} คน</span>
      <button class="btn-primary" data-act="resolve">⚖️ สรุปผลโหวต</button></div>`;
  }
  return `<div class="sp-hostbar">
    <button data-act="pause">${S.paused ? '▶️ ต่อ' : '⏸ หยุดเวลา'}</button>
    <button data-act="time-up">⏰ หมดเวลา · โหวตเลย</button>
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
  if (a.key !== roundKey()) return;
  if (a.type === 'accuse') accuse(pid, Number(a.target));
  else if (a.type === 'vote') voteAccuse(pid, a.seq, a.yes);
  else if (a.type === 'final') voteFinal(pid, a.seq, Number(a.target));
  else if (a.type === 'guess') spyGuess(pid, String(a.location));
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
      S.scores = {};
      S.screen = 'home';
      render();
    },
    kick() { if (confirm('ลบผู้เล่นคนนี้ออกจากห้อง?')) Net.kick(btn.dataset.pid); },
    pack() {
      S.settings.pack = btn.dataset.id;
      store.set('settings', S.settings);
      render();
    },
    'reset-scores'() { S.scores = {}; render(); },
    start: startRound,
    again: startRound,
    'to-lobby'() { S.screen = 'lobby'; render(); },
    pause() { if (S.paused) resumeClock(); else pauseClock(); render(); },
    'time-up'() { if (confirm('จบการถามตอบ แล้วให้ทุกคนโหวตหาสายลับเลย?')) startFinalVote(); },
    'cancel-accuse'() { cancelAccusation('คนสร้างห้องยกเลิกการกล่าวหา — เล่นต่อ!'); },
    resolve: resolveFinal,
  };
  ACTIONS[act]?.();
});

document.addEventListener('change', e => {
  const key = e.target.dataset.setting;
  if (!key) return;
  S.settings[key] = Number(e.target.value);
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
