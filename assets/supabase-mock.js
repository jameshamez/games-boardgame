'use strict';
// Supabase จำลองสำหรับทดสอบโหมดออนไลน์บนเครื่องเดียว (หลายแท็บในเบราว์เซอร์เดียวกัน)
// ทำงานเฉพาะเมื่อ assets/config.js ตั้ง supabaseUrl: 'mock' — ถ้าตั้งค่าจริงไว้ ไฟล์นี้ไม่ทำอะไรเลย
(() => {
  if (!window.WW_CONFIG || window.WW_CONFIG.supabaseUrl !== 'mock') return;

  function channel(name, opts) {
    const bc = new BroadcastChannel(`mock-${name}`);
    const handlers = [];
    const presence = {};
    const myKey = opts && opts.config && opts.config.presence && opts.config.presence.key;
    let tracked = false;
    const emitPresence = () => handlers.filter(h => h.type === 'presence').forEach(h => h.cb());
    const ch = {
      on(type, filter, cb) { handlers.push({ type, event: filter.event, cb }); return ch; },
      subscribe(cb) {
        setTimeout(() => { cb('SUBSCRIBED'); bc.postMessage({ kind: 'presence-req' }); }, 30);
        return ch;
      },
      send(msg) {
        bc.postMessage({ kind: 'broadcast', event: msg.event, payload: msg.payload });
        return Promise.resolve('ok');
      },
      track() {
        tracked = true;
        presence[myKey] = [{}];
        bc.postMessage({ kind: 'presence', key: myKey, on: true });
        emitPresence();
        return Promise.resolve('ok');
      },
      presenceState() { return { ...presence }; },
      close() {
        if (tracked) bc.postMessage({ kind: 'presence', key: myKey, on: false });
        bc.close();
      },
    };
    bc.onmessage = ({ data }) => {
      if (data.kind === 'broadcast') {
        handlers.filter(h => h.type === 'broadcast' && h.event === data.event).forEach(h => h.cb({ payload: data.payload }));
      } else if (data.kind === 'presence') {
        if (data.on) presence[data.key] = [{}]; else delete presence[data.key];
        emitPresence();
      } else if (data.kind === 'presence-req' && tracked) {
        bc.postMessage({ kind: 'presence', key: myKey, on: true });
      }
    };
    window.addEventListener('pagehide', () => ch.close());
    return ch;
  }

  window.supabase = { createClient: () => ({ channel, removeChannel: ch => ch.close() }) };
})();
