'use strict';
// หน้าเข้าร่วมเกมบนมือถือ (โหมดหลายเครื่อง)
// เชื่อมต่อผ่าน Supabase (ถ้าตั้งค่าไว้ใน assets/config.js) หรือ server.py บนเครื่อง
// มือถือแค่แสดงหน้าจอที่เจ้าห้องส่งมา — ไม่มีข้อมูลบทบาทของคนอื่นอยู่ในเครื่องนี้

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);

// ---------- เชื่อมต่อกับ server.py บนเครื่อง ----------
const LocalPlayerNet = {
  kind: 'local',
  room: '',
  name: '',
  pid: null,
  token: null,
  v: null,
  timer: null,
  onView: () => {},
  onGone: () => {},
  onConn: () => {},

  async api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  },

  saved() { try { return JSON.parse(localStorage.getItem('werewolf.player') || 'null'); } catch { return null; } },
  save(v) { try { localStorage.setItem('werewolf.player', JSON.stringify(v)); } catch { /* ignore */ } },

  async resume(room) {
    const s = this.saved();
    if (!s || s.room !== room) return false;
    const r = await this.join(room, '', s);
    if (!r.ok) this.save(null);
    return r.ok;
  },

  async join(room, name, saved) {
    const body = { room, name };
    if (saved) Object.assign(body, { pid: saved.pid, token: saved.token });
    let r;
    try { r = await this.api('POST', '/api/join', body); } catch { return { ok: false, error: 'เชื่อมต่อเครื่องเจ้าห้องไม่ได้' }; }
    if (r.status !== 200) return { ok: false, error: r.data.error || 'เข้าร่วมไม่ได้' };
    Object.assign(this, { room, pid: r.data.pid, token: r.data.token, name: r.data.name, v: null });
    this.save({ room, pid: this.pid, token: this.token });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), 700);
    this.poll();
    return { ok: true };
  },

  async poll() {
    try {
      const { status, data } = await this.api('GET', `/api/view?pid=${this.pid}&token=${this.token}&v=${this.v ?? ''}`);
      this.onConn(true);
      if (status === 404) {
        clearInterval(this.timer);
        this.save(null);
        return this.onGone('คุณไม่ได้อยู่ในห้องแล้ว กรุณาเข้าร่วมใหม่');
      }
      if (data.same) return;
      this.v = data.v;
      this.onView(data.view);
    } catch {
      this.onConn(false);
    }
  },

  async sendAction(action) {
    await this.api('POST', '/api/action', { pid: this.pid, token: this.token, action });
  },
};

const PNet = CLOUD.enabled ? CloudPlayerNet : LocalPlayerNet;

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
      <label class="field">เลขห้อง<input type="text" name="room" inputmode="numeric" maxlength="6" autocapitalize="characters" autocomplete="off" value="${escape(state.room)}" required></label>
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
