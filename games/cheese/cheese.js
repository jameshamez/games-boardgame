'use strict';
// เกมหนูขโมยชีส — เครื่องคนสร้างห้องเดินเกม (แจกบทบาท/ลูกเต๋า พากย์นาฬิกากลางคืน นับโหวต) และเล่นด้วย
// ต้องโหลดหลัง lines.js, voice/manifest.js, assets/voice.js, ch-ui.js และ assets/net-*.js

const MIN_PLAYERS = 4;
const HOST_PID = 'host';
const AWAKE_TIMEOUT = 45000;   // รอคนที่ตื่นกดหลับตานานสุดเท่านี้ (เผื่อมือถือหลุด)

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('cheese.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('cheese.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
function inRoom() {
  try { return sessionStorage.getItem('cheese.inRoom') === '1'; } catch { return false; }
}
function setInRoom(on) {
  try {
    if (on) sessionStorage.setItem('cheese.inRoom', '1');
    else { sessionStorage.removeItem('cheese.inRoom'); sessionStorage.removeItem('cheese.cloudHost'); }
  } catch { /* ignore */ }
}

const ROLES = {
  mouse: { name: 'หนูขี้เซา', icon: '🐭', team: 'mice', teamName: '🐭 ฝ่ายหนู',
    desc: 'ตื่นตามเวลาบนลูกเต๋า แล้วจำให้ดีว่าเห็นอะไร ช่วยกันหาตัวหัวขโมยตอนเช้า' },
  thief: { name: 'หัวขโมยชีส', icon: '🐀', team: 'thief', teamName: '🧀 ฝ่ายหัวขโมย',
    desc: 'คุณจะขโมยชีสตอนที่ตัวเองตื่น ใครตื่นพร้อมกันจะเห็น! ตอนเช้าต้องเนียนให้รอดจากการโหวต' },
  accomplice: { name: 'ผู้สมรู้ร่วมคิด', icon: '🤝', team: 'thief', teamName: '🧀 ฝ่ายหัวขโมย',
    desc: 'หัวขโมยเลือกคุณเป็นพวก คุณชนะถ้าหัวขโมยรอด (แต่คุณไม่รู้ว่าหัวขโมยคือใคร)' },
};

const S = {
  screen: inRoom() ? 'lobby' : 'home',   // home › lobby › reveal › night › day › end
  error: '',
  name: store.get('name', ''),
  joined: [],
  settings: Object.assign({ talkSec: 180, accomplices: 'auto', voice: true, voiceAll: true, lang: 'both', rate: 1 },
    store.get('settings', {})),
  players: [],      // [{id, pid, name, role, die, notes:[], ready}]
  ready: new Set(),
  cheeseHour: null, // ตีที่ชีสถูกขโมย
  night: null,      // {hour, awake:[id], done:Set, peeked:{id:{name,die}}, phase}
  day: null,        // {phase, left, paused, votes:{}}
  winner: null,
  tally: '',
  subtitle: '',
  subtitleEn: '',
  speaking: false,
};

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => S.players.find(p => p.id === id);
const thief = () => S.players.find(p => p.role === 'thief');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function syncHostEntry() {
  const host = S.joined.find(j => j.pid === HOST_PID);
  if (host) host.name = S.name;
  else S.joined.unshift({ pid: HOST_PID, name: S.name, online: true, local: true });
}

function accompliceCount(n) {
  if (S.settings.accomplices === 'auto') return n >= 6 ? 1 : 0;
  return Math.min(Number(S.settings.accomplices), n - 2);
}

// ---------- เสียงพากย์ (เครื่องนี้ + ส่งให้ทุกเครื่องพากย์ตาม) ----------
Voice.cfg = () => S.settings;
let runId = 0;
let saySeq = 0;
function castSay(say) {
  if (!Net.active || !S.settings.voiceAll) return;
  saySeq += 1;
  Net.say({ seq: saySeq, ...say });
}
function newRun() { runId++; Voice.stop(); castSay({ kind: 'hush' }); return runId; }

function setSubtitle(text, speaking, en = '') {
  S.subtitle = text;
  S.subtitleEn = en;
  S.speaking = speaking;
  const el = document.getElementById('subtitle');
  if (el) { el.innerHTML = subtitleInner(); el.classList.toggle('speaking', speaking); }
}
function subtitleInner() {
  return `<span class="sub-th">${esc(S.subtitle)}</span>${S.subtitleEn ? `<span class="sub-en">${esc(S.subtitleEn)}</span>` : ''}`;
}
const subtitleBox = () => `<div id="subtitle" class="subtitle ${S.speaking ? 'speaking' : ''}">${subtitleInner()}</div>`;

async function narrate(lines, id = newRun()) {
  const mode = S.settings.lang;
  for (const line of lines) {
    const th = Array.isArray(line) ? line : [line];
    const en = englishLine(line);
    if (mode === 'en') setSubtitle(en.join(' '), true, '');
    else setSubtitle(th.join(' '), true, mode === 'both' ? en.join(' ') : '');
    const parts = mode === 'th' ? th : mode === 'en' ? en : [...th, ...en];
    castSay({ kind: 'line', sub: S.subtitle, subEn: S.subtitleEn, parts });
    for (const part of parts) {
      if (id !== runId) return false;
      await Voice.speak(part);
    }
    if (id !== runId) return false;
    await sleep(350);
  }
  if (id !== runId) return false;
  setSubtitle(S.subtitle, false, S.subtitleEn);
  return true;
}

/** รอจนกว่า cond() จะจริง หรือหมดเวลา คืน false ถ้าเกมถูกขัดจังหวะ */
async function waitUntil(cond, timeout, id) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (id !== runId) return false;
    if (cond()) return true;
    await sleep(250);
  }
  return id === runId;
}

// ---------- เริ่มเกม ----------
function startGame() {
  const n = S.joined.length;
  const thiefIdx = Math.floor(Math.random() * n);
  S.players = S.joined.map((j, id) => ({
    id, pid: j.pid, name: j.name,
    role: id === thiefIdx ? 'thief' : 'mouse',
    die: 1 + Math.floor(Math.random() * 6),
    notes: [],
  }));
  S.ready = new Set();
  S.cheeseHour = null;
  S.night = null;
  S.day = null;
  S.winner = null;
  S.tally = '';
  S.subtitle = '';
  S.subtitleEn = '';
  S.screen = 'reveal';
  Voice.unlock();
  render();
}

async function runNight() {
  const id = newRun();
  S.screen = 'night';
  S.night = { hour: 0, awake: [], done: new Set(), peeked: {}, phase: 'sleep' };
  render();
  await sleep(500);
  if (!await narrate(LINES.nightStart, id)) return;
  await sleep(1200);

  for (let h = 1; h <= 6; h++) {
    const awake = S.players.filter(p => p.die === h);
    S.night = { hour: h, awake: awake.map(p => p.id), done: new Set(), peeked: {}, phase: 'calling' };
    render();
    if (!await narrate(LINES.hour(h), id)) return;
    const th = awake.find(p => p.role === 'thief');
    if (th) S.cheeseHour = h;
    if (awake.length) {
      noteAwake(awake, h);
      S.night.phase = 'awake';
      render();
      if (!await waitUntil(() => S.night.awake.every(i => S.night.done.has(i)), AWAKE_TIMEOUT, id)) return;
    } else {
      // ไม่มีใครตื่น: รอเท่า ๆ กับมีคนตื่น เพื่อไม่ให้รู้จากเวลา
      S.night.phase = 'fake';
      render();
      await sleep(4000 + Math.random() * 3000);
    }
    S.night.phase = 'sleep';
    render();
    if (!await narrate(LINES.hourSleep, id)) return;
    await sleep(900);
  }

  const n = accompliceCount(S.players.length);
  if (n > 0) {
    S.night = { hour: 0, awake: [thief().id], done: new Set(), peeked: {}, phase: 'thief', count: n };
    render();
    if (!await narrate(LINES.thiefWake, id)) return;
    if (!await waitUntil(() => S.night.done.size > 0, AWAKE_TIMEOUT, id)) return;
    S.night.phase = 'sleep';
    render();
    if (!await narrate(LINES.thiefSleep, id)) return;
    await sleep(900);
  }
  startDay(id);
}

/** จดสิ่งที่คนที่ตื่นในตีนี้เห็น (เก็บไว้ในโน้ตของแต่ละคน) */
function noteAwake(awake, h) {
  const th = awake.find(p => p.role === 'thief');
  for (const p of awake) {
    const others = awake.filter(o => o !== p).map(o => esc(o.name));
    if (p.role === 'thief') {
      p.notes.push(`ตี ${h}: คุณขโมยชีส${others.length ? ` — แต่ <b>${others.join(', ')}</b> เห็นคุณ!` : ' โดยไม่มีใครเห็น'}`);
    } else if (th) {
      p.notes.push(`ตี ${h}: เห็น <b>${esc(th.name)}</b> ขโมยชีส!`);
    } else {
      const cheese = S.cheeseHour ? 'ชีสหายไปแล้ว' : 'ชีสยังอยู่';
      p.notes.push(`ตี ${h}: ตื่น${others.length ? `พร้อม <b>${others.join(', ')}</b>` : 'คนเดียว'} · ${cheese}`);
    }
  }
}

function peek(p, targetId) {
  const N = S.night;
  const t = byId(targetId);
  if (!t || t === p || N.peeked[p.id] || N.awake.length !== 1) return;
  N.peeked[p.id] = { name: t.name, die: t.die };
  p.notes.push(`แอบดูลูกเต๋าของ <b>${esc(t.name)}</b>: ได้เลข ${t.die}`);
  render();
}

function pickAccomplices(ids) {
  const N = S.night;
  const th = thief();
  const chosen = [...new Set(ids.map(Number))].map(byId).filter(p => p && p !== th);
  if (chosen.length !== N.count) return;
  chosen.forEach(p => {
    p.role = 'accomplice';
    p.notes.push('หัวขโมยเลือกคุณเป็น <b>ผู้สมรู้ร่วมคิด</b> — คุณชนะถ้าหัวขโมยรอด');
  });
  th.notes.push(`ผู้สมรู้ร่วมคิดของคุณ: <b>${chosen.map(p => esc(p.name)).join(', ')}</b>`);
  N.done.add(th.id);
  render();
}

// ---------- กลางวัน ----------
let talkTimer = null;

async function startDay(id) {
  S.screen = 'day';
  S.day = { phase: 'narrating', votes: {} };
  render();
  if (!await narrate(LINES.dawn, id)) return;
  await sleep(600);
  startTalk();
}

function startTalk() {
  const id = newRun();
  S.day = { phase: 'talk', left: S.settings.talkSec, paused: false, warned: false, votes: {} };
  render();
  narrate(LINES.talk(S.settings.talkSec), id);
  clearInterval(talkTimer);
  talkTimer = setInterval(() => {
    const D = S.day;
    if (S.screen !== 'day' || D.phase !== 'talk') return clearInterval(talkTimer);
    if (D.paused) return;
    D.left -= 1;
    const el = document.getElementById('timer');
    if (el) { el.textContent = fmt(Math.max(D.left, 0)); el.parentElement.classList.toggle('low', D.left <= 30); }
    if (D.left === 30 && !D.warned) { D.warned = true; narrate(LINES.talk30); }
    if (D.left <= 0) toVote(true);
  }, 1000);
}
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function toVote(timeUp) {
  clearInterval(talkTimer);
  const id = newRun();
  S.day = { phase: 'vote', votes: {} };
  render();
  narrate([...(timeUp ? LINES.talkEnd : []), ...LINES.vote], id);
}

function tally() {
  const t = {};
  for (const target of Object.values(S.day.votes)) if (target != null) t[target] = (t[target] || 0) + 1;
  return t;
}

async function resolveVote() {
  if (S.screen !== 'day' || S.day.phase !== 'vote') return;
  const t = tally();
  const max = Math.max(0, ...Object.values(t));
  const top = Object.keys(t).filter(k => t[k] === max).map(Number);
  const th = thief();
  // หัวขโมยได้คะแนนมากที่สุด (เสมอก็นับ) = จับได้
  S.winner = max > 0 && top.includes(th.id) ? 'mice' : 'thief';
  S.tally = Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${byId(Number(k)).name} ${v}`).join(', ') || 'ไม่มีใครถูกโหวต';
  const id = newRun();
  S.screen = 'end';
  render();
  await narrate(S.winner === 'mice' ? LINES.caught(th.name) : LINES.escaped(th.name), id);
}

// ---------- หน้าจอของแต่ละคน (ส่งให้เฉพาะเจ้าตัว) ----------
function actionKey() {
  const N = S.night || {}, D = S.day || {};
  return [S.screen, N.hour, N.phase, D.phase].join('|');
}

function viewFor(p) {
  if (S.screen === 'lobby') return { phase: 'lobby', name: p.name, count: S.joined.length };
  const r = ROLES[p.role];
  const v = {
    phase: S.screen, key: actionKey(), hour: S.night && S.night.hour,
    me: { name: p.name, roleName: r.name, icon: r.icon, team: r.team, teamName: r.teamName, desc: r.desc, die: p.die, notes: p.notes },
  };
  if (S.screen === 'reveal') v.ready = S.ready.has(p.id);
  const N = S.night;
  if (S.screen === 'night' && N.phase === 'awake' && N.awake.includes(p.id) && !N.done.has(p.id)) {
    const th = N.awake.map(byId).find(o => o.role === 'thief');
    v.action = {
      kind: 'awake',
      others: N.awake.filter(i => i !== p.id).map(i => byId(i).name),
      cheese: th ? 'stolen-now' : (S.cheeseHour ? 'gone' : 'here'),
      thiefName: th && th !== p ? th.name : '',
      alone: N.awake.length === 1,
      peeked: N.peeked[p.id] || null,
      peekCandidates: S.players.filter(o => o !== p).map(o => ({ id: o.id, name: o.name })),
    };
  }
  if (S.screen === 'night' && N.phase === 'thief' && p.role === 'thief' && !N.done.has(p.id)) {
    v.action = { kind: 'pick', count: N.count, candidates: S.players.filter(o => o !== p).map(o => ({ id: o.id, name: o.name })) };
  }
  if (S.screen === 'day') {
    v.dayPhase = S.day.phase;
    if (S.day.phase === 'vote') {
      v.action = { kind: 'vote', candidates: S.players.filter(o => o !== p).map(o => ({ id: o.id, name: o.name })),
        myVote: p.id in S.day.votes ? S.day.votes[p.id] : undefined };
    }
  }
  if (S.screen === 'end') {
    v.winner = S.winner;
    v.won = (ROLES[p.role].team === 'mice') === (S.winner === 'mice');
    v.tally = S.tally;
    v.players = S.players.map(o => ({ name: o.name, icon: ROLES[o.role].icon, roleName: ROLES[o.role].name, die: o.die }));
  }
  return v;
}

function publishViews() {
  if (!Net.active) return;
  const views = {};
  if (S.screen === 'lobby') S.joined.forEach(j => { if (!j.local) views[j.pid] = { phase: 'lobby', name: j.name, count: S.joined.length }; });
  else S.players.forEach(p => { if (p.pid !== HOST_PID) views[p.pid] = viewFor(p); });
  Net.publish(views);
}

/** รับการกดจากมือถือ (และจากหน้าจอของคนสร้างห้องเอง) */
function handleAction(pid, a) {
  const p = S.players.find(x => x.pid === pid);
  if (!p) return;
  if (S.screen === 'reveal') {
    if (a.type === 'ready') {
      S.ready.add(p.id);
      render();
      if (S.ready.size === S.players.length) runNight();
    }
    return;
  }
  if (a.key !== actionKey()) return;
  const N = S.night;
  if (S.screen === 'night' && N.phase === 'awake' && N.awake.includes(p.id)) {
    if (a.type === 'peek') return peek(p, Number(a.id));
    if (a.type === 'sleep') { N.done.add(p.id); return render(); }
  }
  if (S.screen === 'night' && N.phase === 'thief' && p.role === 'thief' && a.type === 'pick' && Array.isArray(a.ids)) {
    return pickAccomplices(a.ids);
  }
  if (S.screen === 'day' && S.day.phase === 'vote' && a.type === 'vote') {
    if (a.id !== null && !S.players.some(o => o.id === a.id && o !== p)) return;
    S.day.votes[p.id] = a.id;
    render();
    if (S.players.every(o => o.id in S.day.votes)) resolveVote();
  }
}

// ---------- หน้าจอเครื่องคนสร้างห้อง ----------
const meUI = createCheeseUI(action => setTimeout(() => handleAction(HOST_PID, action)));

function render() {
  document.body.dataset.phase = S.screen === 'night' ? 'night' : S.screen === 'day' ? 'day' : 'setup';
  if (S.screen === 'home') $app.innerHTML = homeView();
  else if (S.screen === 'lobby') $app.innerHTML = lobbyView();
  else {
    const me = S.players.find(p => p.pid === HOST_PID);
    const v = viewFor(me);
    const panel = '<section id="me" class="me-panel"></section>';
    $app.innerHTML = v.action ? panel + hostStrip() : hostStrip() + panel;
    meUI.mount(document.getElementById('me'));
    meUI.setView(v);
  }
  drawQr();
  publishViews();
}

/** ส่วนที่ทุกคนเห็นได้ (ไม่มีความลับ) */
function hostStrip() {
  if (S.screen === 'reveal') {
    return `<div class="stage tight"><h2>ดูบทบาทและลูกเต๋าของตัวเอง</h2>
      <div class="alive-bar">${S.players.map(p =>
        `<span class="chip ${S.ready.has(p.id) ? 'ready' : ''}">${S.ready.has(p.id) ? '✓' : '⏳'} ${esc(p.name)}</span>`).join('')}</div>
      <button class="btn-primary btn-block" data-act="night">🌙 เริ่มกลางคืน (${S.ready.size}/${S.players.length} พร้อม)</button></div>`;
  }
  if (S.screen === 'night') {
    const h = S.night && S.night.hour;
    return `<div class="phase-head">🌙 ${h ? `ตี ${h}` : 'กลางคืน'}</div><div class="ch-clock">${[1, 2, 3, 4, 5, 6].map(i =>
      `<span class="${i === h ? 'now' : i < h ? 'past' : ''}">${i}</span>`).join('')}</div>${subtitleBox()}`;
  }
  if (S.screen === 'day') {
    const D = S.day;
    if (D.phase === 'talk') {
      return `<div class="phase-head">☀️ ตอนเช้า</div>
        <div class="stage tight"><div class="timer-ring ${D.left <= 30 ? 'low' : ''}"><div class="timer" id="timer">${fmt(D.left)}</div><small>เวลาคุย</small></div>
        ${subtitleBox()}
        <div class="actions"><button data-act="pause">${D.paused ? '▶️ ต่อ' : '⏸ หยุด'}</button><button data-act="add">+30 วิ</button>
        <button class="btn-primary" data-act="vote">🗳️ ไปโหวตเลย</button></div></div>`;
    }
    if (D.phase === 'vote') {
      const t = tally();
      const voted = Object.keys(D.votes).length;
      return `<div class="phase-head">☀️ โหวต</div>${subtitleBox()}
        <div class="tally">${S.players.map(p => ({ p, n: t[p.id] || 0 })).sort((a, b) => b.n - a.n).map(({ p, n }) => `
          <div class="tally-row"><span class="t-name">${esc(p.name)}</span>
            <span class="t-bar"><i style="width:${S.players.length ? (n / S.players.length) * 100 : 0}%"></i></span><b>${n}</b></div>`).join('')}</div>
        <p class="muted" style="text-align:center">โหวตแล้ว ${voted}/${S.players.length} คน</p>
        <button class="btn-primary btn-block" data-act="resolve">⚖️ สรุปผลโหวต</button>`;
    }
    return `<div class="phase-head">☀️ ตอนเช้า</div>${subtitleBox()}`;
  }
  if (S.screen === 'end') {
    return `<div class="actions"><button class="btn-primary" data-act="again">🔁 เล่นอีกรอบ</button>
      <button data-act="to-lobby">⚙️ กลับห้อง</button></div>`;
  }
  return '';
}

function homeView() {
  return `
    <section class="hero">
      <div class="ch-logo">🧀</div>
      <h1>หนูขโมยชีส</h1>
      <p>มีหัวขโมยแอบซ่อนอยู่ในหมู่หนู ทุกคนตื่นตามเลขลูกเต๋า แล้วช่วยกันหาว่าใครขโมยชีสไป!</p>
    </section>
    <section class="panel home-card">
      <h3>🏠 สร้างห้องใหม่</h3>
      <input type="text" id="create-name" placeholder="ชื่อของคุณ" maxlength="20" value="${esc(S.name)}" autocomplete="nickname">
      ${S.error ? `<p class="warn">⚠️ ${esc(S.error)}</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="create">สร้างห้อง</button>
      <small class="muted">ได้เลขห้อง 6 หลักให้เพื่อนกรอก · เครื่องของคุณพากย์เสียง และคุณก็เล่นด้วย</small>
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
  const acc = accompliceCount(n);
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
      <strong>ตั้งค่า</strong>
      <div class="fw-settings">
        <label>ผู้สมรู้ร่วมคิด
          <select data-setting="accomplices">
            <option value="auto" ${S.settings.accomplices === 'auto' ? 'selected' : ''}>อัตโนมัติ (6 คนขึ้นไปมี 1 คน)</option>
            ${[0, 1, 2].map(k => `<option value="${k}" ${String(S.settings.accomplices) === String(k) ? 'selected' : ''}>${k} คน</option>`).join('')}
          </select></label>
        <label>เวลาคุยตอนเช้า
          <select data-setting="talkSec">${TALK_OPTIONS.map(s =>
            `<option value="${s}" ${S.settings.talkSec === s ? 'selected' : ''}>${minutesText(s)}</option>`).join('')}</select></label>
        <label>ภาษาพากย์
          <select data-setting="lang">${[['both', 'ไทย + English'], ['th', 'ไทย'], ['en', 'English']].map(([v, t]) =>
            `<option value="${v}" ${S.settings.lang === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <label class="host-play"><input type="checkbox" data-voiceall ${S.settings.voiceAll ? 'checked' : ''}>
        <span>🔊 พากย์เสียงบนทุกเครื่อง<small>ถ้านั่งด้วยกัน ปิดไว้ให้พากย์แค่เครื่องนี้จะได้ไม่เสียงซ้อน</small></span></label>
      <p class="muted small">ตอนนี้: หัวขโมย 1 · ผู้สมรู้ร่วมคิด ${acc} · หนู ${Math.max(n - 1, 0)}</p>
      <button class="small-btn btn-ghost" data-act="test-voice">🔊 ทดสอบเสียง</button>
    </section>
    <div class="start-bar">
      ${n < MIN_PLAYERS ? `<p class="warn">ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (ตอนนี้ ${n} คน)</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>🧀 เริ่มเกม · แจกบทบาท</button>
    </div>`;
}

function drawQr() {
  const el = document.getElementById('qr');
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text: el.dataset.url, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
}

Net.onLobby = () => { if (S.screen === 'lobby') render(); else publishViews(); };
Net.onAction = handleAction;

// ---------- ปุ่มต่าง ๆ ----------
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
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
      Voice.unlock();
      Net.start().then(render);
      render();
    },
    close() {
      if (S.joined.some(j => !j.local) && !confirm('ปิดห้องนี้? เพื่อนในห้องจะต้องเข้าห้องใหม่')) return;
      newRun();
      Net.stop();
      setInRoom(false);
      S.joined = [];
      S.screen = 'home';
      render();
    },
    kick() { if (confirm('ลบผู้เล่นคนนี้ออกจากห้อง?')) Net.kick(btn.dataset.pid); },
    'test-voice'() { Voice.unlock(); narrate(LINES.test); },
    start: startGame,
    again: startGame,
    night() { runNight(); },
    pause() { S.day.paused = !S.day.paused; render(); },
    add() { S.day.left += 30; if (S.day.left > 30) S.day.warned = false; render(); },
    vote() { toVote(false); },
    resolve: resolveVote,
    'to-lobby'() { newRun(); S.screen = 'lobby'; render(); },
  };
  ACTIONS[btn.dataset.act]?.();
});

document.addEventListener('change', e => {
  if ('voiceall' in e.target.dataset) {
    S.settings.voiceAll = e.target.checked;
    store.set('settings', S.settings);
    return;
  }
  const key = e.target.dataset.setting;
  if (!key) return;
  S.settings[key] = key === 'talkSec' ? Number(e.target.value) : e.target.value;
  store.set('settings', S.settings);
  if (S.screen === 'lobby') render();
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
  if (!['home', 'lobby', 'end'].includes(S.screen)) { e.preventDefault(); e.returnValue = ''; }
});

if (S.screen === 'lobby') { syncHostEntry(); Net.start().then(render); }
render();
