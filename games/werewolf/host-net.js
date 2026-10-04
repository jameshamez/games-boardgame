'use strict';
// การเชื่อมต่อของเครื่องหลัก (โหมดเล่นหลายเครื่อง)
// LocalHostNet ใช้กับ server.py บนเครื่อง ส่วนโหมดออนไลน์ (Supabase) อยู่ใน net-cloud.js
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
      this.key = sessionStorage.getItem('werewolf.hostKey');
    } catch { /* ignore */ }
    try {
      const info = await api('GET', '/api/info');
      const r = await api('POST', '/api/host/new', { key: this.key });
      this.lan = info.lan;
      this.public = info.public;
      this.room = r.room;
      this.key = r.key;
      this.error = '';
      try { sessionStorage.setItem('werewolf.hostKey', this.key); } catch { /* ignore */ }
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

  kick(pid) {
    S.joined = S.joined.filter(j => j.pid !== pid);
    api('POST', '/api/host/kick', { key: this.key, pid });
    this.onLobby();
  },

  joinUrl() {
    return `${this.public || this.lan}/games/werewolf/play.html?room=${this.room}`;
  },
};

// ใช้โหมดออนไลน์ถ้าตั้งค่า Supabase ไว้ใน assets/config.js
const Net = CLOUD.enabled ? CloudHostNet : LocalHostNet;
