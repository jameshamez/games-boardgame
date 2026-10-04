'use strict';
// ต้องโหลดหลัง roles.js, lines.js และ voice/manifest.js

const MIN_PLAYERS = 5;
const HOST_PID = 'host';  // เจ้าห้องที่เล่นด้วยบนเครื่องนี้
const KILLERS = ['werewolf', 'wolfcub'];
const UNIQUE_MAX = 1;

// ---------- พื้นที่จัดเก็บ ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('werewolf.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('werewolf.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

// ---------- สถานะเกม ----------
const S = {
  screen: inRoom() ? 'setup' : 'home',   // home = หน้าเลือก สร้างห้อง / เข้าร่วม / เครื่องเดียว
  homeError: '',
  mode: store.get('mode', 'single'),   // single = เครื่องเดียว, multi = หลายเครื่อง
  joined: [],          // ผู้เล่นที่เข้าร่วมจากมือถือ [{pid, name, online, local?}]
  hostPlays: store.get('hostPlays', false),  // เจ้าห้องเล่นด้วย (ไม่มีจอกลาง)
  hostName: store.get('hostName', ''),
  ready: new Set(),    // ผู้เล่นที่ดูบทบาทบนมือถือแล้ว
  names: store.get('names', ['', '', '', '', '']),
  counts: sanitizeCounts(store.get('counts2', null)),
  settings: Object.assign(
    { voice: true, lang: 'both', rate: 1, voiceURI: '', talkSec: 180, revealOnDeath: true, firstNightKill: false },
    store.get('settings', {})),
  players: [],
  day: 0,
  reveal: { idx: 0, shown: false },
  night: null,
  dayState: null,
  g: null,              // สถานะพิเศษระหว่างเกม (คู่รัก ยาแม่มด ฯลฯ)
  pendingHunters: [],
  hunterReturn: null,
  winner: null,
  log: [],
  subtitle: '',
  subtitleEn: '',
  speaking: false,
};

/** อยู่ในห้องที่สร้างไว้ในแท็บนี้หรือไม่ (รีเฟรชหน้าแล้วกลับเข้าห้องเดิม) */
function inRoom() {
  try { return sessionStorage.getItem('werewolf.inRoom') === '1'; } catch { return false; }
}
function setInRoom(on) {
  try {
    if (on) sessionStorage.setItem('werewolf.inRoom', '1');
    else { sessionStorage.removeItem('werewolf.inRoom'); sessionStorage.removeItem('werewolf.cloudHost'); }
  } catch { /* ignore */ }
}

function sanitizeCounts(c) {
  if (!c) return null;
  const out = {};
  for (const [r, n] of Object.entries(c)) if (ROLES[r] && r !== 'villager' && n > 0) out[r] = n;
  return out;
}

// ---------- เสียงพากย์ ----------
const Voice = {
  voices: [],
  audio: new Audio(),
  server: false,        // มี server.py ที่สร้างเสียงชื่อผู้เล่นได้หรือไม่
  speechWorks: false,   // เสียงของเบราว์เซอร์เคยพูดได้จริง
  speechBroken: false,  // เสียงของเบราว์เซอร์ค้าง ไม่ยอมพูด
  current: null,

  load() {
    if (!('speechSynthesis' in window)) return;
    Voice.voices = speechSynthesis.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('th'));
  },
  pick() {
    return Voice.voices.find(v => v.voiceURI === S.settings.voiceURI) || Voice.voices[0] || null;
  },
  async checkServer() {
    try { Voice.server = (await fetch('/tts?text=')).status === 204; } catch { Voice.server = false; }
  },

  /** เล่นไฟล์เสียง คืน true ถ้าเล่นได้ (หรือถูกสั่งหยุด) */
  playUrl(url) {
    return new Promise(resolve => {
      const a = Voice.audio;
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        a.onended = a.onerror = a.onpause = null;
        resolve(ok);
      };
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      a.onpause = () => finish(true);
      a.src = url;
      a.playbackRate = S.settings.rate;
      a.play().catch(() => finish(false));
      setTimeout(() => finish(true), 20000);
    });
  },

  /** พูดข้อความหนึ่งชิ้น: ไฟล์ที่อัดไว้ › เซิร์ฟเวอร์สร้างเสียง › เสียงเบราว์เซอร์ › แสดงข้อความอย่างเดียว */
  async speak(text) {
    const fallbackMs = Math.min(900 + text.length * 70, 3500);
    if (!S.settings.voice) return sleep(fallbackMs);
    const file = typeof VOICE_MANIFEST !== 'undefined' && VOICE_MANIFEST[text];
    if (file && await Voice.playUrl('voice/' + file)) return;
    if (Voice.server && await Voice.playUrl('/tts?text=' + encodeURIComponent(text))) return;
    return Voice.speakBrowser(text, fallbackMs);
  },

  speakBrowser(text, fallbackMs) {
    return new Promise(resolve => {
      if (Voice.speechBroken || !('speechSynthesis' in window)) return setTimeout(resolve, fallbackMs);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'th-TH';
      const v = Voice.pick();
      if (v) u.voice = v;
      u.rate = S.settings.rate;
      u.onstart = () => { Voice.speechWorks = true; };
      u.onend = finish;
      u.onerror = finish;
      Voice.current = u;
      // Chrome มักทิ้งประโยคที่สั่งพูดทันทีหลัง cancel() จึงเว้นจังหวะเล็กน้อย
      setTimeout(() => {
        if (done) return;
        speechSynthesis.resume();
        speechSynthesis.speak(u);
        setTimeout(() => {
          if (!done && !Voice.speechWorks) {
            Voice.speechBroken = true;
            speechSynthesis.cancel();
            showVoiceWarning();
            setTimeout(finish, fallbackMs);
          }
        }, 3000);
      }, 80);
      setTimeout(finish, fallbackMs * 3 / S.settings.rate + 1500);
    });
  },

  stop() {
    Voice.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },

  unlock() {
    // Safari/iOS ต้องเริ่มเล่นเสียงจากการแตะของผู้ใช้หนึ่งครั้งก่อน
    const a = Voice.audio;
    const first = typeof VOICE_MANIFEST !== 'undefined' && Object.values(VOICE_MANIFEST)[0];
    if (first && a.paused) {
      a.muted = true;
      a.src = 'voice/' + first;
      a.play().then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
    }
  },
};
Voice.checkServer();
if ('speechSynthesis' in window) {
  Voice.load();
  speechSynthesis.addEventListener?.('voiceschanged', Voice.load);
}

function showVoiceWarning() {
  const el = document.getElementById('voice-warning');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `🔇 พากย์ชื่อผู้เล่นไม่ได้ จะแสดงชื่อเป็นข้อความแทน (บทพากย์อื่นยังมีเสียงปกติ)<br>
    <small>เบราว์เซอร์นี้ไม่มีเสียงภาษาไทย — ลองเปิดด้วย Chrome หรือ Safari หรือเปิดผ่าน python3 server.py บน Mac</small>`;
}

let runId = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function newRun() { runId++; Voice.stop(); return runId; }

/** พูดทีละบรรทัดพร้อมแสดงซับไตเติล (ไทย / อังกฤษ / ไทยแล้วตามด้วยอังกฤษ) คืน false ถ้าถูกขัดจังหวะ */
async function narrate(lines, id = newRun()) {
  const mode = S.settings.lang;
  for (const line of lines) {
    const th = Array.isArray(line) ? line : [line];
    const en = englishLine(line);
    if (mode === 'en') setSubtitle(en.join(' '), true, '');
    else setSubtitle(th.join(' '), true, mode === 'both' ? en.join(' ') : '');
    const parts = mode === 'th' ? th : mode === 'en' ? en : [...th, ...en];
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

function setSubtitle(text, speaking, en = '') {
  S.subtitle = text;
  S.subtitleEn = en;
  S.speaking = speaking;
  const el = document.getElementById('subtitle');
  if (el) {
    el.innerHTML = subtitleInner();
    el.classList.toggle('speaking', speaking);
  }
}

function subtitleInner() {
  return `<span class="sub-th">${esc(S.subtitle)}</span>${S.subtitleEn ? `<span class="sub-en">${esc(S.subtitleEn)}</span>` : ''}`;
}

// ---------- ตัวช่วย ----------
const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alive = () => S.players.filter(p => p.alive);
const byId = id => S.players.find(p => p.id === id);
const inGame = role => S.players.some(p => p.origRole === role);
const aliveRole = role => alive().filter(p => p.role === role);
const isKiller = p => KILLERS.includes(p.role);
const seenAsWolf = p => isKiller(p) || p.role === 'lycan';
const teamOf = p => ROLES[p.role].team;
const validNames = () => (S.mode === 'multi' ? S.joined.map(j => j.name.trim()) : S.names.map(n => n.trim()).filter(Boolean));
const names = list => list.map(p => esc(p.name)).join(', ');

function suggestWolves(n) { return n <= 6 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : n <= 17 ? 4 : 5; }

function applyPreset(preset) {
  const n = Math.max(validNames().length, MIN_PLAYERS);
  const c = Object.assign({}, preset.roles);
  const wolves = suggestWolves(n) - (c.wolfcub || 0);
  c.werewolf = Math.max(1, wolves);
  S.counts = c;
}

function specialCount() { return Object.values(S.counts).reduce((a, b) => a + b, 0); }
function villagerCount() { return validNames().length - specialCount(); }
function balance() {
  let sum = Math.max(villagerCount(), 0) * ROLES.villager.points;
  for (const [r, n] of Object.entries(S.counts)) sum += ROLES[r].points * n;
  return sum;
}
function maxFor(role) { return ROLES[role].max || UNIQUE_MAX; }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function addLog(text) {
  S.log.push(S.screen === 'night' ? `🌙 คืนที่ ${S.day}: ${text}` : `☀️ วันที่ ${S.day}: ${text}`);
}
function formatTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ผู้เล่นที่ยังมีชีวิตซึ่งนั่งติดกับ p ทางซ้ายและขวา (เรียงตามลำดับรายชื่อ = ลำดับที่นั่ง) */
function neighbors(p) {
  const ring = S.players.filter(o => o.alive || o.id === p.id);
  if (ring.length < 2) return [];
  const i = ring.findIndex(o => o.id === p.id);
  const left = ring[(i - 1 + ring.length) % ring.length];
  const right = ring[(i + 1) % ring.length];
  return [...new Set([left, right])].filter(o => o.id !== p.id);
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { wakeLock = null; if (S.screen !== 'setup') keepAwake(); }
});

// ---------- ส่วนแสดงผลที่ใช้บ่อย ----------
function subtitleBox() {
  return `<div id="subtitle" class="subtitle ${S.speaking ? 'speaking' : ''}">${subtitleInner()}</div>`;
}

function aliveBar() {
  const g = S.g;
  return `<div class="alive-bar">${S.players.map(p => {
    const marks = [];
    if (g && p.id === g.banished) marks.push('🧿');
    if (g && p.id === g.silenced) marks.push('🤐');
    if (p.princeRevealed) marks.push('🤴');
    return `<span class="chip ${p.alive ? '' : 'dead'}">${p.alive ? '' : '💀 '}${esc(p.name)}${marks.length ? ' ' + marks.join('') : ''}</span>`;
  }).join('')}</div>`;
}

function playerGrid(candidates, selected, tag = () => '') {
  return `<div class="players">${candidates.map(p => `
    <button class="player ${selected.includes(p.id) ? 'selected' : ''}" data-act="pick" data-id="${p.id}">
      <span class="pname">${esc(p.name)}</span>${tag(p)}
    </button>`).join('')}</div>`;
}

function roleBadge(role) {
  const r = ROLES[role];
  return `<span class="role-badge ${r.team}">${r.icon} ${r.name}</span>`;
}

// ---------- หน้าจอ ----------
function render() {
  document.body.dataset.phase = S.screen === 'night' ? 'night' : (S.screen === 'day' ? 'day' : (S.screen === 'end' ? 'end' : 'setup'));
  const hp = hostPlayer();
  if (hp && ['reveal', 'night', 'day'].includes(S.screen)) {
    // เจ้าห้องเล่นด้วย: แสดงหน้าจอผู้เล่นของตัวเอง + ส่วนควบคุมที่ไม่เปิดเผยความลับ
    const v = viewFor(hp);
    const panel = '<section id="me-panel" class="me-panel"></section>';
    $app.innerHTML = v.action ? panel + hostStrip() : hostStrip() + panel;
    meUI.mount(document.getElementById('me-panel'));
    meUI.setView(v);
  } else {
    $app.innerHTML = VIEWS[S.screen]();
  }
  drawQr();
  publishViews();
}

const meUI = createPlayerUI(action => setTimeout(() => handlePlayerAction(HOST_PID, action)));

function hostPlayer() {
  return S.mode === 'multi' && S.hostPlays ? S.players.find(p => p.pid === HOST_PID) : null;
}

/** ส่วนของจอเจ้าห้องที่ทุกคนเห็นได้ (ไม่มีข้อมูลลับ) */
function hostStrip() {
  if (S.screen === 'night') {
    return `<div class="phase-head">🌙 คืนที่ ${S.day}</div><div class="stage tight">${subtitleBox()}</div>`;
  }
  if (S.screen === 'day') return VIEWS.day();
  if (S.screen === 'reveal') return revealMulti();
  return '';
}

/** เพิ่ม/ลบ เจ้าห้องออกจากรายชื่อผู้เล่นตามตัวเลือก “ฉันเล่นด้วย” */
function syncHostEntry() {
  const has = S.joined.find(j => j.pid === HOST_PID);
  if (S.mode === 'multi' && S.hostPlays) {
    if (has) has.name = S.hostName;
    else S.joined.unshift({ pid: HOST_PID, name: S.hostName, online: true, local: true });
  } else if (has) {
    S.joined = S.joined.filter(j => j.pid !== HOST_PID);
  }
}

function setupProblem() {
  const n = validNames().length;
  const killers = KILLERS.reduce((a, r) => a + (S.counts[r] || 0), 0);
  if (S.mode === 'multi' && validNames().some(x => !x)) return 'ใส่ชื่อของคุณก่อน (ช่อง “ฉันเล่นด้วย”)';
  if (n < MIN_PLAYERS) return `ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (ตอนนี้ ${n} คน)`;
  if (new Set(validNames()).size !== n) return 'มีชื่อผู้เล่นซ้ำกัน';
  if (villagerCount() < 0) return `บทบาทพิเศษ (${specialCount()}) มากกว่าจำนวนผู้เล่น (${n})`;
  if (killers < 1) return 'ต้องมีมนุษย์หมาป่าหรือลูกหมาป่าอย่างน้อย 1 ตัว';
  if (killers >= n - killers) return 'หมาป่ามากเกินไป (ต้องน้อยกว่าฝ่ายอื่น)';
  if (S.counts.mason === 1) return 'ภราดรแห่งเมสันต้องมีอย่างน้อย 2 คน';
  if (S.counts.apprentice && !S.counts.seer) return 'ศิษย์เทพพยากรณ์ต้องมีเทพพยากรณ์อยู่ในเกมด้วย';
  return '';
}

function setupDynamic() {
  const n = validNames().length;
  const vill = villagerCount();
  const bal = balance();
  const problem = setupProblem();
  const pct = Math.max(0, Math.min(100, 50 + bal * 3));
  const balText = Math.abs(bal) <= 2 ? 'สมดุลดี' : bal > 0 ? 'ชาวบ้านได้เปรียบ' : 'หมาป่าได้เปรียบ';

  const tile = role => {
    const r = ROLES[role];
    const c = role === 'villager' ? Math.max(vill, 0) : (S.counts[role] || 0);
    const multi = role !== 'villager' && maxFor(role) > 1;
    return `
      <div class="role-tile ${r.team} ${c ? 'on' : ''}" ${role !== 'villager' && !multi ? `data-act="toggle-role" data-role="${role}"` : ''}>
        <div class="rt-head">
          <span class="rt-icon">${r.icon}</span>
          <span class="rt-points ${r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : ''}">${r.points > 0 ? '+' : ''}${r.points}</span>
        </div>
        <div class="rt-name">${r.name}</div>
        <div class="rt-en">${r.en}</div>
        <div class="rt-desc">${r.desc}</div>
        ${role === 'villager' ? `<div class="rt-count">× ${c} <small>(อัตโนมัติ)</small></div>`
          : multi ? `<div class="stepper">
              <button data-act="count" data-role="${role}" data-d="-1" aria-label="ลด">−</button>
              <b>${c}</b>
              <button data-act="count" data-role="${role}" data-d="1" aria-label="เพิ่ม">+</button></div>`
          : `<div class="rt-check">${c ? '✓ ใช้' : 'แตะเพื่อใช้'}</div>`}
      </div>`;
  };
  const section = team => {
    const list = Object.keys(ROLES).filter(r => ROLES[r].team === team);
    return `<h3 class="team-head ${team}">${TEAMS[team].icon} ${TEAMS[team].name}</h3>
      <div class="role-grid">${list.map(tile).join('')}</div>`;
  };

  return `
    <section class="panel">
      <div class="row"><strong class="grow">ชุดบทบาทแนะนำ</strong></div>
      <div class="presets">${PRESETS.map((p, i) => `
        <button class="preset" data-act="preset" data-i="${i}"><b>${p.name}</b><small>${p.desc}</small></button>`).join('')}
      </div>
      <div class="balance">
        <div class="bal-row"><span>🐺 หมาป่า</span><strong>แต้มสมดุล ${bal > 0 ? '+' : ''}${bal} · ${balText}</strong><span>ชาวบ้าน 🏡</span></div>
        <div class="bal-track"><div class="bal-zero"></div><div class="bal-dot" style="left:${pct}%"></div></div>
        <small class="muted">ผู้เล่น ${n} คน · บทบาทพิเศษ ${specialCount()} · ชาวบ้าน ${Math.max(vill, 0)} — ยิ่งใกล้ 0 ยิ่งสูสี</small>
      </div>
    </section>

    ${section('wolf')}
    ${section('village')}
    ${section('solo')}

    <div class="start-bar">
      ${problem ? `<p class="warn">⚠️ ${problem}</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="start" ${problem ? 'disabled' : ''}>🌕 เริ่มเกม · แจกบทบาท</button>
    </div>`;
}

function refreshSetup() {
  const dyn = document.getElementById('setup-dyn');
  if (dyn) dyn.innerHTML = setupDynamic();
  const pc = document.getElementById('player-count');
  if (pc) pc.textContent = `ผู้เล่น (${validNames().length} คน)`;
}

function namesPanel() {
  return `
      <section class="panel">
        <div class="row"><strong class="grow" id="player-count">ผู้เล่น (${validNames().length} คน)</strong>
          <button data-act="add-player">+ เพิ่ม</button></div>
        <p class="muted small">เรียงชื่อตามที่นั่งรอบวง (ใช้กับนักสืบและมือระเบิด)</p>
        <div class="name-list">
          ${S.names.map((name, i) => `
            <div class="row name-row">
              <span class="seat">${i + 1}</span>
              <input type="text" class="grow" placeholder="ชื่อผู้เล่น" value="${esc(name)}"
                data-name="${i}" maxlength="20" autocomplete="off" enterkeyhint="next">
              <button class="icon-btn" data-act="remove-player" data-i="${i}" aria-label="ลบ">✕</button>
            </div>`).join('')}
        </div>
      </section>`;
}

const VIEWS = {
  home() {
    return `
      <section class="hero">
        <div class="hero-moon"></div>
        <h1>มนุษย์หมาป่า</h1>
        <p>ทุกคนเล่นบนมือถือตัวเอง มีเสียงพากย์ภาษาไทยพาเล่นกลางวัน–กลางคืน — ไม่ต้องมีคนคุมเกม</p>
      </section>

      <section class="panel home-card">
        <h3>🏠 สร้างห้องใหม่</h3>
        <input type="text" id="create-name" placeholder="ชื่อของคุณ" maxlength="20" value="${esc(S.hostName)}" autocomplete="nickname">
        ${S.homeError ? `<p class="warn">⚠️ ${esc(S.homeError)}</p>` : ''}
        <button class="btn-primary btn-block btn-big" data-act="create-room">สร้างห้อง</button>
        <small class="muted">ได้เลขห้อง 6 หลักให้เพื่อนกรอก · เครื่องของคุณจะเป็นคนพากย์เสียง และคุณก็เล่นด้วย</small>
      </section>

      <section class="panel home-card">
        <h3>🔑 เข้าร่วมห้อง</h3>
        <form id="join-room" class="stack">
          <input type="text" name="code" maxlength="6" placeholder="เลขห้อง" autocapitalize="characters" autocomplete="off">
          <input type="text" name="name" placeholder="ชื่อของคุณ" maxlength="20" autocomplete="nickname">
          <button class="btn-block btn-big" type="submit">เข้าร่วม</button>
        </form>
      </section>

      <button class="btn-ghost btn-block small-btn" data-act="single">📱 หรือเล่นเครื่องเดียว (ส่งเครื่องเวียนกันในวง)</button>`;
  },

  setup() {
    if (!S.counts) applyPreset(PRESETS[0]);
    return `
      <button class="btn-ghost small-btn back-home" data-act="go-home">← ${S.mode === 'multi' ? 'ปิดห้อง' : 'กลับ'}</button>
      ${S.mode === 'multi' ? lobbyPanel() : namesPanel()}
      <div id="setup-dyn">${setupDynamic()}</div>`;
  },

  reveal() {
    if (S.mode === 'multi') return revealMulti();
    const p = S.players[S.reveal.idx];
    const r = ROLES[p.role];
    const extra = [];
    if (KILLERS.includes(p.role)) {
      const pack = S.players.filter(o => isKiller(o) && o.id !== p.id);
      if (pack.length) extra.push(`<strong>ฝูงของคุณ:</strong> ${names(pack)}`);
    }
    return `
      <div class="stage">
        <p class="muted">แจกบทบาท ${S.reveal.idx + 1} / ${S.players.length}</p>
        <h2>${S.reveal.shown ? esc(p.name) : `ส่งเครื่องให้ “${esc(p.name)}”`}</h2>
        <div class="flip ${S.reveal.shown ? 'flipped' : ''}" data-act="${S.reveal.shown ? '' : 'show-role'}">
          <div class="flip-inner">
            <div class="card-face card-back">
              <div class="cb-moon">🌕</div>
              <div class="cb-title">WEREWOLF</div>
              <div class="cb-hint">แตะเพื่อเปิดดูบทบาท<br><small>อย่าให้คนอื่นเห็น</small></div>
            </div>
            <div class="card-face card-front ${r.team}">
              <div class="cf-team">${TEAMS[r.team].icon} ${TEAMS[r.team].name}</div>
              <div class="cf-icon">${r.icon}</div>
              <div class="cf-name">${r.name}</div>
              <div class="cf-en">${r.en}</div>
              <p class="cf-desc">${r.desc}</p>
              ${extra.map(e => `<p class="cf-extra">${e}</p>`).join('')}
            </div>
          </div>
        </div>
        ${S.reveal.shown
          ? '<button class="btn-primary btn-block btn-big" data-act="hide-role">จำได้แล้ว · ส่งต่อ</button>'
          : `<button class="btn-primary btn-block btn-big" data-act="show-role">ฉันคือ ${esc(p.name)} · เปิดดู</button>`}
      </div>`;
  },

  night() {
    const N = S.night;
    const step = N.step;
    const head = `<div class="phase-head">🌙 คืนที่ ${S.day}</div>`;
    if (!step || N.view === 'sleeping') {
      return `${head}<div class="stage"><div class="big-icon float">🌙</div>${subtitleBox()}
        <p class="muted">ทุกคนหลับตา…</p></div>`;
    }
    const icon = step.icon || ROLES[step.role].icon;
    if (N.view === 'fake') {
      return `${head}<div class="stage"><div class="big-icon float">${icon}</div>${subtitleBox()}
        <p class="muted">รอสักครู่…</p></div>`;
    }
    if (remoteActing()) return `${head}${waitingScreen(icon, 'รอผู้เล่นตัดสินใจบนมือถือ…')}`;
    if (N.view === 'result') {
      const res = N.result;
      return `${head}<div class="stage"><div class="big-icon">${res.icon || icon}</div>
        <h2>${res.title}</h2>
        <div class="result ${res.tone || ''}">${res.text}</div>
        <button class="btn-primary btn-block btn-big" data-act="night-next">รับทราบ</button></div>`;
    }
    const ph = N.phases[N.phaseIdx];
    const top = `${head}<div class="stage tight"><div class="mid-icon">${icon}</div><h2>${ph.title}</h2>${subtitleBox()}
      ${ph.hint ? `<p class="muted">${ph.hint}</p>` : ''}</div>`;
    if (ph.type === 'info') {
      return `${top}<div class="info-card">${ph.html}</div>
        <button class="btn-primary btn-block btn-big" data-act="night-next">${ph.button || 'ต่อไป'}</button>`;
    }
    if (ph.type === 'choice') {
      return `${top}${ph.html ? `<div class="info-card">${ph.html}</div>` : ''}
        <div class="actions">${ph.options.map((o, i) =>
          `<button class="${o.primary ? 'btn-primary' : ''}" data-act="night-choice" data-i="${i}">${o.label}</button>`).join('')}</div>`;
    }
    // pick
    const ready = N.pick.length === ph.count;
    return `${top}${playerGrid(ph.candidates, N.pick, ph.tag)}
      <div class="actions">
        ${ph.optional ? `<button data-act="night-skip">${ph.skipLabel || 'ไม่ใช้'}</button>` : ''}
        <button class="btn-primary" data-act="night-confirm" ${ready ? '' : 'disabled'}>
          ${ph.count > 1 ? `ยืนยัน (${N.pick.length}/${ph.count})` : 'ยืนยัน'}</button>
      </div>`;
  },

  day() {
    const D = S.dayState;
    const head = `<div class="phase-head">☀️ วันที่ ${S.day}</div>${aliveBar()}`;
    if (D.phase === 'narrating') {
      return `${head}<div class="stage"><div class="big-icon float">${D.icon || '🌅'}</div>${subtitleBox()}</div>`;
    }
    if (D.phase === 'hunter' && S.mode === 'multi' && !D.hostOverride) {
      return `${head}${waitingScreen('🏹', `รอ ${esc(byId(S.pendingHunters[0]).name)} เลือกเป้าหมายบนมือถือ…`)}`;
    }
    if (D.phase === 'vote' && S.mode === 'multi' && !D.hostOverride) return `${head}${voteTallyView()}`;
    if (D.phase === 'hunter') {
      const h = byId(S.pendingHunters[0]);
      return `${head}<div class="stage tight"><div class="mid-icon">🏹</div>
        <h2>${esc(h.name)} จะยิงใคร?</h2>${subtitleBox()}</div>
        ${playerGrid(alive(), D.pick)}
        <div class="actions">
          <button data-act="hunter-skip">ไม่ยิง</button>
          <button class="btn-primary" data-act="hunter-confirm" ${D.pick.length ? '' : 'disabled'}>🏹 ยิง</button>
        </div>`;
    }
    if (D.phase === 'talk') {
      const notes = [];
      if (S.g.banished != null) notes.push(`🧿 ${esc(byId(S.g.banished).name)} ถูกสาปออกจากหมู่บ้าน`);
      if (S.g.silenced != null) notes.push(`🤐 ${esc(byId(S.g.silenced).name)} ห้ามพูด`);
      if (S.g.doubleVote) notes.push('😈 วันนี้ประหาร 2 รอบ');
      return `${head}<div class="stage"><div class="timer-ring ${D.left <= 30 ? 'low' : ''}">
          <div class="timer" id="timer">${formatTime(D.left)}</div><small>เวลาอภิปราย</small></div>
        ${subtitleBox()}
        ${notes.length ? `<div class="notes">${notes.map(n => `<span class="chip">${n}</span>`).join('')}</div>` : ''}
        <div class="actions">
          <button data-act="timer-toggle">${D.paused ? '▶️ ต่อ' : '⏸ หยุด'}</button>
          <button data-act="timer-add">+30 วิ</button>
        </div>
        <button class="btn-primary btn-block btn-big" style="margin-top:10px" data-act="to-vote">🗳️ ไปลงคะแนนเลย</button></div>`;
    }
    if (D.phase === 'vote') {
      const candidates = alive().filter(p => p.id !== S.g.banished);
      return `${head}<div class="stage tight"><div class="mid-icon">🗳️</div>
        <h2>${D.round === 2 ? 'รอบที่ 2: ' : ''}ใครถูกโหวตมากที่สุด?</h2>${subtitleBox()}
        <p class="muted">ต้องได้เสียงเกินครึ่งจึงประหาร${aliveRole('mayor').length ? ' · นายกเทศมนตรีนับ 2 เสียง' : ''}</p></div>
        ${playerGrid(candidates, D.pick)}
        <div class="actions">
          <button data-act="no-execute">ไม่ประหาร</button>
          <button class="btn-primary" data-act="execute" ${D.pick.length ? '' : 'disabled'}>⚖️ ประหาร</button>
        </div>`;
    }
    return '';
  },

  end() {
    const w = S.winner;
    const title = w === 'wolf' ? 'ฝ่ายมนุษย์หมาป่าชนะ!' : w === 'tanner' ? 'ยาจกชนะ!' : 'ฝ่ายชาวบ้านชนะ!';
    const icon = w === 'wolf' ? '🐺' : w === 'tanner' ? '🥀' : '🏡';
    const won = p => (w === 'tanner' ? p.role === 'tanner' : teamOf(p) === w);
    return `
      <div class="stage">
        <div class="big-icon trophy">${icon}</div>
        <h2 class="win-title ${w}">${title}</h2>
        ${subtitleBox()}
      </div>
      <section class="panel">
        <strong>บทบาทของทุกคน</strong>
        <div class="reveal-list">${S.players.map(p => `
          <div class="rl-item ${p.alive ? '' : 'dead'} ${won(p) ? 'won' : ''}">
            <span class="rl-icon">${ROLES[p.role].icon}</span>
            <span class="rl-name">${esc(p.name)}${won(p) ? ' 🏆' : ''}</span>
            <span class="rl-role">${ROLES[p.role].name}${p.origRole !== p.role ? ` <small>(เดิม: ${ROLES[p.origRole].name})</small>` : ''}</span>
            <span>${p.alive ? 'รอด' : '💀'}</span>
          </div>`).join('')}</div>
      </section>
      <section class="panel"><strong>บันทึกเกม</strong><ol class="log">${S.log.map(l => `<li>${esc(l)}</li>`).join('')}</ol></section>
      <div class="actions">
        <button data-act="to-setup">แก้ไขผู้เล่น / บทบาท</button>
        <button class="btn-primary" data-act="replay">🔁 เล่นอีกรอบ</button>
      </div>`;
  },
};

// ---------- ตั้งค่า ----------
function renderSettings() {
  const el = document.getElementById('settings');
  const st = S.settings;
  el.innerHTML = `<div class="panel">
    <label>เสียงพากย์ <input type="checkbox" data-setting="voice" ${st.voice ? 'checked' : ''}></label>
    <label>ภาษาพากย์
      <select data-setting="lang">${[['both', 'ไทย + English'], ['th', 'ไทย'], ['en', 'English']].map(([v, t]) =>
        `<option value="${v}" ${st.lang === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>ความเร็วเสียง
      <select data-setting="rate">${[0.8, 0.9, 1, 1.1, 1.25].map(r =>
        `<option value="${r}" ${st.rate === r ? 'selected' : ''}>${r}×</option>`).join('')}</select></label>
    <label>เวลาอภิปราย
      <select data-setting="talkSec">${TALK_OPTIONS.map(s =>
        `<option value="${s}" ${st.talkSec === s ? 'selected' : ''}>${minutesText(s)}</option>`).join('')}</select></label>
    <label>หมาป่าฆ่าได้ตั้งแต่คืนแรก <input type="checkbox" data-setting="firstNightKill" ${st.firstNightKill ? 'checked' : ''}></label>
    <label>เปิดเผยบทบาทเมื่อตาย <input type="checkbox" data-setting="revealOnDeath" ${st.revealOnDeath ? 'checked' : ''}></label>
    <div class="actions"><button data-act="test-voice">🔊 ทดสอบเสียง</button>
      ${S.screen !== 'setup' ? '<button data-act="quit">จบเกมนี้</button>' : ''}</div>
  </div>`;
}

document.getElementById('settings').addEventListener('change', e => {
  const key = e.target.dataset.setting;
  if (!key) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : key === 'lang' ? e.target.value : Number(e.target.value);
  S.settings[key] = v;
  store.set('settings', S.settings);
  if (key === 'voice' && !v) Voice.stop();
  if (key === 'voice' && v) Voice.speechBroken = false;
});

// ---------- เริ่มเกม / แจกบทบาท ----------
function startGame() {
  const list = validNames();
  store.set('names', S.names);
  store.set('counts2', S.counts);
  const pool = [];
  for (const [r, n] of Object.entries(S.counts)) for (let i = 0; i < n; i++) pool.push(r);
  while (pool.length < list.length) pool.push('villager');
  const roles = shuffle(pool);
  S.players = list.map((name, id) => ({ id, name, pid: S.mode === 'multi' ? S.joined[id].pid : null,
    role: roles[id], origRole: roles[id], alive: true }));
  S.ready = new Set();
  S.g = {
    lovers: null, lastGuard: null, used: {}, potions: { save: true, kill: true },
    cubRage: false, wolvesSick: false, toughPending: null,
    banished: null, silenced: null, doubleVote: false, cursedTold: false,
  };
  S.day = 0;
  S.pendingHunters = [];
  S.winner = null;
  S.log = [];
  S.reveal = { idx: 0, shown: false };
  S.screen = 'reveal';
  Voice.unlock();
  keepAwake();
  render();
}

// ---------- ขั้นตอนกลางคืน ----------
// แต่ละขั้น: role (บทที่ถูกเรียก), when() (เรียกคืนนี้ไหม), actors() (คนที่ลืมตาจริง),
// wake()/sleep() (บทพากย์), phases() (หน้าจอที่ต้องทำ)
const pickPhase = (o) => Object.assign({ type: 'pick', count: 1, optional: false }, o);
const onceUsed = key => S.g.used[key];
const usedInfo = () => [{ type: 'info', title: 'ใช้พลังไปแล้ว', html: 'คุณใช้พลังนี้ไปแล้วในเกมนี้', button: 'หลับตา' }];

const NIGHT_STEPS = [
  { role: 'cupid', when: () => S.day === 1,
    phases: () => [pickPhase({ title: 'เลือกคู่รัก 2 คน', count: 2, candidates: alive(),
      onDone(ids) {
        S.g.lovers = ids;
        addLog(`กามเทพจับคู่ ${ids.map(i => byId(i).name).join(' ❤ ')}`);
        return { icon: '💘', title: 'จับคู่แล้ว', tone: 'love',
          text: `${names(ids.map(byId))}<br><small>แตะไหล่ทั้งสองคนเบา ๆ แล้วหลับตา</small>`, lines: LINES.cupidTouch };
      } })] },
  { id: 'lovers', role: 'cupid', icon: '💞', when: () => S.day === 1 && S.g.lovers,
    actors: () => S.g.lovers.map(byId).filter(p => p.alive),
    wake: () => LINES.loversWake, sleep: () => LINES.loversSleep,
    phases: () => [{ type: 'info', title: 'คู่รัก', html: `<div class="big-text">💞 ${names(S.g.lovers.map(byId))}</div>
      <p>ถ้าคนหนึ่งตาย อีกคนจะตรอมใจตายตาม</p>`, button: 'หลับตา' }] },
  { role: 'mason', when: () => S.day === 1,
    phases: () => [{ type: 'info', title: 'ภราดรแห่งเมสัน', html: `<div class="big-text">🧱 ${names(aliveRole('mason'))}</div>`, button: 'หลับตา' }] },
  { role: 'minion', when: () => S.day === 1,
    phases: () => [{ type: 'info', title: 'หมาป่าในหมู่บ้าน', html: `<div class="big-text">🐺 ${names(S.players.filter(isKiller))}</div>`, button: 'หลับตา' }] },
  { role: 'cursed', actors: () => S.players.filter(p => p.origRole === 'cursed' && p.alive && !S.g.cursedTold),
    phases: () => {
      const p = S.players.find(o => o.origRole === 'cursed');
      if (p.role === 'werewolf') {
        S.g.cursedTold = true;
        return [{ type: 'info', title: 'คำสาปทำงานแล้ว!', html: `<div class="big-text">🐺</div>
          <p>คุณถูกหมาป่ากัด และกลายเป็น<strong>มนุษย์หมาป่า</strong>แล้ว<br>ตั้งแต่คืนนี้ ให้ลืมตาพร้อมหมาป่าทุกคืน</p>`, button: 'หลับตา' }];
      }
      return [{ type: 'info', title: 'คุณยังเป็นมนุษย์', html: '<div class="big-text">🧑</div><p>คืนนี้คุณยังเป็นชาวบ้านอยู่</p>', button: 'หลับตา' }];
    } },
  { id: 'wolves', role: 'werewolf', actors: () => alive().filter(isKiller),
    wake: () => {
      if (S.day === 1) return S.settings.firstNightKill ? WOLF_WAKE.firstKill : WOLF_WAKE.first;
      if (S.g.wolvesSick) return WOLF_WAKE.sick;
      return S.g.cubRage ? WOLF_WAKE.double : WOLF_WAKE.normal;
    },
    sleep: () => LINES.wolfSleep,
    phases: () => {
      const pack = `ฝูงหมาป่า: ${names(alive().filter(isKiller))}`;
      if (S.day === 1 && !S.settings.firstNightKill) {
        return [{ type: 'info', title: 'จำหน้ากันไว้', html: `<div class="big-text">🐺 ${names(alive().filter(isKiller))}</div><p>คืนแรกยังไม่มีการล่า</p>`, button: 'หลับตา' }];
      }
      if (S.g.wolvesSick) {
        S.g.wolvesSick = false;
        return [{ type: 'info', title: 'หมาป่าป่วย', html: '<div class="big-text">🤒</div><p>คืนนี้ล่าใครไม่ได้</p>', button: 'หลับตา' }];
      }
      const count = Math.min(S.g.cubRage ? 2 : 1, alive().filter(p => !isKiller(p)).length);
      S.g.cubRage = false;
      return [pickPhase({ title: count > 1 ? 'เลือกเหยื่อ 2 คน' : 'เลือกเหยื่อ', hint: pack, count,
        candidates: alive().filter(p => !isKiller(p)),
        onDone(ids) { S.night.wolfTargets = ids; } })];
    } },
  { role: 'sorcerer', phases: () => [pickPhase({ title: 'ใครคือเทพพยากรณ์?',
    candidates: alive().filter(p => p.role !== 'sorcerer'),
    onDone([id]) {
      const t = byId(id), yes = t.role === 'seer';
      return { title: esc(t.name), tone: yes ? 'wolf' : 'neutral', text: yes ? '🔮 คือเทพพยากรณ์!' : 'ไม่ใช่เทพพยากรณ์' };
    } })] },
  { role: 'seer',
    actors: () => aliveRole('seer').length ? aliveRole('seer') : aliveRole('apprentice'),
    phases: () => [pickPhase({ title: 'ตรวจสอบใคร?',
      hint: aliveRole('seer').length ? '' : '📖 ศิษย์เทพพยากรณ์รับช่วงพลังแล้ว',
      candidates: alive().filter(p => p.role !== 'seer' && (aliveRole('seer').length || p.role !== 'apprentice')),
      onDone([id]) {
        const t = byId(id), wolf = seenAsWolf(t);
        addLog(`เทพพยากรณ์ตรวจ ${t.name}`);
        return { title: esc(t.name), tone: wolf ? 'wolf' : 'village', text: wolf ? '🐺 เป็นมนุษย์หมาป่า' : '😇 ไม่ใช่หมาป่า' };
      } })] },
  { role: 'aura', phases: () => [pickPhase({ title: 'ตรวจพลังของใคร?',
    candidates: alive().filter(p => p.role !== 'aura'),
    onDone([id]) {
      const t = byId(id), special = !['villager', 'werewolf'].includes(t.role);
      return { title: esc(t.name), tone: special ? 'love' : 'neutral', text: special ? '✨ มีพลังพิเศษ' : 'ไม่มีพลังพิเศษ' };
    } })] },
  { role: 'mystic', phases: () => [pickPhase({ title: 'ดูบทบาทของใคร?',
    candidates: alive().filter(p => p.role !== 'mystic'),
    onDone([id]) {
      const t = byId(id);
      return { title: esc(t.name), tone: teamOf(t) === 'wolf' ? 'wolf' : 'village', text: roleBadge(t.role) };
    } })] },
  { role: 'mentalist', phases: () => [pickPhase({ title: 'เลือก 2 คนเพื่อเทียบฝ่าย', count: 2,
    candidates: alive().filter(p => p.role !== 'mentalist'),
    onDone(ids) {
      const [a, b] = ids.map(byId), same = teamOf(a) === teamOf(b);
      return { title: `${esc(a.name)} กับ ${esc(b.name)}`, tone: same ? 'village' : 'wolf',
        text: same ? '🤝 อยู่ฝ่ายเดียวกัน' : '⚔️ อยู่คนละฝ่าย' };
    } })] },
  { role: 'pi', phases: () => onceUsed('pi') ? usedInfo() : [pickPhase({ title: 'สืบสวนใคร?', optional: true, skipLabel: 'เก็บไว้ก่อน',
    hint: 'ใช้ได้ครั้งเดียว — ตรวจคนที่ชี้และคนนั่งข้างซ้ายขวา',
    candidates: alive().filter(p => p.role !== 'pi'),
    onDone([id]) {
      S.g.used.pi = true;
      const t = byId(id), group = [t, ...neighbors(t)], found = group.some(seenAsWolf);
      return { title: names(group), tone: found ? 'wolf' : 'village',
        text: found ? '🐺 มีมนุษย์หมาป่าอยู่ในกลุ่มนี้' : '😇 ไม่มีมนุษย์หมาป่าในกลุ่มนี้' };
    } })] },
  { role: 'bodyguard', phases: () => [pickPhase({ title: 'ปกป้องใคร?',
    hint: S.g.lastGuard != null && byId(S.g.lastGuard).alive ? `คืนก่อนปกป้อง ${esc(byId(S.g.lastGuard).name)} — คืนนี้เลือกซ้ำไม่ได้` : '',
    candidates: alive().filter(p => p.role !== 'bodyguard' && p.id !== S.g.lastGuard),
    onDone([id]) { S.night.guard = id; } })] },
  { role: 'priest', phases: () => onceUsed('priest') ? usedInfo() : [pickPhase({ title: 'อวยพรใคร?', optional: true, skipLabel: 'เก็บไว้ก่อน',
    hint: 'ใช้ได้ครั้งเดียว — คนนั้นจะรอดจากการถูกกำจัด 1 ครั้ง',
    candidates: alive(),
    onDone([id]) { S.g.used.priest = true; byId(id).blessed = true; addLog(`นักบวชอวยพร ${byId(id).name}`); } })] },
  { role: 'witch', phases: () => {
    const out = [];
    const targets = (S.night.wolfTargets || []).map(byId);
    if (S.g.potions.save) {
      if (targets.length) {
        out.push({ type: 'choice', title: '🧪 ใช้ยาชุบชีวิตไหม?',
          html: `<p>คืนนี้หมาป่าทำร้าย</p><div class="big-text">${names(targets)}</div>`,
          options: [...targets.map(t => ({ label: `💚 ช่วย ${esc(t.name)}`, value: t.id, primary: true })), { label: 'ไม่ใช้', value: null }],
          onDone(v) { if (v != null) { S.night.witchSave = v; S.g.potions.save = false; addLog(`แม่มดใช้ยาชุบชีวิตช่วย ${byId(v).name}`); } } });
      } else {
        out.push({ type: 'info', title: 'คืนนี้สงบ', html: '<p>ไม่มีใครถูกหมาป่าทำร้าย</p>', button: 'ต่อไป' });
      }
    }
    if (S.g.potions.kill) {
      out.push(pickPhase({ title: '☠️ ใช้ยาพิษกับใครไหม?', optional: true, skipLabel: 'ไม่ใช้',
        candidates: alive().filter(p => p.role !== 'witch'),
        onDone([id]) { S.night.witchKill = id; S.g.potions.kill = false; } }));
    }
    return out.length ? out : [{ type: 'info', title: 'ยาหมดแล้ว', html: '<p>คุณใช้ยาครบทั้งสองขวดแล้ว</p>', button: 'หลับตา' }];
  } },
  { role: 'huntress', phases: () => onceUsed('huntress') ? usedInfo() : [pickPhase({ title: 'ล่าใคร?', optional: true, skipLabel: 'เก็บไว้ก่อน',
    hint: 'ใช้ได้ครั้งเดียวต่อเกม',
    candidates: alive().filter(p => p.role !== 'huntress'),
    onDone([id]) { S.g.used.huntress = true; S.night.huntressKill = id; } })] },
  { role: 'revealer', phases: () => [pickPhase({ title: 'ชี้ตัวใคร?', optional: true, skipLabel: 'ไม่ชี้',
    hint: 'ถ้าชี้ถูกหมาป่า เขาตาย — ถ้าผิด คุณตายเอง',
    candidates: alive().filter(p => p.role !== 'revealer'),
    onDone([id]) { S.night.revealerTarget = id; } })] },
  { role: 'oldhag', phases: () => [pickPhase({ title: 'สาปใครให้ออกจากหมู่บ้าน?', optional: true, skipLabel: 'ไม่สาป',
    candidates: alive().filter(p => p.role !== 'oldhag'),
    onDone([id]) { S.night.hag = id; } })] },
  { role: 'spellcaster', phases: () => [pickPhase({ title: 'ห้ามใครพูดพรุ่งนี้?', optional: true, skipLabel: 'ไม่ร่าย',
    candidates: alive().filter(p => p.role !== 'spellcaster'),
    onDone([id]) { S.night.spell = id; } })] },
  { role: 'troublemaker', phases: () => onceUsed('troublemaker') ? usedInfo() : [{ type: 'choice', title: 'ป่วนหมู่บ้านไหม?',
    html: '<p>ถ้าป่วน พรุ่งนี้จะมีการประหาร 2 รอบ (ใช้ได้ครั้งเดียว)</p>',
    options: [{ label: '😈 ป่วนเลย', value: true, primary: true }, { label: 'ไว้ก่อน', value: false }],
    onDone(v) { if (v) { S.g.used.troublemaker = true; S.night.trouble = true; } } }] },
];

function stepActors(step) {
  return step.actors ? step.actors() : aliveRole(step.role);
}
function stepCalled(step) {
  if (step.id === 'wolves') return true;
  if (step.id === 'lovers') return !!step.when();
  if (!inGame(step.role)) return false;
  return step.when ? step.when() : true;
}

async function startNight() {
  S.day += 1;
  S.g.banished = null;
  S.g.silenced = null;
  S.g.doubleVote = false;
  S.night = { idx: -1, step: null, view: 'sleeping', phases: [], phaseIdx: 0, pick: [], wolfTargets: [] };
  S.screen = 'night';
  S.subtitle = '';
  S.subtitleEn = '';
  render();
  const id = newRun();
  await sleep(600);
  if (await narrate(LINES.nightStart(S.day), id)) { await sleep(1200); nextNightStep(id); }
}

async function nextNightStep(id) {
  if (id !== runId) return;
  const N = S.night;
  let step;
  do { N.idx += 1; step = NIGHT_STEPS[N.idx]; } while (step && !stepCalled(step));
  if (!step) return resolveNight(id);

  N.step = step;
  N.pick = [];
  N.phaseIdx = 0;
  N.hostOverride = false;
  const wake = step.wake ? step.wake() : ROLES[step.role].wake;
  if (!stepActors(step).length) {
    // บทบาทนี้ตาย/ไม่ต้องทำอะไรแล้ว แต่ยังพากย์ตามปกติ เพื่อไม่ให้คนอื่นรู้
    N.view = 'fake';
    render();
    if (!await narrate(wake, id)) return;
    await sleep(3500 + Math.random() * 3500);
    return sleepStep(id);
  }
  N.phases = step.phases();
  N.view = 'phase';
  render();
  narrate(wake, id);
}

async function sleepStep(id) {
  const N = S.night;
  N.view = 'sleeping';
  render();
  const lines = N.step.sleep ? N.step.sleep() : LINES.sleep(N.step.role);
  if (!await narrate(lines, id)) return;
  await sleep(1500);
  nextNightStep(id);
}

/** จบหน้าจอปัจจุบันของขั้นนี้ แล้วไปหน้าจอถัดไป (หรือหลับตา) */
function finishPhase(result) {
  const N = S.night;
  const id = newRun();
  if (result) {
    N.result = result;
    N.view = 'result';
    render();
    if (result.lines) narrate(result.lines, id);
    return;
  }
  N.phaseIdx += 1;
  N.pick = [];
  if (N.phaseIdx < N.phases.length) { N.view = 'phase'; render(); return; }
  sleepStep(id);
}

function nightNext() {
  S.night.result = null;
  finishPhase(null);
}

// ---------- รุ่งเช้า: คำนวณผลของคืนนี้ ----------
async function resolveNight(id) {
  const N = S.night;
  const g = S.g;
  const deaths = [];
  const tryKill = (p, cause, byWolf) => {
    if (!p || !p.alive || deaths.some(d => d.p === p)) return;
    if (p.id === N.guard) { addLog(`บอดี้การ์ดปกป้อง ${p.name} ไว้ได้`); return; }
    if (byWolf && p.id === N.witchSave) return;
    if (p.blessed) { p.blessed = false; addLog(`พรของนักบวชช่วย ${p.name} ไว้`); return; }
    if (byWolf && p.role === 'cursed') { p.role = 'werewolf'; addLog(`${p.name} ถูกกัดและกลายเป็นมนุษย์หมาป่า`); return; }
    if (byWolf && p.role === 'toughguy' && !p.wounded) {
      p.wounded = true;
      g.toughPending = { id: p.id, night: S.day + 1 };
      addLog(`${p.name} (หนุ่มถึก) ถูกกัดแต่ยังไม่ตาย`);
      return;
    }
    if (byWolf && p.role === 'diseased') g.wolvesSick = true;
    deaths.push({ p, cause });
  };

  if (g.toughPending && g.toughPending.night === S.day) {
    const t = byId(g.toughPending.id);
    g.toughPending = null;
    if (t.alive) deaths.push({ p: t, cause: 'ตายจากบาดแผลที่ถูกหมาป่ากัด' });
  }
  (N.wolfTargets || []).forEach(tid => tryKill(byId(tid), 'ถูกหมาป่าฆ่า', true));
  if (N.witchKill != null) tryKill(byId(N.witchKill), 'ถูกยาพิษของแม่มด');
  if (N.huntressKill != null) tryKill(byId(N.huntressKill), 'ถูกพรานหญิงล่า');
  if (N.revealerTarget != null) {
    const t = byId(N.revealerTarget);
    if (isKiller(t)) tryKill(t, 'ถูกผู้เผยตัวตนชี้ตัว');
    else tryKill(aliveRole('revealer')[0], 'ชี้ผิดคนจึงตายเอง');
  }
  g.lastGuard = N.guard ?? null;
  if (N.hag != null) g.banished = N.hag;
  if (N.spell != null) g.silenced = N.spell;
  if (N.trouble) g.doubleVote = true;

  S.screen = 'day';
  S.dayState = { phase: 'narrating', pick: [], icon: deaths.length ? '💀' : '🌅' };
  S.subtitle = '';
  S.subtitleEn = '';
  render();

  const lines = [...LINES.dawn(S.day)];
  if (deaths.length) {
    lines.push(...LINES.deathCount(deaths.length));
    lines.push(...processDeaths(deaths));
  } else {
    lines.push(...LINES.nobodyDied);
  }
  if (g.banished != null && byId(g.banished).alive) lines.push(...LINES.banished(byId(g.banished).name));
  else g.banished = null;
  if (g.silenced != null && byId(g.silenced).alive) lines.push(...LINES.silenced(byId(g.silenced).name));
  else g.silenced = null;
  if (g.doubleVote) lines.push(...LINES.trouble);
  render();
  if (!await narrate(lines, id)) return;
  await sleep(800);
  afterDeaths(startTalk, id);
}

/** ทำให้ผู้เล่นตาย พร้อมผลต่อเนื่อง (คู่รัก มือระเบิด นายพราน ลูกหมาป่า) คืนบทพากย์ */
function processDeaths(list) {
  const lines = [];
  const queue = [...list];
  while (queue.length) {
    const { p, cause } = queue.shift();
    if (!p.alive) continue;
    p.alive = false;
    const causeText = { lover: 'ตรอมใจตายตามคนรัก', bomb: 'โดนแรงระเบิด', vote: 'ถูกหมู่บ้านประหาร' }[cause] || cause;
    addLog(`${p.name} (${ROLES[p.role].name}) ${causeText}`);
    if (cause === 'lover') lines.push(...LINES.lover(p.name));
    else if (cause === 'bomb') lines.push(...LINES.bombed(p.name));
    else if (cause !== 'vote' && !cause.startsWith('ถูกนายพราน')) lines.push(...LINES.died(p.name));
    if (S.settings.revealOnDeath) lines.push(...LINES.revealRole(p.name, p.role));

    if (S.g.lovers && S.g.lovers.includes(p.id)) {
      const other = byId(S.g.lovers.find(i => i !== p.id));
      if (other.alive) queue.push({ p: other, cause: 'lover' });
    }
    if (p.role === 'bomber') {
      lines.push(...LINES.bomberBoom);
      neighbors(p).forEach(n => queue.push({ p: n, cause: 'bomb' }));
    }
    if (p.role === 'hunter') S.pendingHunters.push(p.id);
    if (p.role === 'wolfcub') S.g.cubRage = true;
  }
  return lines;
}

function checkWinner() {
  const killers = alive().filter(isKiller).length;
  if (killers === 0) return 'village';
  if (killers >= alive().length - killers) return 'wolf';
  return null;
}

/** จัดการนายพรานที่รอยิง แล้วเช็คผลแพ้ชนะ ก่อนไปขั้นถัดไป */
function afterDeaths(next, id) {
  if (id !== runId) return;
  if (S.pendingHunters.length) {
    const h = byId(S.pendingHunters[0]);
    S.hunterReturn = next;
    S.dayState = { phase: 'hunter', pick: [] };
    render();
    narrate(LINES.hunter(h.name), id);
    return;
  }
  const w = checkWinner();
  if (w) return endGame(w, id);
  next();
}

async function hunterResolve(targetId) {
  const id = newRun();
  const hunterId = S.pendingHunters.shift();
  const next = S.hunterReturn;
  S.dayState = { phase: 'narrating', pick: [], icon: '🏹' };
  render();
  if (targetId != null) {
    const t = byId(targetId);
    const lines = [...LINES.hunterShot(t.name), ...processDeaths([{ p: t, cause: `ถูกนายพราน ${byId(hunterId).name} ยิง` }])];
    if (!await narrate(lines, id)) return;
  }
  await sleep(600);
  afterDeaths(next, id);
}

async function endGame(winner, id) {
  stopTimer();
  S.winner = winner;
  S.screen = 'end';
  S.subtitle = '';
  S.subtitleEn = '';
  render();
  await narrate(winner === 'wolf' ? LINES.wolfWin : winner === 'tanner' ? LINES.tannerWin : LINES.villageWin, id);
}

// ---------- กลางวัน ----------
let timerHandle = null;
function stopTimer() { clearInterval(timerHandle); timerHandle = null; }

function startTalk() {
  const id = newRun();
  S.dayState = { phase: 'talk', left: S.settings.talkSec, paused: false, warned: false, pick: [] };
  render();
  narrate(LINES.talk(S.settings.talkSec), id);
  stopTimer();
  timerHandle = setInterval(() => {
    const D = S.dayState;
    if (S.screen !== 'day' || D.phase !== 'talk') return stopTimer();
    if (D.paused) return;
    D.left -= 1;
    const el = document.getElementById('timer');
    if (el) {
      el.textContent = formatTime(Math.max(D.left, 0));
      el.parentElement.classList.toggle('low', D.left <= 30);
    }
    if (D.left === 30 && !D.warned) { D.warned = true; narrate(LINES.talk30); }
    if (D.left <= 0) { stopTimer(); toVote(true); }
  }, 1000);
}

function toVote(timeUp, round = 1) {
  stopTimer();
  const id = newRun();
  S.dayState = { phase: 'vote', pick: [], round, votes: {} };
  render();
  narrate([...(timeUp ? LINES.talkEnd : []), ...(round === 2 ? LINES.voteSecond : LINES.vote)], id);
}

async function execute(targetId) {
  const id = newRun();
  const round = S.dayState.round;
  S.dayState = { phase: 'narrating', pick: [], icon: targetId != null ? '⚖️' : '🤷' };
  render();
  let lines;
  let tannerWins = false;
  if (targetId == null) {
    addLog('ไม่มีการประหาร');
    lines = LINES.noExecution;
  } else {
    const t = byId(targetId);
    lines = [...LINES.executed(t.name)];
    if (t.role === 'prince' && !t.princeRevealed) {
      t.princeRevealed = true;
      addLog(`${t.name} เผยตัวเป็นเจ้าชาย รอดจากการประหาร`);
      lines.push(...LINES.prince(t.name));
      S.dayState.icon = '🤴';
    } else {
      tannerWins = t.role === 'tanner';
      lines.push(...processDeaths([{ p: t, cause: 'vote' }]));
    }
  }
  if (!await narrate(lines, id)) return;
  await sleep(900);
  if (tannerWins) return endGame('tanner', id);
  const next = S.g.doubleVote && round === 1 ? () => toVote(false, 2) : startNight;
  afterDeaths(next, id);
}

// ---------- โหมดหลายเครื่อง ----------
function lobbyPanel() {
  const join = Net.error ? `<p class="warn">⚠️ ${Net.error}</p>`
    : !Net.room ? '<p class="muted">กำลังเปิดห้อง…</p>'
    : `<div class="join-box">
        <div id="qr" class="qr" data-url="${esc(Net.joinUrl())}"></div>
        <div class="join-info">
          <p>เลขห้อง</p>
          <b class="room-code big">${Net.room}</b>
          <p class="muted">ให้เพื่อนเปิดเว็บนี้ › เข้าร่วมห้อง › กรอกเลขห้อง หรือสแกน QR</p>
          <code>${esc(Net.joinUrl())}</code>
          <small class="muted">${Net.kind === 'cloud' ? '🌍 ออนไลน์ — มือถือเข้าได้จากทุกเครือข่าย (4G/5G ก็ได้)'
            : Net.public ? '🌍 ลิงก์สาธารณะ — มือถือเข้าได้จากทุกเครือข่าย (4G/5G ก็ได้)'
            : '📶 มือถือต้องต่อ Wi-Fi เดียวกับเครื่องนี้ (ถ้าอยากเล่นต่างเครือข่าย ให้รัน python3 server.py --public)'}</small>
        </div>
      </div>`;
  return `
    <section class="panel">
      <div class="row"><strong class="grow" id="player-count">ผู้เล่น (${S.joined.length} คน)</strong></div>
      ${join}
      ${Net.kind === 'cloud' ? '' : `<label class="host-play"><input type="checkbox" data-hostplay ${S.hostPlays ? 'checked' : ''}>
        <span>🙋 ฉันเล่นด้วยบนเครื่องนี้<small>ไม่ต้องมีจอกลาง — เครื่องนี้พากย์เสียงและเป็นผู้เล่นไปพร้อมกัน</small></span></label>
      ${S.hostPlays ? `<input type="text" class="host-name" data-hostname placeholder="ชื่อของคุณ" maxlength="20" value="${esc(S.hostName)}">` : ''}`}
      <p class="muted small">เรียงตามที่นั่งรอบวง (กด ↑ ↓ เพื่อจัดลำดับ)</p>
      <div class="name-list">
        ${S.joined.map((j, i) => `
          <div class="row name-row">
            <span class="seat">${i + 1}</span>
            <span class="grow lobby-name"><i class="dot ${j.online ? 'on' : ''}"></i>${esc(j.name) || '<em class="muted">(ชื่อของคุณ)</em>'}${j.local ? ' <small class="muted">· เครื่องนี้</small>' : ''}</span>
            <button class="icon-btn" data-act="seat" data-i="${i}" data-d="-1" aria-label="เลื่อนขึ้น">↑</button>
            <button class="icon-btn" data-act="seat" data-i="${i}" data-d="1" aria-label="เลื่อนลง">↓</button>
            ${j.local ? '<span class="icon-btn"></span>' : `<button class="icon-btn" data-act="kick" data-pid="${j.pid}" aria-label="ลบ">✕</button>`}
          </div>`).join('') || '<p class="muted">ยังไม่มีใครเข้าร่วม…</p>'}
      </div>
    </section>`;
}

function drawQr() {
  const el = document.getElementById('qr');
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text: el.dataset.url, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
}

function revealMulti() {
  const n = S.players.length, ready = S.ready.size;
  return `
    <div class="stage">
      <div class="big-icon float">📲</div>
      <h2>ดูบทบาทบนมือถือของตัวเอง</h2>
      <p class="muted">แตะการ์ดบนมือถือเพื่อเปิดดู อย่าให้คนอื่นเห็น แล้วกด “พร้อม”</p>
      <div class="alive-bar">${S.players.map(p =>
        `<span class="chip ${S.ready.has(p.id) ? 'ready' : ''}">${S.ready.has(p.id) ? '✓ ' : '⏳ '}${esc(p.name)}</span>`).join('')}</div>
      <button class="btn-primary btn-block btn-big" data-act="start-night">🌙 เริ่มคืนแรก (${ready}/${n} พร้อม)</button>
    </div>`;
}

function waitingScreen(icon, text) {
  return `<div class="stage"><div class="big-icon float">${icon}</div>${subtitleBox()}
    <p class="muted">📱 ${text}</p>
    <button class="btn-ghost small-btn" data-act="host-override">ทำแทนบนเครื่องนี้</button></div>`;
}

/** ตอนนี้ขั้นกลางคืนรอให้ผู้เล่นกดบนมือถืออยู่หรือไม่ */
function remoteActing() {
  const N = S.night;
  return S.mode === 'multi' && N && !N.hostOverride && N.step && ['phase', 'result'].includes(N.view);
}

const voteEligible = () => alive().filter(p => p.id !== S.g.banished);
const voteWeight = p => (p.role === 'mayor' ? 2 : 1);

function voteTally() {
  const t = {};
  for (const [vid, target] of Object.entries(S.dayState.votes)) {
    if (target != null) t[target] = (t[target] || 0) + voteWeight(byId(Number(vid)));
  }
  return t;
}

function voteTallyView() {
  const D = S.dayState;
  const tally = voteTally();
  const voters = voteEligible();
  const total = voters.reduce((a, p) => a + voteWeight(p), 0);
  const voted = voters.filter(p => p.id in D.votes).length;
  const rows = voteEligible()
    .map(p => ({ p, n: tally[p.id] || 0, by: voters.filter(v => D.votes[v.id] === p.id) }))
    .sort((a, b) => b.n - a.n);
  return `<div class="stage tight"><div class="mid-icon">🗳️</div>
      <h2>${D.round === 2 ? 'รอบที่ 2: ' : ''}โหวตบนมือถือ</h2>${subtitleBox()}
      <p class="muted">ต้องได้เกินครึ่ง (${Math.floor(total / 2) + 1} เสียงขึ้นไป) จึงประหาร${aliveRole('mayor').length ? ' · นายกเทศมนตรีนับ 2 เสียง' : ''}</p></div>
    <div class="tally">${rows.map(r => `
      <div class="tally-row">
        <span class="t-name">${esc(r.p.name)}</span>
        <span class="t-bar"><i style="width:${total ? (r.n / total) * 100 : 0}%"></i></span>
        <b>${r.n}</b>
        <small class="t-by">${r.by.map(v => esc(v.name)).join(', ')}</small>
      </div>`).join('')}</div>
    <p class="muted" style="text-align:center">โหวตแล้ว ${voted}/${voters.length} คน</p>
    <div class="actions">
      <button data-act="host-override">เลือกบนเครื่องนี้</button>
      <button class="btn-primary" data-act="resolve-vote">⚖️ สรุปผลโหวต</button>
    </div>`;
}

function resolveVote() {
  const D = S.dayState;
  if (S.screen !== 'day' || D.phase !== 'vote') return;
  const total = voteEligible().reduce((a, p) => a + voteWeight(p), 0);
  const ranked = Object.entries(voteTally()).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const winner = top && (!second || second[1] < top[1]) && top[1] * 2 > total ? Number(top[0]) : null;
  addLog(`ผลโหวต: ${ranked.map(([id, n]) => `${byId(Number(id)).name} ${n}`).join(', ') || 'ไม่มีใครถูกโหวต'}`);
  execute(winner);
}

/** รหัสของ "จังหวะ" ปัจจุบัน — การกดจากมือถือที่ส่งมาจากจังหวะเก่าจะถูกเมิน */
function actionKey() {
  const N = S.night || {}, D = S.dayState || {};
  return [S.screen, S.day, N.idx, N.phaseIdx, N.view, D.phase, D.round].join('|');
}

function extraInfo(p) {
  const out = [];
  if (isKiller(p)) {
    const pack = S.players.filter(o => isKiller(o) && o.id !== p.id);
    if (pack.length) out.push(`🐺 ฝูงของคุณ: ${names(pack)}`);
  }
  if (S.g && S.g.lovers && S.g.lovers.includes(p.id)) {
    out.push(`💞 คู่รักของคุณ: ${esc(byId(S.g.lovers.find(i => i !== p.id)).name)}`);
  }
  if (p.blessed) out.push('🙏 คุณได้รับพรจากนักบวช');
  return out;
}

function nightActionView() {
  const N = S.night;
  const icon = N.step.icon || ROLES[N.step.role].icon;
  if (N.view === 'result') {
    return { kind: 'result', icon: N.result.icon || icon, title: N.result.title, text: N.result.text, tone: N.result.tone || '' };
  }
  const ph = N.phases[N.phaseIdx];
  return {
    kind: ph.type, icon, title: ph.title, hint: ph.hint || '', html: ph.html || '', button: ph.button || 'ต่อไป',
    count: ph.count || 1, optional: !!ph.optional, skipLabel: ph.skipLabel || 'ไม่ใช้',
    candidates: (ph.candidates || []).map(c => ({ id: c.id, name: c.name })),
    options: (ph.options || []).map(o => ({ label: o.label, primary: !!o.primary })),
  };
}

/** หน้าจอของผู้เล่นแต่ละคน (ส่งให้เฉพาะเจ้าตัว) */
function viewFor(p) {
  const r = ROLES[p.role];
  const v = {
    phase: S.screen, day: S.day, key: actionKey(),
    me: { name: p.name, icon: r.icon, role: r.name, en: r.en, team: r.team, teamName: TEAMS[r.team].name,
      desc: r.desc, alive: p.alive, extra: extraInfo(p) },
  };
  if (S.screen === 'reveal') v.ready = S.ready.has(p.id);
  if (S.screen === 'night' && remoteActing() && stepActors(S.night.step).includes(p)) v.action = nightActionView();
  if (S.screen === 'day') {
    const D = S.dayState;
    v.dayPhase = D.phase;
    v.status = [];
    if (S.g.banished === p.id) v.status.push('🧿 คุณถูกแม่หมอสาป วันนี้ห้ามพูดและห้ามโหวต');
    if (S.g.silenced === p.id) v.status.push('🤐 คุณถูกจอมเวทร่ายมนตร์ วันนี้ห้ามพูด');
    if (D.phase === 'hunter' && !D.hostOverride && S.pendingHunters[0] === p.id) {
      v.action = { kind: 'hunter', title: '🏹 ยิงใครไปด้วย?', candidates: alive().map(c => ({ id: c.id, name: c.name })) };
    }
    if (D.phase === 'vote' && !D.hostOverride && voteEligible().includes(p)) {
      v.action = { kind: 'vote', title: D.round === 2 ? 'โหวตรอบที่ 2' : 'โหวตประหาร',
        candidates: voteEligible().filter(c => c.id !== p.id).map(c => ({ id: c.id, name: c.name })),
        myVote: p.id in D.votes ? D.votes[p.id] : undefined };
    }
  }
  if (S.screen === 'end') {
    const w = S.winner;
    v.winner = w;
    v.won = w === 'tanner' ? p.role === 'tanner' : teamOf(p) === w;
    v.players = S.players.map(o => ({ name: o.name, icon: ROLES[o.role].icon, role: ROLES[o.role].name, alive: o.alive }));
  }
  return v;
}

function publishViews() {
  if (S.mode !== 'multi' || !Net.active) return;
  const views = {};
  if (S.screen === 'setup') {
    S.joined.forEach(j => { if (!j.local) views[j.pid] = { phase: 'lobby', name: j.name, count: S.joined.length }; });
  } else {
    S.players.forEach(p => { if (p.pid && p.pid !== HOST_PID) views[p.pid] = viewFor(p); });
  }
  Net.publish(views);
}

/** รับการกดจากมือถือ แล้วทำเหมือนกดบนเครื่องหลัก */
function handlePlayerAction(pid, a) {
  const p = S.players.find(x => x.pid === pid);
  if (!p) return;
  if (S.screen === 'reveal') {
    if (a.type === 'ready') {
      S.ready.add(p.id);
      render();
      if (S.ready.size === S.players.length) startNight();
    }
    return;
  }
  if (a.key !== actionKey()) return;
  if (S.screen === 'night') {
    const N = S.night;
    if (!remoteActing() || !stepActors(N.step).includes(p)) return;
    if (N.view === 'result') { if (a.type === 'next') nightNext(); return; }
    const ph = N.phases[N.phaseIdx];
    if (a.type === 'next' && ph.type === 'info') return nightNext();
    if (a.type === 'skip' && ph.optional) return finishPhase(null);
    if (a.type === 'choice' && ph.type === 'choice' && ph.options[a.i]) return finishPhase(ph.onDone(ph.options[a.i].value));
    if (a.type === 'confirm' && ph.type === 'pick' && Array.isArray(a.ids)) {
      const ids = [...new Set(a.ids.map(Number))];
      if (ids.length !== ph.count || !ids.every(id => ph.candidates.some(c => c.id === id))) return;
      N.pick = ids;
      return finishPhase(ph.onDone([...ids]));
    }
    return;
  }
  if (S.screen === 'day') {
    const D = S.dayState;
    if (D.phase === 'hunter' && !D.hostOverride && S.pendingHunters[0] === p.id && a.type === 'hunter') {
      if (a.id == null) return hunterResolve(null);
      if (alive().some(x => x.id === a.id)) return hunterResolve(a.id);
    }
    if (D.phase === 'vote' && !D.hostOverride && voteEligible().includes(p) && a.type === 'vote') {
      if (a.id !== null && !voteEligible().some(x => x.id === a.id && x.id !== p.id)) return;
      D.votes[p.id] = a.id;
      render();
      if (voteEligible().every(x => x.id in D.votes)) resolveVote();
    }
  }
}

// ---------- จัดการการแตะ ----------
document.addEventListener('change', e => {
  if (!('hostplay' in e.target.dataset)) return;
  S.hostPlays = e.target.checked;
  store.set('hostPlays', S.hostPlays);
  syncHostEntry();
  render();
  if (S.hostPlays) $app.querySelector('[data-hostname]')?.focus();
});

document.addEventListener('input', e => {
  if ('hostname' in e.target.dataset) {
    S.hostName = e.target.value;
    store.set('hostName', S.hostName);
    syncHostEntry();
    // อัปเดตเฉพาะส่วนที่จำเป็น เพื่อไม่ให้ช่องพิมพ์หลุดโฟกัส
    const row = [...$app.querySelectorAll('.lobby-name')][S.joined.findIndex(j => j.pid === HOST_PID)];
    if (row) row.innerHTML = `<i class="dot on"></i>${esc(S.hostName) || '<em class="muted">(ชื่อของคุณ)</em>'} <small class="muted">· เครื่องนี้</small>`;
    refreshSetup();
    publishViews();
    return;
  }
  const i = e.target.dataset.name;
  if (i == null) return;
  S.names[i] = e.target.value;
  refreshSetup();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.name != null) {
    const i = Number(e.target.dataset.name);
    if (i === S.names.length - 1) { S.names.push(''); render(); }
    $app.querySelector(`[data-name="${i + 1}"]`)?.focus();
  }
});

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled || !btn.dataset.act) return;
  const act = btn.dataset.act;
  const ACTIONS = {
    'toggle-settings'() {
      const el = document.getElementById('settings');
      el.hidden = !el.hidden;
      if (!el.hidden) renderSettings();
    },
    'test-voice'() {
      Voice.speechBroken = false;
      document.getElementById('voice-warning').hidden = true;
      Voice.unlock();
      narrate(LINES.test);
    },
    quit() {
      if (!confirm('จบเกมนี้และกลับไปหน้าตั้งค่า?')) return;
      newRun(); stopTimer();
      document.getElementById('settings').hidden = true;
      S.screen = 'setup'; render();
    },
    'add-player'() {
      S.names.push(''); render();
      $app.querySelector(`[data-name="${S.names.length - 1}"]`)?.focus();
    },
    'remove-player'() { S.names.splice(Number(btn.dataset.i), 1); render(); },
    preset() { applyPreset(PRESETS[Number(btn.dataset.i)]); refreshSetup(); },
    'toggle-role'() {
      const r = btn.dataset.role;
      if (S.counts[r]) delete S.counts[r]; else S.counts[r] = 1;
      refreshSetup();
    },
    count() {
      const r = btn.dataset.role;
      const d = Number(btn.dataset.d);
      let n = (S.counts[r] || 0) + d;
      if (ROLES[r].min && n > 0 && n < ROLES[r].min) n = d > 0 ? ROLES[r].min : 0;
      n = Math.max(0, Math.min(maxFor(r), n));
      if (n) S.counts[r] = n; else delete S.counts[r];
      refreshSetup();
    },
    start: startGame,
    'create-room'() {
      const name = ($app.querySelector('#create-name')?.value || '').trim();
      if (!name) { S.homeError = 'ใส่ชื่อของคุณก่อน'; return render(); }
      S.homeError = '';
      S.hostName = name;
      store.set('hostName', name);
      S.mode = 'multi';
      store.set('mode', 'multi');
      // โหมดออนไลน์: คนสร้างห้องเล่นด้วยเสมอ (ไม่มีจอกลาง)
      if (Net.kind === 'cloud') { S.hostPlays = true; store.set('hostPlays', true); }
      S.joined = [];
      syncHostEntry();
      setInRoom(true);
      S.screen = 'setup';
      Voice.unlock();
      Net.start().then(render);
      render();
    },
    single() {
      S.mode = 'single';
      store.set('mode', 'single');
      syncHostEntry();
      S.screen = 'setup';
      render();
    },
    'go-home'() {
      if (S.mode === 'multi' && S.joined.some(j => !j.local) && !confirm('ปิดห้องนี้? เพื่อนในห้องจะต้องเข้าห้องใหม่')) return;
      Net.stop();
      setInRoom(false);
      S.joined = [];
      S.screen = 'home';
      render();
    },
    seat() {
      const i = Number(btn.dataset.i), j = i + Number(btn.dataset.d);
      if (j < 0 || j >= S.joined.length) return;
      [S.joined[i], S.joined[j]] = [S.joined[j], S.joined[i]];
      render();
    },
    kick() { if (confirm('ลบผู้เล่นคนนี้ออกจากห้อง?')) Net.kick(btn.dataset.pid); },
    'host-override'() {
      if (S.screen === 'night') S.night.hostOverride = true; else S.dayState.hostOverride = true;
      render();
    },
    'resolve-vote': resolveVote,
    'start-night'() { startNight(); },
    'show-role'() {
      S.reveal.shown = true;
      render();
      // วาดการ์ดด้านหลังก่อน แล้วค่อยพลิก เพื่อให้เห็นแอนิเมชัน
      const flip = $app.querySelector('.flip');
      flip.classList.remove('flipped');
      requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('flipped')));
    },
    'hide-role'() {
      S.reveal.shown = false;
      S.reveal.idx += 1;
      if (S.reveal.idx >= S.players.length) startNight(); else render();
    },
    pick() {
      const pid = Number(btn.dataset.id);
      const holder = S.screen === 'night' ? S.night : S.dayState;
      const max = S.screen === 'night' ? holder.phases[holder.phaseIdx].count : 1;
      if (holder.pick.includes(pid)) holder.pick = holder.pick.filter(x => x !== pid);
      else if (max === 1) holder.pick = [pid];
      else if (holder.pick.length < max) holder.pick.push(pid);
      render();
    },
    'night-confirm'() {
      const N = S.night;
      finishPhase(N.phases[N.phaseIdx].onDone([...N.pick]));
    },
    'night-skip'() { finishPhase(null); },
    'night-choice'() {
      const ph = S.night.phases[S.night.phaseIdx];
      finishPhase(ph.onDone(ph.options[Number(btn.dataset.i)].value));
    },
    'night-next': nightNext,
    'hunter-confirm'() { hunterResolve(S.dayState.pick[0]); },
    'hunter-skip'() { hunterResolve(null); },
    'timer-toggle'() { S.dayState.paused = !S.dayState.paused; render(); },
    'timer-add'() { S.dayState.left += 30; if (S.dayState.left > 30) S.dayState.warned = false; render(); },
    'to-vote'() { toVote(false); },
    execute() { execute(S.dayState.pick[0]); },
    'no-execute'() { execute(null); },
    'to-setup'() { newRun(); S.screen = 'setup'; render(); },
    replay() { newRun(); startGame(); },
  };
  ACTIONS[act]?.();
});

window.addEventListener('beforeunload', e => {
  if (S.screen !== 'setup' && S.screen !== 'end') { e.preventDefault(); e.returnValue = ''; }
});

Net.onLobby = () => { if (S.screen === 'setup') render(); else publishViews(); };
Net.onAction = handlePlayerAction;
// หน้า "เข้าร่วมห้อง": ส่งไปหน้าผู้เล่นพร้อมเลขห้องและชื่อ
document.addEventListener('submit', e => {
  if (e.target.id !== 'join-room') return;
  e.preventDefault();
  const f = new FormData(e.target);
  // รับทั้งเลขห้องแบบตัวเลขและแบบตัวอักษร (ห้องที่สร้างจากเวอร์ชันเก่า)
  const code = String(f.get('code')).replace(/\s/g, '').toUpperCase();
  const name = String(f.get('name')).trim();
  const warn = msg => {
    S.homeError = '';
    e.target.querySelector('.warn')?.remove();
    e.target.insertAdjacentHTML('beforeend', `<p class="warn">⚠️ ${msg}</p>`);
  };
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return warn('เลขห้องไม่ถูกต้อง — ให้ถามเลขห้องจากคนสร้างห้อง');
  if (!name) return warn('ใส่ชื่อของคุณก่อน');
  location.href = `play.html?room=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
});

syncHostEntry();
if (S.mode === 'multi' && S.screen === 'setup') Net.start().then(render);
render();
