'use strict';
// หน้าจอผู้เล่นของเกมคำต้องห้าม — ใช้ทั้งบนมือถือ (play.html) และบนเครื่องคนสร้างห้อง (index.html)
// แสดงคำของคนอื่น แต่ไม่เคยได้รับคำของตัวเอง (เครื่องคนสร้างห้องส่งมาให้แบบเข้ารหัสเฉพาะคน)

function createFwUI(send) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = {
    el: null,
    view: null,
    receivedAt: 0,
    confirm: null,      // id ของคนที่กำลังยืนยันว่าจะจับ
    pending: null,      // id ของคนที่กดจับแล้ว กำลังรอเครื่องคนสร้างห้องยืนยัน
    lastEvent: 0,       // เหตุการณ์ "จับได้" ล่าสุดที่แสดงไปแล้ว
    overlayUntil: 0,
    timer: null,
  };

  U.mount = el => {
    U.el = el;
    el.onclick = onClick;
    U.render();
  };

  U.setView = view => {
    const ev = view.event;
    const firstView = !U.view;
    U.view = view;
    U.receivedAt = Date.now();
    if (ev && ev.seq > U.lastEvent) {
      U.lastEvent = ev.seq;
      // เหตุการณ์ที่เกิดก่อนเปิดหน้านี้ ไม่ต้องเด้งขึ้นมา
      if (!firstView) {
        U.overlayUntil = Date.now() + 4000;
        buzz(ev.targetIsMe);
        setTimeout(() => U.render(), 4100);
      }
    }
    if (U.confirm != null && !(view.others || []).some(o => o.id === U.confirm && o.alive)) U.confirm = null;
    U.pending = null;
    U.render();
  };

  U.render = () => {
    if (!U.el || !U.view) return;
    U.el.innerHTML = (VIEWS[U.view.phase] || VIEWS.lobby)(U.view);
    tick();
  };

  // ---------- นาฬิกานับถอยหลัง (นับเองในเครื่อง ไม่ต้องรอเครื่องคนสร้างห้อง) ----------
  function remainingMs() {
    const v = U.view;
    if (!v || v.remaining == null) return null;
    return Math.max(0, v.paused ? v.remaining : v.remaining - (Date.now() - U.receivedAt));
  }
  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function tick() {
    const el = U.el && U.el.querySelector('[data-fw-timer]');
    if (!el) return;
    const ms = remainingMs();
    el.textContent = ms == null ? '∞' : fmt(ms);
    el.classList.toggle('low', ms != null && ms <= 30000);
  }
  U.timer = setInterval(tick, 500);

  // ---------- เสียงเตือนเมื่อมีคนโดนจับ ----------
  let audioCtx = null;
  function buzz(me) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [0, 0.18, 0.36].forEach((d, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.value = me ? 220 - i * 40 : 660 + i * 110;
        g.gain.setValueAtTime(0.12, t + d);
        g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + d);
        o.stop(t + d + 0.17);
      });
    } catch { /* ไม่มีเสียงก็ไม่เป็นไร */ }
    if (navigator.vibrate) navigator.vibrate(me ? [300, 100, 300] : [120, 60, 120]);
  }
  // เบราว์เซอร์มือถือต้องแตะก่อนถึงจะเล่นเสียงได้
  document.addEventListener('click', () => {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* ignore */ }
  }, { once: true });

  function onClick(e) {
    const btn = e.target.closest('[data-fw]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.fw;
    const id = Number(btn.dataset.id);
    if (act === 'dismiss') { U.overlayUntil = 0; return U.render(); }
    if (act === 'ask') { U.confirm = id; return U.render(); }
    if (act === 'cancel') { U.confirm = null; return U.render(); }
    if (act === 'catch') {
      U.confirm = null;
      U.pending = id;
      U.render();
      setTimeout(() => { if (U.pending === id) { U.pending = null; U.render(); } }, 5000);
      return send({ key: U.view.key, type: 'catch', target: id });
    }
  }

  // ---------- หน้าจอ ----------
  function overlay(v) {
    const ev = v.event;
    if (!ev || Date.now() > U.overlayUntil) return '';
    if (ev.targetIsMe) {
      return `<div class="fw-overlay me" data-fw="dismiss"><div class="fw-ov-icon">😱</div>
        <h2>คุณโดนจับ!</h2>
        <p>คำต้องห้ามของคุณคือ</p><div class="fw-ov-word">“${esc(ev.word)}”</div>
        <p class="muted">${esc(ev.catcherName)} จับได้${v.mode === 'score' ? ' · คุณได้คำใหม่แล้ว ระวังอีก!' : ''}</p></div>`;
    }
    return `<div class="fw-overlay" data-fw="dismiss"><div class="fw-ov-icon">🚨</div>
      <h2>${ev.catcherIsMe ? 'คุณ' : esc(ev.catcherName)} จับ ${esc(ev.targetName)} ได้!</h2>
      <p>พูดคำว่า</p><div class="fw-ov-word">“${esc(ev.word)}”</div></div>`;
  }

  function playerCard(o, v) {
    const canCatch = o.alive && (v.mode === 'score' || v.me.alive) && !v.paused;
    if (U.confirm === o.id && canCatch) {
      return `<div class="fw-card confirm">
        <div class="fw-name">${esc(o.name)}</div>
        <p>พูดคำว่า <b>“${esc(o.word)}”</b> ใช่ไหม?</p>
        <div class="fw-row">
          <button data-fw="cancel">ยกเลิก</button>
          <button class="btn-primary" data-fw="catch" data-id="${o.id}">🚨 ใช่ จับเลย</button>
        </div></div>`;
    }
    return `<div class="fw-card ${o.alive ? '' : 'out'}">
      <div class="fw-name">${esc(o.name)}${v.mode === 'score' ? ` <small>${o.score} แต้ม</small>` : ''}</div>
      <div class="fw-word">${esc(o.word)}</div>
      ${o.alive && U.pending === o.id ? '<div class="fw-out">⏳ กำลังส่ง…</div>'
        : o.alive ? `<button class="fw-catch" data-fw="ask" data-id="${o.id}" ${canCatch ? '' : 'disabled'}>🚨 จับได้!</button>`
        : '<div class="fw-out">ตกรอบแล้ว</div>'}
    </div>`;
  }

  const VIEWS = {
    lobby(v) {
      return `
        <div class="fw-stage">
          <div class="fw-big">🤫</div>
          <h2>สวัสดี ${esc(v.name || '')}</h2>
          <p class="muted">เข้าร่วมแล้ว — รอคนสร้างห้องเริ่มเกม${v.count ? ` (ตอนนี้ ${v.count} คน)` : ''}</p>
        </div>
        <div class="panel fw-rules">
          <strong>วิธีเล่น</strong>
          <ol>
            <li>ทุกคนได้ <b>คำต้องห้าม</b> คนละคำ — คุณเห็นคำของคนอื่น แต่ <b>ไม่รู้คำของตัวเอง</b></li>
            <li>คุยเล่นกันตามปกติ แล้วพยายามหลอกให้คนอื่นพูดคำของเขาออกมา</li>
            <li>ใครพูดคำของตัวเองออกมา ให้กด <b>🚨 จับได้!</b> ที่ชื่อคนนั้น</li>
            <li>ระวังปาก! คุณไม่รู้ว่าคำไหนที่ห้ามพูด</li>
          </ol>
        </div>`;
    },

    play(v) {
      const me = v.me;
      const alive = (v.others || []).filter(o => o.alive).length + (me.alive ? 1 : 0);
      return `${overlay(v)}
        <div class="fw-top">
          <div class="fw-timer" data-fw-timer>--:--</div>
          <div class="fw-meta">${v.paused ? '⏸ หยุดชั่วคราว' : v.mode === 'score' ? '🏆 โหมดนับแต้ม' : `👥 เหลือ ${alive} คน`}</div>
        </div>
        <div class="fw-me ${me.alive ? '' : 'out'}">
          <div class="fw-me-label">${esc(me.name)} · คำของคุณ</div>
          ${me.alive
            ? `<div class="fw-me-word">❓❓❓</div><div class="fw-me-hint">ระวังปาก! คุณไม่รู้ว่าคำไหนห้ามพูด</div>`
            : `<div class="fw-me-word">“${esc(me.word)}”</div><div class="fw-me-hint">คุณตกรอบแล้ว — นั่งดูเพื่อนต่อได้ ห้ามบอกใบ้!</div>`}
          ${v.mode === 'score' ? `<div class="fw-me-score">${me.score} แต้ม · จับได้ ${me.catches} ครั้ง</div>` : ''}
        </div>
        <div class="fw-grid">${(v.others || []).map(o => playerCard(o, v)).join('')}</div>`;
    },

    end(v) {
      const winners = v.results.filter(r => r.win).map(r => esc(r.name));
      return `
        <div class="fw-stage">
          <div class="fw-big pop">🏆</div>
          <h2>${winners.length ? `${winners.join(', ')} ชนะ!` : 'จบเกม'}</h2>
          <p class="muted">${v.mode === 'score' ? 'แต้มมากที่สุดชนะ' : 'คนที่รอดจนจบชนะ'}</p>
        </div>
        <div class="panel"><strong>สรุปผล</strong>
          <div class="fw-results">${v.results.map((r, i) => `
            <div class="fw-res ${r.win ? 'win' : ''} ${r.alive ? '' : 'out'}">
              <span class="fw-rank">${r.win ? '🏆' : i + 1}</span>
              <span class="fw-res-name">${esc(r.name)}${r.isMe ? ' (คุณ)' : ''}</span>
              <span class="fw-res-score">${v.mode === 'score' ? `${r.score} แต้ม` : r.alive ? 'รอด' : 'ตกรอบ'}</span>
              <span class="fw-res-word">${r.words.map(w => `“${esc(w)}”`).join(' ')}</span>
            </div>`).join('')}
          </div>
        </div>
        <p class="muted" style="text-align:center">รอคนสร้างห้องเริ่มรอบใหม่…</p>`;
    },
  };

  return U;
}
