'use strict';
// หน้าจอผู้เล่นของเกมสายลับ — ใช้ทั้งบนมือถือ (play.html) และบนเครื่องคนสร้างห้อง (index.html)
// แค่แสดงหน้าจอที่เครื่องคนสร้างห้องส่งมา แล้วส่งการกดกลับผ่าน send(action)

function createSpUI(send) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = {
    el: null,
    view: null,
    receivedAt: 0,
    key: '',            // รอบปัจจุบัน (ล้างสถานะในเครื่องเมื่อขึ้นรอบใหม่)
    cardOpen: false,    // เปิดดูบทบาทอยู่ไหม (ปิดไว้ก่อน กันคนข้าง ๆ เห็น)
    crossed: new Set(), // สถานที่ที่ขีดฆ่าไว้ (จดในเครื่องตัวเอง)
    mode: null,         // null | 'accuse' | 'guess'
    sel: null,          // ตัวเลือกในหน้าจอปัจจุบัน
    voteSeq: 0,         // การโหวตที่กำลังแสดง
    sent: false,        // ส่งโหวตไปแล้ว รอเครื่องคนสร้างห้อง
    lastNotice: 0,
    noticeUntil: 0,
  };

  U.mount = el => {
    U.el = el;
    el.onclick = onClick;
    U.render();
  };

  U.setView = view => {
    const firstView = !U.view;
    if (view.key !== U.key) {
      U.key = view.key;
      U.cardOpen = false;
      U.crossed = new Set();
      U.mode = null;
      U.sel = null;
    }
    const vote = view.vote;
    if (vote && vote.seq !== U.voteSeq) {
      U.voteSeq = vote.seq;
      U.mode = null;
      U.sel = vote.kind === 'final' && vote.myVote != null ? vote.myVote : null;
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
    U.sent = false;
    if (view.notice && view.notice.seq > U.lastNotice) {
      U.lastNotice = view.notice.seq;
      // ข้อความที่เกิดก่อนเปิดหน้านี้ ไม่ต้องเด้งขึ้นมา
      if (!firstView) {
        U.noticeUntil = Date.now() + 5000;
        setTimeout(() => U.render(), 5100);
      }
    }
    if (U.mode === 'guess' && !(view.me && view.me.spy)) U.mode = null;
    U.view = view;
    U.receivedAt = Date.now();
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
    const el = U.el && U.el.querySelector('[data-sp-timer]');
    if (!el) return;
    const ms = remainingMs();
    el.textContent = ms == null ? '--:--' : fmt(ms);
    el.classList.toggle('low', ms != null && ms <= 60000);
  }
  setInterval(tick, 500);

  function doSend(action) {
    U.sent = true;
    U.render();
    Promise.resolve(send({ key: U.view.key, ...action })).catch(() => { U.sent = false; U.render(); });
  }

  function onClick(e) {
    const btn = e.target.closest('[data-sp]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.sp;
    const v = U.view;
    if (act === 'card') { U.cardOpen = !U.cardOpen; return U.render(); }
    if (act === 'cross') {
      const name = btn.dataset.name;
      if (U.crossed.has(name)) U.crossed.delete(name); else U.crossed.add(name);
      return U.render();
    }
    if (act === 'mode') { U.mode = btn.dataset.mode || null; U.sel = null; return U.render(); }
    if (act === 'pick') { U.sel = btn.dataset.id != null ? Number(btn.dataset.id) : btn.dataset.name; return U.render(); }
    if (act === 'dismiss') { U.noticeUntil = 0; return U.render(); }
    if (act === 'accuse' && U.sel != null) { U.mode = null; return doSend({ type: 'accuse', target: U.sel }); }
    if (act === 'guess' && U.sel != null) { U.mode = null; return doSend({ type: 'guess', location: U.sel }); }
    if (act === 'vote') return doSend({ type: 'vote', seq: v.vote.seq, yes: btn.dataset.yes === '1' });
    if (act === 'final' && U.sel != null) return doSend({ type: 'final', seq: v.vote.seq, target: U.sel });
  }

  // ---------- ส่วนประกอบ ----------
  function playerButtons(list) {
    return `<div class="players">${list.map(o => `
      <button class="player ${U.sel === o.id ? 'selected' : ''}" data-sp="pick" data-id="${o.id}">
        <span class="pname">${esc(o.name)}</span></button>`).join('')}</div>`;
  }

  function locationGrid(v, pickable) {
    return `<div class="sp-locs">${v.locations.map(l => {
      const cls = pickable ? (U.sel === l.name ? 'selected' : '') : (U.crossed.has(l.name) ? 'crossed' : '');
      return `<button class="sp-loc ${cls}" data-sp="${pickable ? 'pick' : 'cross'}" data-name="${esc(l.name)}">
        <span>${l.icon}</span>${esc(l.name)}</button>`;
    }).join('')}</div>`;
  }

  function roleCard(me) {
    if (!U.cardOpen) {
      return `<button class="sp-card closed" data-sp="card">
        <div class="sp-card-icon">🔒</div><b>แตะเพื่อดูบทบาท</b><small>อย่าให้คนข้าง ๆ เห็น</small></button>`;
    }
    if (me.spy) {
      return `<button class="sp-card spy" data-sp="card">
        <div class="sp-card-icon">🕵️</div><div class="sp-card-loc">คุณคือสายลับ!</div>
        <small>ฟังคำถามคำตอบให้ดี แล้วเดาว่าทุกคนอยู่ที่ไหน — อย่าให้ใครจับได้</small>
        <small class="sp-card-hide">แตะเพื่อซ่อน</small></button>`;
    }
    return `<button class="sp-card agent" data-sp="card">
      <div class="sp-card-icon">${me.icon}</div><small>สถานที่</small><div class="sp-card-loc">${esc(me.location)}</div>
      <div class="sp-card-role">บทบาทของคุณ: <b>${esc(me.role)}</b></div>
      <small class="sp-card-hide">แตะเพื่อซ่อน</small></button>`;
  }

  function notice(v) {
    if (!v.notice || Date.now() > U.noticeUntil) return '';
    return `<div class="sp-notice" data-sp="dismiss">📢 ${esc(v.notice.text)}</div>`;
  }

  function voteOverlay(v) {
    const V = v.vote;
    if (!V) return '';
    if (V.kind === 'accuse') {
      const progress = `<p class="muted">เห็นด้วยแล้ว ${V.yes}/${V.need} คน · ต้องเห็นด้วยทุกคนจึงจับได้</p>`;
      if (V.targetIsMe) {
        return `<div class="sp-overlay danger"><div class="sp-ov-icon">😰</div>
          <h2>คุณถูกกล่าวหา!</h2>
          <p><b>${esc(V.byName)}</b> คิดว่าคุณคือสายลับ</p>
          <p>อธิบายให้ทุกคนฟังว่าทำไมคุณไม่ใช่!</p>${progress}</div>`;
      }
      const head = `<div class="sp-ov-icon">🚨</div>
        <h2>${V.byMe ? 'คุณ' : esc(V.byName)} กล่าวหา ${esc(V.targetName)}</h2><p>ว่าเป็นสายลับ</p>`;
      if (V.myVote !== undefined || U.sent) {
        return `<div class="sp-overlay">${head}
          <p>${U.sent && V.myVote === undefined ? '⏳ กำลังส่ง…' : V.myVote ? '👍 คุณเห็นด้วย' : '👎 คุณไม่เห็นด้วย'} — รอคนอื่น</p>${progress}</div>`;
      }
      return `<div class="sp-overlay">${head}${progress}
        <div class="actions">
          <button data-sp="vote" data-yes="0">👎 ไม่เห็นด้วย</button>
          <button class="btn-primary" data-sp="vote" data-yes="1">👍 เห็นด้วย</button>
        </div></div>`;
    }
    const voted = V.myVote != null;
    const votedName = voted ? (v.others.find(o => o.id === V.myVote) || {}).name : '';
    return `<div class="sp-overlay"><div class="sp-ov-icon">⏰</div>
      <h2>หมดเวลา! ใครคือสายลับ?</h2>
      <p class="muted">${voted ? `คุณโหวต <b>${esc(votedName || '')}</b> (เปลี่ยนได้จนกว่าทุกคนจะโหวตครบ)` : 'คนที่ได้เสียงมากที่สุดจะถูกจับ — ถ้าเสมอ สายลับรอด'}
        · โหวตแล้ว ${V.done}/${V.total}</p>
      ${playerButtons(v.others)}
      <button class="btn-primary btn-block btn-big" data-sp="final" ${U.sel == null || U.sent ? 'disabled' : ''}>${U.sent ? '⏳ กำลังส่ง…' : '⚖️ โหวต'}</button>
    </div>`;
  }

  function playPanel(v) {
    if (U.mode === 'accuse') {
      return `<div class="panel"><strong>🚨 กล่าวหาใครว่าเป็นสายลับ?</strong>
        <p class="muted small">ทุกคนจะหยุดโหวต ถ้าเห็นด้วยทุกคน คนนั้นถูกจับทันที · กล่าวหาได้คนละครั้งต่อรอบ</p>
        ${playerButtons(v.others)}
        <div class="actions"><button data-sp="mode">ยกเลิก</button>
          <button class="btn-primary" data-sp="accuse" ${U.sel == null ? 'disabled' : ''}>🚨 กล่าวหา</button></div></div>`;
    }
    if (U.mode === 'guess') {
      return `<div class="panel"><strong>🎯 ทุกคนอยู่ที่ไหน?</strong>
        <p class="muted small">เดาได้ครั้งเดียว — ถูก คุณชนะ (+4 แต้ม) · ผิด คุณแพ้ทันที</p>
        ${locationGrid(v, true)}
        <div class="actions"><button data-sp="mode">ยกเลิก</button>
          <button class="btn-primary" data-sp="guess" ${U.sel == null ? 'disabled' : ''}>🎯 ${U.sel != null ? `ตอบ “${esc(U.sel)}”` : 'เลือกสถานที่'}</button></div></div>`;
    }
    return `<div class="sp-actions">
        <button data-sp="mode" data-mode="accuse" ${v.canAccuse && !U.sent ? '' : 'disabled'}>${v.canAccuse ? '🚨 กล่าวหาสายลับ' : '🚨 ใช้สิทธิ์กล่าวหาแล้ว'}</button>
        ${v.me.spy ? '<button class="sp-guess-btn" data-sp="mode" data-mode="guess">🎯 เปิดตัว · เดาสถานที่</button>' : ''}
      </div>
      <div class="panel"><strong>สถานที่ที่เป็นไปได้</strong> <small class="muted">แตะเพื่อขีดฆ่าที่ตัดทิ้งได้</small>
        ${locationGrid(v, false)}</div>`;
  }

  const VIEWS = {
    lobby(v) {
      return `
        <div class="sp-stage">
          <div class="sp-big">🕵️</div>
          <h2>สวัสดี ${esc(v.name || '')}</h2>
          <p class="muted">เข้าร่วมแล้ว — รอคนสร้างห้องเริ่มเกม${v.count ? ` (ตอนนี้ ${v.count} คน)` : ''}</p>
        </div>
        <div class="panel sp-rules">
          <strong>วิธีเล่น</strong>
          <ol>
            <li>ทุกคนรู้ว่าอยู่ <b>สถานที่</b> ไหนและได้บทบาทของตัวเอง — ยกเว้น <b>สายลับ 1 คน</b> ที่ไม่รู้อะไรเลย</li>
            <li>ผลัดกันถามคำถามเกี่ยวกับสถานที่ทีละคน คนถูกถามตอบแล้วถามคนต่อไป (ห้ามถามกลับคนที่เพิ่งถามตัวเอง)</li>
            <li>ตอบให้รู้ว่าคุณรู้สถานที่ แต่อย่าชัดจนสายลับเดาออก!</li>
            <li>สงสัยใคร กด <b>🚨 กล่าวหา</b> (คนละครั้งต่อรอบ) — ถ้าทุกคนเห็นด้วย คนนั้นถูกจับ</li>
            <li>สายลับกด <b>🎯 เดาสถานที่</b> ได้ทุกเมื่อ ถ้าถูก สายลับชนะ</li>
            <li>หมดเวลา ทุกคนโหวตหาสายลับ</li>
          </ol>
        </div>`;
    },

    play(v) {
      const me = v.me;
      return `${notice(v)}${voteOverlay(v)}
        <div class="sp-top">
          <div class="sp-timer" data-sp-timer>--:--</div>
          <div class="sp-meta">${v.paused && !v.vote ? '⏸ หยุดเวลาไว้<br>' : ''}${v.firstIsMe ? '🎤 <b>คุณ</b>เริ่มถามก่อน!' : `🎤 ${esc(v.firstName)} เริ่มถามก่อน`}</div>
        </div>
        ${roleCard(me)}
        ${playPanel(v)}`;
    },

    end(v) {
      return `
        <div class="sp-stage">
          <div class="sp-big pop">${v.won ? '🏆' : '😵'}</div>
          <h2 class="win-title ${v.won ? 'won' : 'lost'}">${v.won ? 'คุณชนะ!' : 'คุณแพ้'}</h2>
          <p><b>${v.winner === 'spy' ? '🕵️ สายลับชนะ' : '🕴️ ฝ่ายพลเมืองชนะ'}</b></p>
          <p class="muted">${esc(v.text)}</p>
        </div>
        <div class="panel sp-answer">
          <div><small class="muted">สถานที่คือ</small><b>${v.location.icon} ${esc(v.location.name)}</b></div>
          <div><small class="muted">สายลับคือ</small><b>🕵️ ${esc(v.spyName)}</b></div>
        </div>
        <div class="panel"><strong>แต้มสะสม</strong>
          <div class="sp-results">${v.results.map(r => `
            <div class="sp-res ${r.won ? 'won' : 'lost'}">
              <span class="sp-res-name">${esc(r.name)}${r.isMe ? ' (คุณ)' : ''}</span>
              <span class="sp-res-score">${r.score} แต้ม${r.gained ? ` <small>+${r.gained}</small>` : ''}</span>
              <span class="sp-res-role">${r.spy ? '🕵️ สายลับ' : esc(r.role)}</span>
            </div>`).join('')}
          </div>
        </div>
        <p class="muted" style="text-align:center">รอคนสร้างห้องเริ่มรอบใหม่…</p>`;
    },
  };

  return U;
}
