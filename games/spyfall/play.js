'use strict';
// หน้าเข้าร่วมเกมสายลับบนมือถือ
// มือถือได้รับเฉพาะหน้าจอของตัวเอง (สถานที่จริงส่งมาเฉพาะคนที่ไม่ใช่สายลับ)

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);

const state = { joined: false, error: '', room: (params.get('room') || '').toUpperCase(), name: params.get('name') || '', busy: false };
const ui = createSpUI(action => PNet.sendAction(action));

function renderJoin() {
  $app.innerHTML = `
    <a href="./" class="btn btn-ghost small-btn">← กลับ</a>
    <section class="hero">
      <div class="sp-logo">🕵️</div>
      <h1>เข้าร่วมเกม</h1>
      <p>ใส่เลขห้องและชื่อของคุณ</p>
    </section>
    <form class="panel stack" id="join-form">
      <label class="field">เลขห้อง<input type="text" name="room" maxlength="6" autocapitalize="characters" autocomplete="off" value="${esc(state.room)}" required></label>
      <label class="field">ชื่อของคุณ<input type="text" name="name" maxlength="20" autocomplete="nickname" value="${esc(state.name)}" required></label>
      ${state.error ? `<p class="warn">⚠️ ${esc(state.error)}</p>` : ''}
      <button class="btn-primary btn-block btn-big" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'กำลังเข้าร่วม…' : 'เข้าร่วม'}</button>
    </form>`;
}

function showGame() {
  if (ui.el !== $app) ui.mount($app);
  if (!ui.view) ui.setView({ phase: 'lobby', name: PNet.name });
}

PNet.onView = view => {
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
  state.room = String(f.get('room')).replace(/\s/g, '').toUpperCase();
  state.name = String(f.get('name')).trim();
  state.busy = true;
  renderJoin();
  const r = await PNet.join(state.room, state.name);
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

(async () => {
  renderJoin();
  if (state.room && await PNet.resume(state.room)) {
    state.joined = true;
    return showGame();
  }
  if (state.room && state.name) document.getElementById('join-form').requestSubmit();
})();
