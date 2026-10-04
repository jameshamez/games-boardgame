'use strict';
// การเชื่อมต่อแบบใช้ server.py บนเครื่อง (ทุกคนต่อ Wi-Fi เดียวกัน หรือ server.py --public)
// LocalHostNet = เครื่องคนสร้างห้อง, LocalPlayerNet = มือถือผู้เล่น
// ต้องโหลดหลัง net-cloud.js — ถ้าตั้งค่า Supabase ไว้ จะใช้โหมดออนไลน์แทน
// เครื่องหลักเป็นคนคุมเกม: ส่ง "หน้าจอ" ของแต่ละคนขึ้นเซิร์ฟเวอร์ และรับการกดจากมือถือกลับมา

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const LocalHostNet = {
  kind: 'local',
  key: null,
  room: null,
  lan: null,
  public: null,       // ลิงก์สาธารณะ (เมื่อรัน server.py --public)
  seq: 0,
  timer: null,
  lastViews: '',
  error: '',
  onLobby: () => {},          // เรียกเมื่อรายชื่อผู้เล่นเปลี่ยน
  onAction: () => {},         // เรียกเมื่อมือถือส่งการกดมา (pid, action)

  get active() { return !!this.timer; },

  async start() {
    if (this.timer) return;
    try {
      this.key = sessionStorage.getItem(`${ROOM_NS.store}.hostKey`);
    } catch { /* ignore */ }
    try {
      const info = await api('GET', '/api/info');
      const r = await api('POST', '/api/host/new', { key: this.key });
      this.lan = info.lan;
      this.public = info.public;
      this.room = r.room;
      this.key = r.key;
      this.error = '';
      try { sessionStorage.setItem(`${ROOM_NS.store}.hostKey`, this.key); } catch { /* ignore */ }
    } catch {
      this.error = 'ต้องเปิดเกมผ่าน python3 server.py บน Mac ก่อน จึงจะเล่นหลายเครื่องได้';
      this.onLobby();
      return;
    }
    this.lastViews = '';
    this.skipOld = true;  // ไม่เอาการกดเก่าที่ค้างอยู่ก่อนเครื่องหลักเปิดหน้านี้
    this.timer = setInterval(() => this.poll(), 600);
    this.poll();
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },

  async poll() {
    let r;
    try { r = await api('GET', `/api/host/poll?key=${this.key}&since=${this.seq}`); } catch { return; }
    if (r.error === 'badkey') { this.stop(); this.key = null; return this.start(); }
    // รักษาลำดับที่นั่งที่เครื่องหลักจัดไว้ เพิ่มคนใหม่ต่อท้าย และตัดคนที่ออกไปแล้ว
    const byPid = Object.fromEntries(r.players.map(p => [p.pid, p]));
    const before = JSON.stringify(S.joined);
    S.joined = S.joined.filter(j => j.local || byPid[j.pid]).map(j => (j.local ? j : { ...j, ...byPid[j.pid] }));
    r.players.forEach(p => { if (!S.joined.some(j => j.pid === p.pid)) S.joined.push(p); });
    // ลิงก์สาธารณะอาจพร้อมช้ากว่าเซิร์ฟเวอร์ไม่กี่วินาที
    const pubChanged = (r.public || null) !== this.public;
    this.public = r.public || null;
    if (JSON.stringify(S.joined) !== before || pubChanged) this.onLobby();
    for (const a of r.actions) {
      this.seq = Math.max(this.seq, a.seq);
      if (!this.skipOld) this.onAction(a.pid, a.action || {});
    }
    this.skipOld = false;
  },

  publish(views) {
    if (!this.timer) return;
    const body = JSON.stringify(views);
    if (body === this.lastViews) return;
    this.lastViews = body;
    api('POST', '/api/host/views', { key: this.key, views }).catch(() => { this.lastViews = ''; });
  },

  say(say) {
    if (!this.timer) return;
    api('POST', '/api/host/say', { key: this.key, say }).catch(() => {});
  },

  kick(pid) {
    S.joined = S.joined.filter(j => j.pid !== pid);
    api('POST', '/api/host/kick', { key: this.key, pid });
    this.onLobby();
  },

  joinUrl() {
    const dir = location.pathname.replace(/[^/]*$/, '');
    return `${this.public || this.lan}${dir}play.html?room=${this.room}`;
  },
};

// ---------- มือถือผู้เล่น ----------
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
  onSay: () => {},
  lastSay: null,      // null = ยังไม่เคยถาม (ข้ามบทพากย์เก่าที่ค้างอยู่)

  async api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  },

  saved() { try { return JSON.parse(localStorage.getItem(`${ROOM_NS.store}.player`) || 'null'); } catch { return null; } },
  save(v) { try { localStorage.setItem(`${ROOM_NS.store}.player`, JSON.stringify(v)); } catch { /* ignore */ } },

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
      const { status, data } = await this.api('GET', `/api/view?pid=${this.pid}&token=${this.token}&v=${this.v ?? ''}&say=${this.lastSay ?? 0}`);
      this.onConn(true);
      for (const say of data.says || []) {
        if (this.lastSay !== null) this.onSay(say);
        this.lastSay = Math.max(this.lastSay || 0, say.seq);
      }
      if (this.lastSay === null) this.lastSay = 0;
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

// ใช้โหมดออนไลน์ถ้าตั้งค่า Supabase ไว้ใน assets/config.js
const Net = CLOUD.enabled ? CloudHostNet : LocalHostNet;
const PNet = CLOUD.enabled ? CloudPlayerNet : LocalPlayerNet;
