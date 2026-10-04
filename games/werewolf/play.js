'use strict';
// หน้าเข้าร่วมเกมบนมือถือ (โหมดหลายเครื่อง)
// เชื่อมต่อผ่าน Supabase (ถ้าตั้งค่าไว้ใน assets/config.js) หรือ server.py บนเครื่อง
// มือถือแค่แสดงหน้าจอที่เจ้าห้องส่งมา — ไม่มีข้อมูลบทบาทของคนอื่นอยู่ในเครื่องนี้

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);



// ---------- หน้าจอ ----------
const state = { joined: false, error: '', room: (params.get('room') || '').toUpperCase(), name: params.get('name') || '', busy: false };
const ui = createPlayerUI(action => PNet.sendAction(action));

function setPhase(view) {
  document.body.dataset.phase = !view ? 'setup' : view.phase === 'night' ? 'night' : view.phase === 'day' ? 'day' : 'setup';
}

function renderJoin() {
  setPhase(null);
  $app.innerHTML = `
    <a href="./" class="btn btn-ghost small-btn">← กลับ</a>
    <section class="hero">
      <div class="hero-moon"></div>
      <h1>เข้าร่วมเกม</h1>
      <p>ใส่ชื่อของคุณเพื่อเข้าร่วมวง</p>
    </section>
    <form class="panel stack" id="join-form">
      <label class="field">เลขห้อง<input type="text" name="room" maxlength="6" autocapitalize="characters" autocomplete="off" value="${escape(state.room)}" required></label>
      <label class="field">ชื่อของคุณ<input type="text" name="name" maxlength="20" autocomplete="nickname" value="${escape(state.name)}" required autofocus></label>
      ${state.error ? `<p class="warn">⚠️ ${escape(state.error)}</p>` : ''}
      <button class="btn-primary btn-block btn-big" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'กำลังเข้าร่วม…' : 'เข้าร่วม'}</button>
    </form>`;
}

function showGame() {
  if (ui.el !== $app) ui.mount($app);
  if (!ui.view) ui.setView({ phase: 'lobby', name: PNet.name });
}

PNet.onView = view => {
  setPhase(view);
  showGame();
  ui.setView(view.phase === 'lobby' ? { ...view, name: view.name || PNet.name } : view);
};
PNet.onGone = msg => {
  state.joined = false;
  state.error = msg;
  ui.view = null;
  ui.el = null;
  $app.onclick = null;
  renderJoin();
};
PNet.onConn = on => { $conn.textContent = on ? '' : '⚠️ ขาดการเชื่อมต่อ'; };

document.addEventListener('submit', async e => {
  if (e.target.id !== 'join-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  state.room = String(f.get('room')).trim().toUpperCase();
  state.busy = true;
  renderJoin();
  const r = await PNet.join(state.room, String(f.get('name')).trim());
  state.busy = false;
  if (!r.ok) { state.error = r.error; return renderJoin(); }
  state.error = '';
  state.joined = true;
  showGame();
});

// เปิดหน้าจอค้างไว้ระหว่างเล่น
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); }
});
document.addEventListener('click', keepAwake, { once: true });

// ---------- เสียงพากย์ตามเครื่องคนสร้างห้อง ----------
const Narr = {
  queue: [],
  playing: false,
  gen: 0,
  muted: (() => { try { return localStorage.getItem('werewolf.mute') === '1'; } catch { return false; } })(),
  hideTimer: null,
};
Voice.cfg = () => ({ voice: !Narr.muted, rate: 1, voiceURI: '' });

const $narr = document.getElementById('narr');
const $mute = document.getElementById('mute');
const $unlock = document.getElementById('unlock');

function showNarr(say) {
  clearTimeout(Narr.hideTimer);
  $narr.hidden = false;
  $narr.querySelector('.narr-th').textContent = say.sub || '';
  $narr.querySelector('.narr-en').textContent = say.subEn || '';
}

function onSay(say) {
  if (say.kind === 'hush') {
    Narr.queue = [];
    Narr.gen += 1;
    Voice.stop();
    return;
  }
  Narr.queue.push(say);
  if (Narr.queue.length > 3) Narr.queue.shift();  // ตามไม่ทันก็ข้ามบรรทัดเก่า
  pumpNarr();
}

async function pumpNarr() {
  if (Narr.playing) return;
  Narr.playing = true;
  while (Narr.queue.length) {
    const say = Narr.queue.shift();
    const gen = Narr.gen;
    showNarr(say);
    for (const part of say.parts || []) {
      if (gen !== Narr.gen) break;
      await Voice.speak(part);
      if (!Voice.blocked) $unlock.hidden = true;  // เล่นเสียงได้แล้ว ซ่อนปุ่มเปิดเสียง
    }
  }
  Narr.playing = false;
  Narr.hideTimer = setTimeout(() => { $narr.hidden = true; }, 2500);
}

function renderMute() {
  $mute.textContent = Narr.muted ? '🔇' : '🔊';
  $mute.title = Narr.muted ? 'เปิดเสียงพากย์' : 'ปิดเสียงพากย์';
}
$mute.addEventListener('click', () => {
  Narr.muted = !Narr.muted;
  try { localStorage.setItem('werewolf.mute', Narr.muted ? '1' : '0'); } catch { /* ignore */ }
  if (Narr.muted) Voice.stop(); else Voice.unlock();
  renderMute();
});
renderMute();

// เบราว์เซอร์มือถือไม่ให้เล่นเสียงจนกว่าจะแตะหน้าจอ: ปลดล็อกตอนแตะครั้งแรก หรือกดแถบด้านบน
Voice.onBlocked = () => { if (!Narr.muted) $unlock.hidden = false; };
$unlock.addEventListener('click', () => { Voice.unlock(); $unlock.hidden = true; });
document.addEventListener('click', () => Voice.unlock(), { once: true });

PNet.onSay = onSay;

// ---------- เริ่ม: ถ้าเคยเข้าห้องนี้แล้ว ให้กลับเข้าห้องเดิมเลย ----------
(async () => {
  renderJoin();
  if (state.room && await PNet.resume(state.room)) {
    state.joined = true;
    return showGame();
  }
  // มาจากหน้า "เข้าร่วมห้อง" ที่กรอกเลขห้องและชื่อไว้แล้ว: เข้าร่วมให้เลย
  if (state.room && state.name) document.getElementById('join-form').requestSubmit();
})();
