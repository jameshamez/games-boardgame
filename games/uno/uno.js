'use strict';
// เกม UNO — เครื่องคนสร้างห้องเป็นตัวเดินเกม (สับไพ่ แจกไพ่ ตรวจกติกา นับแต้ม) และเล่นด้วย
// มือถือแต่ละเครื่องได้รับเฉพาะไพ่ในมือของตัวเอง
// ต้องโหลดหลัง uno-ui.js และ assets/net-*.js

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const HOST_PID = 'host';
const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAME = { r: 'แดง', y: 'เหลือง', g: 'เขียว', b: 'น้ำเงิน' };
const CARD_NAME = { skip: 'ข้าม', rev: 'กลับทาง', d2: '+2', wild: 'เปลี่ยนสี', d4: '+4' };
const COLOR_EN = { r: 'red', y: 'yellow', g: 'green', b: 'blue' };
const CARD_EN = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', d4: 'Wild +4' };

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('uno.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('uno.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

function inRoom() {
  try { return sessionStorage.getItem('uno.inRoom') === '1'; } catch { return false; }
}
function setInRoom(on) {
  try {
    if (on) sessionStorage.setItem('uno.inRoom', '1');
    else { sessionStorage.removeItem('uno.inRoom'); sessionStorage.removeItem('uno.cloudHost'); }
  } catch { /* ignore */ }
}

const S = {
  screen: inRoom() ? 'lobby' : 'home',   // home › lobby › play › end
  error: '',
  name: store.get('name', ''),
  joined: [],                             // [{pid, name, online, local?}] — คนสร้างห้องอยู่คนแรกเสมอ
  settings: Object.assign({ handSize: 7, stack: true, drawUntil: false }, store.get('settings', {})),
  players: [],                            // [{id, pid, name, hand: [card], saidUno}]
  round: 0,
  deck: [],
  discard: [],                            // ใบบนสุดอยู่ท้ายสุด
  color: 'r',                             // สีที่ต้องลงตาม (ไพ่เปลี่ยนสีกำหนดเองได้)
  turn: 0,
  dir: 1,                                 // 1 = ตามเข็ม, -1 = ทวนเข็ม
  pending: 0,                             // จำนวนใบที่คนถัดไปต้องจั่ว (+2/+4 ที่ซ้อนกันอยู่)
  drawn: null,                            // id ของไพ่ที่เพิ่งจั่ว (ลงได้เฉพาะใบนี้ หรือผ่าน)
  unoVictim: null,                        // คนที่เหลือ 1 ใบแต่ยังไม่ได้กด UNO (โดนจับได้)
  event: null,                            // เหตุการณ์ล่าสุด { seq, text, kind }
  winner: null,
  roundPoints: 0,
  scores: {},                             // แต้มสะสม pid → แต้ม
};

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => S.players.find(p => p.id === id);
const byPid = pid => S.players.find(p => p.pid === pid);
const topCard = () => S.discard[S.discard.length - 1];
const current = () => S.players[S.turn];
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

// ---------- ไพ่ ----------
/** สำรับมาตรฐาน 108 ใบ: แต่ละสีมี 0 หนึ่งใบ, 1–9 / ข้าม / กลับทาง / +2 อย่างละสองใบ, เปลี่ยนสีและ +4 อย่างละสี่ใบ */
function newDeck() {
  const cards = [];
  let id = 0;
  for (const c of COLORS) {
    cards.push({ id: id++, c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) {
      cards.push({ id: id++, c, v }, { id: id++, c, v });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, c: 'w', v: 'wild' }, { id: id++, c: 'w', v: 'd4' });
  return shuffle(cards);
}

function cardPoints(card) {
  if (card.c === 'w') return 50;
  if (['skip', 'rev', 'd2'].includes(card.v)) return 20;
  return Number(card.v);
}

function cardLabel(card, color) {
  const name = CARD_NAME[card.v] || card.v;
  if (card.c === 'w') return color ? `${name} (เลือกสี${COLOR_NAME[color]})` : name;
  return `${name} ${COLOR_NAME[card.c]}`;
}

function cardLabelEn(card, color) {
  const name = CARD_EN[card.v] || card.v;
  if (card.c === 'w') return color ? `${name} (chose ${COLOR_EN[color]})` : name;
  return `${COLOR_EN[card.c]} ${name}`;
}

/** จั่วจากกอง ถ้ากองหมดให้เอากองทิ้ง (ยกเว้นใบบนสุด) มาสับใหม่ */
function drawCard() {
  if (!S.deck.length) {
    const keep = S.discard.pop();
    S.deck = shuffle(S.discard);
    S.discard = [keep];
  }
  return S.deck.pop() || null;
}

function giveCards(p, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    const c = drawCard();
    if (!c) break;
    p.hand.push(c);
    got.push(c);
  }
  if (p.hand.length > 1) p.saidUno = false;
  if (S.unoVictim === p.id) S.unoVictim = null;
  return got;
}

/** ไพ่ใบนี้ลงได้ไหม (ตอนนี้เป็นตาของเจ้าของไพ่) */
function canPlay(card) {
  const t = topCard();
  if (S.pending) {
    if (!S.settings.stack) return false;
    return card.v === 'd4' || (card.v === 'd2' && t.v === 'd2');
  }
  if (S.drawn != null && card.id !== S.drawn) return false;
  return card.c === 'w' || card.c === S.color || card.v === t.v;
}

const nextIdx = (from, steps = 1) => {
  const n = S.players.length;
  return ((from + S.dir * steps) % n + n) % n;
};

/** เหตุการณ์ล่าสุดที่ทุกคนเห็น (ข้อความไทย + อังกฤษ) */
function setEvent(text, kind = '', en = '') {
  S.event = { seq: (S.event ? S.event.seq : 0) + 1, text, en, kind };
}

// ---------- เดินเกม ----------
function startRound() {
  if (S.joined.length < MIN_PLAYERS || S.joined.length > MAX_PLAYERS) return;
  S.round += 1;
  S.deck = newDeck();
  S.players = S.joined.map((j, id) => ({ id, pid: j.pid, name: j.name, hand: [], saidUno: false }));
  for (let i = 0; i < S.settings.handSize; i++) S.players.forEach(p => p.hand.push(S.deck.pop()));
  // ใบแรกต้องเป็นไพ่ตัวเลข (ใบพิเศษสอดกลับไว้ใต้กอง)
  let first = S.deck.pop();
  while (!/^\d$/.test(first.v)) { S.deck.unshift(first); first = S.deck.pop(); }
  S.discard = [first];
  S.color = first.c;
  S.dir = 1;
  S.pending = 0;
  S.drawn = null;
  S.unoVictim = null;
  S.winner = null;
  // คนเริ่มเวียนไปทีละรอบ
  S.turn = (S.round - 1) % S.players.length;
  S.event = null;
  setEvent(`เริ่มรอบที่ ${S.round} — ${current().name} เริ่มก่อน`, '', `Round ${S.round} — ${current().name} goes first`);
  S.screen = 'play';
  render();
}

/** ไปตาคนถัดไป ถ้ามี +2/+4 ค้างอยู่และไม่เปิดกติกาซ้อน คนนั้นจั่วแล้วเสียตาทันที */
function advance(steps = 1) {
  S.drawn = null;
  S.turn = nextIdx(S.turn, steps);
  if (S.pending && !S.settings.stack) {
    const p = current();
    giveCards(p, S.pending);
    setEvent(`${S.event ? S.event.text + ' · ' : ''}${p.name} จั่ว ${S.pending} ใบ และเสียตา`, 'hit',
      `${S.event && S.event.en ? S.event.en + ' · ' : ''}${p.name} draws ${S.pending} and loses the turn`);
    S.pending = 0;
    S.turn = nextIdx(S.turn);
  }
}

function play(pid, cardId, color) {
  const p = byPid(pid);
  if (S.screen !== 'play' || !p || p !== current()) return;
  const card = p.hand.find(c => c.id === cardId);
  if (!card || !canPlay(card)) return;
  if (card.c === 'w' && !COLORS.includes(color)) return;

  if (S.unoVictim != null && S.unoVictim !== p.id) S.unoVictim = null;  // หมดสิทธิ์จับคนก่อนหน้าแล้ว
  p.hand = p.hand.filter(c => c !== card);
  S.discard.push(card);
  S.color = card.c === 'w' ? color : card.c;
  let text = `${p.name} ลง ${cardLabel(card, card.c === 'w' ? color : null)}`;
  let en = `${p.name} played ${cardLabelEn(card, card.c === 'w' ? color : null)}`;

  if (p.hand.length === 1 && !p.saidUno) S.unoVictim = p.id;
  if (p.hand.length !== 1) p.saidUno = false;
  if (!p.hand.length) { setEvent(text, '', en); return endRound(p); }

  let steps = 1;
  if (card.v === 'skip') {
    steps = 2;
    text += ` — ${S.players[nextIdx(S.turn)].name} ถูกข้าม`;
    en += ` — ${S.players[nextIdx(S.turn)].name} is skipped`;
  }
  if (card.v === 'rev') {
    S.dir *= -1;
    if (S.players.length === 2) steps = 2;  // เล่นสองคน กลับทาง = ข้าม
    text += ' — กลับทาง';
    en += ' — direction reversed';
  }
  if (card.v === 'd2') S.pending += 2;
  if (card.v === 'd4') S.pending += 4;
  if (S.pending) {
    text += ` — ${S.players[nextIdx(S.turn)].name} โดน +${S.pending}`;
    en += ` — ${S.players[nextIdx(S.turn)].name} gets +${S.pending}`;
  }
  setEvent(text, ['d2', 'd4', 'skip'].includes(card.v) ? 'hit' : '', en);
  advance(steps);
  render();
}

function draw(pid) {
  const p = byPid(pid);
  if (S.screen !== 'play' || !p || p !== current() || S.drawn != null) return;
  if (S.unoVictim != null && S.unoVictim !== p.id) S.unoVictim = null;
  if (S.pending) {
    const n = S.pending;
    giveCards(p, n);
    S.pending = 0;
    setEvent(`${p.name} จั่ว ${n} ใบ และเสียตา`, 'hit', `${p.name} draws ${n} and loses the turn`);
    advance();
    return render();
  }
  // จั่วจนกว่าจะได้ใบที่ลงได้ (ถ้าเปิดกติกานี้) ไม่งั้นจั่ว 1 ใบ
  let got = [];
  do {
    const c = giveCards(p, 1)[0];
    if (!c) break;
    got.push(c);
    if (canPlay(c)) { S.drawn = c.id; break; }
  } while (S.settings.drawUntil);
  if (S.drawn != null) {
    setEvent(`${p.name} จั่ว ${got.length} ใบ ได้ใบที่ลงได้`, '', `${p.name} drew ${got.length} — got a playable card`);
  } else {
    setEvent(`${p.name} จั่ว ${got.length} ใบ แล้วผ่าน`, '', `${p.name} drew ${got.length} and passed`);
    advance();
  }
  render();
}

/** จั่วแล้วได้ใบที่ลงได้ แต่เลือกเก็บไว้ */
function pass(pid) {
  const p = byPid(pid);
  if (S.screen !== 'play' || !p || p !== current() || S.drawn == null) return;
  setEvent(`${p.name} เก็บไพ่ไว้ แล้วผ่าน`, '', `${p.name} kept the card and passed`);
  advance();
  render();
}

function callUno(pid) {
  const p = byPid(pid);
  if (S.screen !== 'play' || !p || p.hand.length > 2 || p.saidUno) return;
  p.saidUno = true;
  if (S.unoVictim === p.id) S.unoVictim = null;
  setEvent(`${p.name}: UNO!`, 'uno', `${p.name} called UNO!`);
  render();
}

function catchUno(pid, targetId) {
  const p = byPid(pid), t = byId(targetId);
  if (S.screen !== 'play' || !p || !t || p === t || S.unoVictim !== t.id || t.hand.length !== 1) return;
  giveCards(t, 2);
  setEvent(`🚨 ${p.name} จับ ${t.name} ไม่ได้พูด UNO! — ${t.name} จั่ว 2 ใบ`, 'hit', `${p.name} caught ${t.name} not saying UNO — ${t.name} draws 2`);
  render();
}

/** คนสร้างห้องข้ามตาคนที่ไม่อยู่ (จั่วให้ 1 ใบ หรือรับ +2/+4 ที่ค้างอยู่) */
function skipTurn() {
  const p = current();
  if (S.screen !== 'play') return;
  if (S.drawn != null) return pass(p.pid);
  const n = S.pending || 1;
  giveCards(p, n);
  S.pending = 0;
  setEvent(`ข้ามตา ${p.name} (จั่ว ${n} ใบ)`, '', `Skipped ${p.name}'s turn (drew ${n})`);
  advance();
  render();
}

/** หมดมือ: ได้แต้มเท่ากับไพ่ที่เหลือในมือของทุกคน */
function endRound(winner) {
  S.winner = winner.id;
  S.roundPoints = S.players.reduce((a, p) => a + p.hand.reduce((b, c) => b + cardPoints(c), 0), 0);
  S.scores[winner.pid] = (S.scores[winner.pid] || 0) + S.roundPoints;
  S.screen = 'end';
  render();
}

// ---------- หน้าจอของแต่ละคน (ส่งให้เฉพาะเจ้าตัว) ----------
function viewFor(p) {
  if (S.screen === 'lobby') return { phase: 'lobby', name: p.name, count: S.joined.length };
  if (S.screen === 'end') {
    const w = byId(S.winner);
    return {
      phase: 'end', winnerName: w.name, won: w === p, points: S.roundPoints,
      results: S.players.map(o => ({
        name: o.name, isMe: o === p, won: o === w, hand: o.hand,
        pts: o.hand.reduce((a, c) => a + cardPoints(c), 0), score: S.scores[o.pid] || 0,
      })).sort((a, b) => b.score - a.score),
    };
  }
  const myTurn = current() === p;
  return {
    phase: 'play', key: roundKey(),
    me: {
      id: p.id, name: p.name, saidUno: p.saidUno,
      hand: p.hand.map(c => ({ ...c, ok: myTurn && canPlay(c) })),
    },
    myTurn, turnName: current().name,
    top: topCard(), color: S.color, dir: S.dir, pending: S.pending, stack: S.settings.stack,
    drawn: myTurn ? S.drawn : null, deckCount: S.deck.length,
    players: S.players.map(o => ({
      id: o.id, name: o.name, count: o.hand.length, turn: o === current(), isMe: o === p,
      uno: o.hand.length === 1, catchable: S.unoVictim === o.id && o !== p, score: S.scores[o.pid] || 0,
    })),
    event: S.event,
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
const meUI = createUnoUI(action => setTimeout(() => handleAction(HOST_PID, action)));

function render() {
  if (S.screen === 'home') $app.innerHTML = homeView();
  else if (S.screen === 'lobby') $app.innerHTML = lobbyView();
  else {
    $app.innerHTML = `<section id="me" class="uno-me-panel"></section>${hostBar()}`;
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
      <div class="uno-logo">UNO</div>
      <h1>อูโน่${enLine('UNO')}</h1>
      <p>ลงไพ่ให้ตรงสีหรือตัวเลข ใช้ไพ่พิเศษป่วนเพื่อน แล้วอย่าลืมกด UNO! ตอนเหลือใบสุดท้าย${enLine('Match the color or number, mess with friends using action cards, and don\'t forget to call UNO on your last card!')}</p>
    </section>

    <section class="panel home-card">
      <h3>🏠 สร้างห้องใหม่ <small>Create a room</small></h3>
      <input type="text" id="create-name" placeholder="ชื่อของคุณ · Your name" maxlength="20" value="${esc(S.name)}" autocomplete="nickname">
      ${S.error ? `<p class="warn">⚠️ ${esc(S.error)}</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="create">สร้างห้อง${enLine('Create room')}</button>
      <small class="muted">ได้เลขห้อง 6 หลักให้เพื่อนกรอก · คุณเล่นด้วย ไม่ต้องมีคนคุมเกม${enLine('You get a 6-digit room code for friends · you play too, no game master needed')}</small>
    </section>

    <section class="panel home-card">
      <h3>🔑 เข้าร่วมห้อง <small>Join a room</small></h3>
      <form id="join-room" class="stack">
        <input type="text" name="code" maxlength="6" placeholder="เลขห้อง · Room code" autocapitalize="characters" autocomplete="off">
        <input type="text" name="name" placeholder="ชื่อของคุณ · Your name" maxlength="20" autocomplete="nickname">
        <button class="btn-block btn-big" type="submit">เข้าร่วม${enLine('Join')}</button>
      </form>
    </section>`;
}

function lobbyView() {
  const n = S.joined.length;
  const st = S.settings;
  const join = Net.error ? `<p class="warn">⚠️ ${Net.error}</p>`
    : !Net.room ? '<p class="muted">กำลังเปิดห้อง… · Opening room…</p>'
    : `<div class="join-box">
        <div id="qr" class="qr" data-url="${esc(Net.joinUrl())}"></div>
        <div class="join-info">
          <p>เลขห้อง · Room code</p>
          <b class="room-code big">${Net.room}</b>
          <p class="muted">ให้เพื่อนเปิดเว็บนี้ › เข้าร่วมห้อง › กรอกเลขห้อง หรือสแกน QR${enLine('Friends open this site › Join a room › enter the code, or scan the QR')}</p>
          <code>${esc(Net.joinUrl())}</code>
        </div>
      </div>`;
  const problem = n < MIN_PLAYERS ? `ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน (ตอนนี้ ${n} คน)${enLine(`Need at least ${MIN_PLAYERS} players (now ${n})`)}`
    : n > MAX_PLAYERS ? `เล่นได้ไม่เกิน ${MAX_PLAYERS} คน (ตอนนี้ ${n} คน)${enLine(`At most ${MAX_PLAYERS} players (now ${n})`)}` : '';
  return `
    <button class="btn-ghost small-btn back-home" data-act="close">← ปิดห้อง · Close room</button>
    <section class="panel">
      <strong>ผู้เล่น (${n} คน) · Players (${n})</strong>
      ${join}
      <p class="muted small">เรียงตามที่นั่งรอบวง (ลำดับการเล่น)${enLine('Order by seats around the table (turn order)')}</p>
      <div class="name-list">
        ${S.joined.map((j, i) => `
          <div class="row name-row">
            <span class="seat">${i + 1}</span>
            <span class="grow lobby-name"><i class="dot ${j.online ? 'on' : ''}"></i>${esc(j.name)}${j.local ? ' <small class="muted">· คุณ · you</small>' : ''}${S.scores[j.pid] ? ` <small class="uno-pts">${S.scores[j.pid]} แต้ม · pts</small>` : ''}</span>
            <button class="icon-btn" data-act="seat" data-i="${i}" data-d="-1" aria-label="เลื่อนขึ้น · Move up">↑</button>
            <button class="icon-btn" data-act="seat" data-i="${i}" data-d="1" aria-label="เลื่อนลง · Move down">↓</button>
            ${j.local ? '<span class="icon-btn"></span>' : `<button class="icon-btn" data-act="kick" data-pid="${j.pid}" aria-label="ลบ · Remove">✕</button>`}
          </div>`).join('')}
      </div>
    </section>

    <section class="panel uno-settings">
      <strong>กติกา · Rules</strong>
      <label>ไพ่เริ่มต้นในมือ · Starting hand
        <select data-setting="handSize">${[5, 7, 10].map(h =>
          `<option value="${h}" ${st.handSize === h ? 'selected' : ''}>${h} ใบ · cards</option>`).join('')}</select></label>
      <label class="uno-check"><input type="checkbox" data-setting="stack" ${st.stack ? 'checked' : ''}>
        <span>ซ้อน +2 / +4 ได้ · Stack +2 / +4<small>โดน +2 แล้วลง +2 หรือ +4 ส่งต่อให้คนถัดไปได้ ยอดจั่วสะสมไปเรื่อย ๆ${enLine('Hit by +2? Play a +2 or +4 to pass it on — the total keeps growing')}</small></span></label>
      <label class="uno-check"><input type="checkbox" data-setting="drawUntil" ${st.drawUntil ? 'checked' : ''}>
        <span>จั่วจนกว่าจะได้ใบที่ลงได้ · Draw until playable<small>ปิดไว้ = จั่วแค่ 1 ใบ ถ้าลงได้ลงเลยหรือเก็บไว้ก็ได้${enLine('Off = draw just 1 card; play it if you can, or keep it')}</small></span></label>
      ${Object.keys(S.scores).length ? '<button class="small-btn" data-act="reset-scores">🧹 ล้างแต้มสะสม · Reset scores</button>' : ''}
    </section>

    <div class="start-bar">
      ${problem ? `<p class="warn">${problem}</p>` : ''}
      <button class="btn-primary btn-block btn-big" data-act="start" ${problem ? 'disabled' : ''}>🃏 เริ่มเกม · แจกไพ่${enLine('Start game · deal cards')}</button>
    </div>`;
}

function hostBar() {
  if (S.screen === 'end') {
    return `<div class="uno-hostbar">
      <button class="btn-primary" data-act="again">🔁 เล่นรอบต่อไป · Next round</button>
      <button data-act="to-lobby">⚙️ กลับห้อง (เปลี่ยนตั้งค่า) · Back to room</button>
    </div>`;
  }
  return `<div class="uno-hostbar">
    <small class="muted">ควบคุมห้อง · Host:</small>
    <button data-act="skip-turn">⏭ ข้ามตา · Skip ${esc(current().name)}</button>
    <button data-act="abort">⏹ เลิกรอบนี้ · Abort round</button>
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
  if (a.type === 'play') play(pid, Number(a.card), a.color);
  else if (a.type === 'draw') draw(pid);
  else if (a.type === 'pass') pass(pid);
  else if (a.type === 'uno') callUno(pid);
  else if (a.type === 'catch') catchUno(pid, Number(a.target));
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
      if (!name) { S.error = 'ใส่ชื่อของคุณก่อน · Enter your name first'; return render(); }
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
      if (S.joined.some(j => !j.local) && !confirm('ปิดห้องนี้? เพื่อนในห้องจะต้องเข้าห้องใหม่\nClose this room? Friends will need to join a new one.')) return;
      Net.stop();
      setInRoom(false);
      S.joined = [];
      S.scores = {};
      S.screen = 'home';
      render();
    },
    kick() { if (confirm('ลบผู้เล่นคนนี้ออกจากห้อง?\nRemove this player from the room?')) Net.kick(btn.dataset.pid); },
    seat() {
      const i = Number(btn.dataset.i), j = i + Number(btn.dataset.d);
      if (j < 0 || j >= S.joined.length) return;
      [S.joined[i], S.joined[j]] = [S.joined[j], S.joined[i]];
      render();
    },
    'reset-scores'() { S.scores = {}; render(); },
    start: startRound,
    again: startRound,
    'to-lobby'() { S.screen = 'lobby'; render(); },
    'skip-turn'() { if (confirm(`ข้ามตาของ ${current().name}? (จั่วให้แทน)\nSkip ${current().name}'s turn? (draws for them)`)) skipTurn(); },
    abort() { if (confirm('เลิกรอบนี้ แล้วกลับไปหน้าห้อง? (ไม่มีใครได้แต้ม)\nAbort this round and go back to the room? (no points)')) { S.screen = 'lobby'; render(); } },
  };
  ACTIONS[act]?.();
});

document.addEventListener('change', e => {
  const key = e.target.dataset.setting;
  if (!key) return;
  S.settings[key] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
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
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return warn('เลขห้องไม่ถูกต้อง — ให้ถามเลขห้องจากคนสร้างห้อง · Invalid room code — ask the host for it');
  if (!name) return warn('ใส่ชื่อของคุณก่อน · Enter your name first');
  location.href = `play.html?room=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
});

window.addEventListener('beforeunload', e => {
  if (S.screen === 'play') { e.preventDefault(); e.returnValue = ''; }
});

if (S.screen === 'lobby') { syncHostEntry(); Net.start().then(render); }
render();
