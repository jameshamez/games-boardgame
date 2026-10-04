'use strict';
// โหมดออนไลน์ผ่าน Supabase Realtime — ไม่ต้องมีเซิร์ฟเวอร์ของเราเอง (โฮสต์บน Vercel ได้)
// ทุกเครื่องคุยกันในห้อง (channel) เดียวกันของ Supabase
// หน้าจอของแต่ละคน (บทบาท ผลการตรวจ ฯลฯ) และการกดจากมือถือ ถูกเข้ารหัสด้วยกุญแจที่มีแค่เจ้าห้องกับผู้เล่นคนนั้น
// คนอื่นที่ฟังห้องเดียวกันอยู่จึงอ่านไม่ได้

// แต่ละเกมแยกห้องกันด้วย ROOM_NS (กำหนด window.GAME_NS ก่อนโหลดไฟล์นี้)
const ROOM_NS = Object.assign({ id: 'ww', store: 'werewolf' }, window.GAME_NS || {});

const CLOUD = (() => {
  const cfg = window.WW_CONFIG || {};
  return { enabled: !!(cfg.supabaseUrl && cfg.supabaseAnonKey), url: cfg.supabaseUrl, key: cfg.supabaseAnonKey };
})();

let sbClient = null;
function sb() {
  if (!sbClient) {
    sbClient = supabase.createClient(CLOUD.url, CLOUD.key, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return sbClient;
}

/** เลขห้อง 6 หลัก (กรอกง่ายบนมือถือ) */
function newRoomCode() {
  return String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
}
const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map(n => n.toString(16).padStart(2, '0')).join('');

// ---------- เข้ารหัส: ECDH (P-256) ตกลงกุญแจร่วม แล้วใช้ AES-GCM ----------
const b64 = buf => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const Box = {
  /** สร้าง (หรือโหลดคืน) คู่กุญแจ — stored ใช้เก็บลง storage เพื่อให้รีเฟรชแล้วยังเป็นคนเดิม */
  async keyPair(stored) {
    if (stored) {
      try {
        const priv = await crypto.subtle.importKey('jwk', stored.priv, ECDH, true, ['deriveKey']);
        return { priv, pub: stored.pub, stored };
      } catch { /* สร้างใหม่ */ }
    }
    const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    const pub = b64(await crypto.subtle.exportKey('raw', kp.publicKey));
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return { priv: kp.privateKey, pub, stored: { pub, priv } };
  },
  async shared(priv, pub) {
    const other = await crypto.subtle.importKey('raw', unb64(pub), ECDH, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: other }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), d: b64(data) };
  },
  async open(key, box) {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.d));
    return JSON.parse(new TextDecoder().decode(data));
  },
};

function storeGet(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}
function storeSet(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---------- เครื่องเจ้าห้อง ----------
const CloudHostNet = {
  kind: 'cloud',
  room: null,
  error: '',
  ch: null,
  kp: null,
  players: {},        // pid -> { name, pub, key }
  views: {},
  lastViews: '',
  version: 0,
  flushTimer: null,
  onLobby: () => {},
  onAction: () => {},

  get active() { return !!this.ch; },

  async start() {
    if (this.ch) return;
    const saved = storeGet(sessionStorage, `${ROOM_NS.store}.cloudHost`);
    this.room = (saved && saved.room) || newRoomCode();
    this.kp = await Box.keyPair(saved && saved.kp);
    storeSet(sessionStorage, `${ROOM_NS.store}.cloudHost`, { room: this.room, kp: this.kp.stored });
    this.error = '';

    const ch = sb().channel(`${ROOM_NS.id}-${this.room}`, { config: { broadcast: { self: false }, presence: { key: 'host' } } });
    ch.on('broadcast', { event: 'who' }, () => this.hello());
    ch.on('broadcast', { event: 'join' }, ({ payload }) => this.join(payload));
    ch.on('broadcast', { event: 'a' }, ({ payload }) => this.action(payload));
    ch.on('broadcast', { event: 'sync' }, () => this.flush());
    ch.on('presence', { event: 'sync' }, () => this.presence());
    this.ch = ch;
    await new Promise(resolve => {
      ch.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          ch.track({ pid: 'host' });
          this.hello();
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.error = 'เชื่อมต่อ Supabase ไม่ได้ — ตรวจสอบค่าใน assets/config.js และการเชื่อมต่ออินเทอร์เน็ต';
          this.onLobby();
          resolve();
        }
      });
    });
  },

  stop() {
    if (this.ch) sb().removeChannel(this.ch);
    this.ch = null;
  },

  send(event, payload) {
    if (this.ch) this.ch.send({ type: 'broadcast', event, payload });
  },

  // epoch เปลี่ยนทุกครั้งที่เปิดหน้าใหม่ — มือถือจะรู้ว่าต้องแนะนำตัวใหม่ (เช่นคนสร้างห้องรีเฟรชหน้า)
  epoch: newId(),
  hello() { this.send('hello', { pub: this.kp.pub, epoch: this.epoch }); },

  async join(p) {
    const pid = String(p.pid || '');
    const name = String(p.name || '').trim().slice(0, 20);
    if (!pid || !p.pub) return;
    const known = this.players[pid];
    if (known && known.pub !== p.pub) return this.send('joined', { to: pid, error: 'ตัวตนนี้ถูกใช้อยู่แล้ว' });
    if (!known) {
      if (!name) return this.send('joined', { to: pid, error: 'กรุณาใส่ชื่อ' });
      if (S.joined.some(j => j.name.trim().toLowerCase() === name.toLowerCase())) {
        return this.send('joined', { to: pid, error: 'ชื่อนี้มีคนใช้แล้ว' });
      }
      this.players[pid] = { name, pub: p.pub, key: await Box.shared(this.kp.priv, p.pub) };
      S.joined.push({ pid, name, online: true });
      this.onLobby();
    }
    this.send('joined', { to: pid, name: this.players[pid].name });
    this.flush();
  },

  async action(p) {
    const pl = this.players[p.from];
    if (!pl) return;
    let a;
    try { a = await Box.open(pl.key, p.box); } catch { return; }  // ถอดรหัสไม่ได้ = ไม่ใช่เจ้าตัวส่งมา
    this.onAction(p.from, a || {});
  },

  presence() {
    const online = new Set(Object.keys(this.ch.presenceState()));
    let changed = false;
    S.joined.forEach(j => {
      if (j.local) return;
      const on = online.has(j.pid);
      if (j.online !== on) { j.online = on; changed = true; }
    });
    if (changed) this.onLobby();
  },

  publish(views) {
    const s = JSON.stringify(views);
    this.views = views;
    if (s === this.lastViews) return;
    this.lastViews = s;
    this.flush();
  },

  /** ส่งหน้าจอทั้งหมด (เข้ารหัสแยกคน) ในข้อความเดียว — รวบหลายการเปลี่ยนแปลงที่ติดกันเป็นครั้งเดียว */
  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(async () => {
      const boxes = {};
      for (const [pid, view] of Object.entries(this.views)) {
        const pl = this.players[pid];
        if (pl) boxes[pid] = await Box.seal(pl.key, view);
      }
      this.version += 1;
      this.send('views', { v: this.version, boxes });
    }, 60);
  },

  /** บทพากย์ (ไม่เข้ารหัส เพราะทุกคนได้ยินอยู่แล้ว) */
  say(say) { this.send('say', say); },

  kick(pid) {
    delete this.players[pid];
    S.joined = S.joined.filter(j => j.pid !== pid);
    this.send('kick', { to: pid });
    this.onLobby();
  },

  joinUrl() {
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}play.html?room=${this.room}`;
  },
};

// ---------- มือถือผู้เล่น ----------
const CloudPlayerNet = {
  kind: 'cloud',
  room: '',
  name: '',
  pid: null,
  ch: null,
  kp: null,
  key: null,          // กุญแจร่วมกับเจ้าห้อง
  hostPub: null,
  hostEpoch: null,
  joined: false,
  lastV: 0,
  lastViewAt: 0,
  waiter: null,
  timer: null,
  onView: () => {},
  onGone: () => {},
  onConn: () => {},
  onSay: () => {},

  storeKey(room) { return `${ROOM_NS.store}.cloudPlayer.${room}`; },

  /** เข้าห้องอีกครั้งด้วยตัวตนเดิม (ถ้าเคยเข้าห้องนี้) */
  async resume(room) {
    const saved = storeGet(localStorage, this.storeKey(room));
    if (!saved) return false;
    const r = await this.join(room, saved.name);
    return r.ok;
  },

  async join(room, name) {
    room = String(room || '').trim().toUpperCase();
    const saved = storeGet(localStorage, this.storeKey(room));
    this.room = room;
    this.pid = (saved && saved.pid) || newId();
    this.kp = await Box.keyPair(saved && saved.kp);
    this.name = name || (saved && saved.name) || '';
    this.joined = false;
    await this.connect();
    const result = await new Promise(resolve => {
      this.waiter = resolve;
      this.send('who', {});
      setTimeout(() => resolve({ ok: false, error: 'ไม่พบห้องนี้ หรือเจ้าห้องยังไม่ได้เปิดเกม' }), 8000);
    });
    this.waiter = null;
    if (result.ok) {
      storeSet(localStorage, this.storeKey(room), { pid: this.pid, name: this.name, kp: this.kp.stored });
      this.startTimer();
    }
    return result;
  },

  async connect() {
    if (this.ch) sb().removeChannel(this.ch);
    const ch = sb().channel(`${ROOM_NS.id}-${this.room}`, { config: { broadcast: { self: false }, presence: { key: this.pid } } });
    ch.on('broadcast', { event: 'hello' }, ({ payload }) => this.hello(payload));
    ch.on('broadcast', { event: 'joined' }, ({ payload }) => {
      if (payload.to !== this.pid) return;
      if (payload.error) { this.joined = false; return this.waiter ? this.waiter({ ok: false, error: payload.error }) : this.onGone(payload.error); }
      this.joined = true;
      this.name = payload.name || this.name;
      if (this.waiter) this.waiter({ ok: true });
    });
    ch.on('broadcast', { event: 'views' }, ({ payload }) => this.views(payload));
    ch.on('broadcast', { event: 'say' }, ({ payload }) => { if (this.joined) this.onSay(payload); });
    ch.on('broadcast', { event: 'kick' }, ({ payload }) => {
      if (payload.to !== this.pid) return;
      localStorage.removeItem(this.storeKey(this.room));
      this.stop();
      this.onGone('คุณถูกลบออกจากห้อง');
    });
    this.ch = ch;
    await new Promise(resolve => {
      ch.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          ch.track({ pid: this.pid });
          this.onConn(true);
          if (this.joined) this.send('sync', {});
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.onConn(false);
          resolve();
        }
      });
    });
  },

  async hello(p) {
    if (!p.pub) return;
    if (p.pub !== this.hostPub) {
      // เจ้าห้องเปลี่ยนกุญแจ ต้องตกลงกุญแจร่วมใหม่
      this.hostPub = p.pub;
      this.key = await Box.shared(this.kp.priv, p.pub);
    }
    if (p.epoch !== this.hostEpoch) {
      // เจ้าห้องเปิดหน้าใหม่ (เช่นรีเฟรช) จำผู้เล่นไม่ได้แล้ว ต้องแนะนำตัวใหม่
      this.hostEpoch = p.epoch;
      this.lastV = 0;
      this.joined = false;
    }
    if (!this.joined) this.send('join', { pid: this.pid, name: this.name, pub: this.kp.pub });
  },

  async views(p) {
    if (!this.key || p.v <= this.lastV) return;
    const box = p.boxes && p.boxes[this.pid];
    if (!box) return;
    let view;
    try { view = await Box.open(this.key, box); } catch { return; }
    this.lastV = p.v;
    this.lastViewAt = Date.now();
    this.onView(view);
  },

  async send(event, payload) {
    if (this.ch) this.ch.send({ type: 'broadcast', event, payload });
  },

  async sendAction(action) {
    if (!this.key) throw new Error('not joined');
    this.send('a', { from: this.pid, box: await Box.seal(this.key, action) });
  },

  startTimer() {
    clearInterval(this.timer);
    // ถ้าเงียบนาน (เช่นมือถือพักหน้าจอ) ขอหน้าจอล่าสุดจากเจ้าห้องใหม่
    this.timer = setInterval(() => {
      if (!this.joined) return this.send('who', {});
      if (Date.now() - this.lastViewAt > 20000) this.send('sync', {});
    }, 5000);
  },

  stop() {
    clearInterval(this.timer);
    if (this.ch) sb().removeChannel(this.ch);
    this.ch = null;
  },
};
