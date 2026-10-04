'use strict';
// หน้าจอผู้เล่นของเกมหนูขโมยชีส — ใช้ทั้งบนมือถือ (play.html) และบนเครื่องคนสร้างห้อง (index.html)
// แสดงแค่สิ่งที่เจ้าตัวรู้: บทบาท เลขลูกเต๋า และสิ่งที่เห็นตอนตื่นกลางคืน

function createCheeseUI(send) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const U = { el: null, view: null, sel: [], actionId: '', sent: '', cardOpen: false };

  U.mount = el => { U.el = el; el.onclick = onClick; U.render(); };

  U.setView = view => {
    if (U.view && JSON.stringify(U.view) === JSON.stringify(view)) return;
    const a = view.action;
    const id = a ? `${view.key}|${a.kind}` : '';
    if (id !== U.actionId) {
      U.actionId = id;
      U.sel = a && a.kind === 'vote' && a.myVote != null ? [a.myVote] : [];
      U.sent = '';
      if (a && navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
    if (U.view && U.view.phase !== view.phase) U.cardOpen = false;
    U.view = view;
    U.render();
  };

  U.render = () => {
    if (!U.el || !U.view) return;
    U.el.innerHTML = (VIEWS[U.view.phase] || VIEWS.lobby)(U.view);
  };

  /** lock = ซ่อนปุ่มจนกว่าหน้าจอจะเปลี่ยน (การแอบดูลูกเต๋าไม่ล็อก เพราะยังต้องกดหลับตาต่อ) */
  function doSend(action, lock = true) {
    if (lock) U.sent = U.actionId;
    U.render();
    Promise.resolve(send({ key: U.view.key, ...action })).catch(() => { U.sent = ''; U.render(); });
  }

  function onClick(e) {
    const btn = e.target.closest('[data-ch]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.ch;
    if (act === 'card') {
      U.cardOpen = !U.cardOpen;
      btn.classList.toggle('flipped', U.cardOpen);
      const ready = U.el.querySelector('[data-type="ready"]');
      if (ready) ready.disabled = !U.cardOpen;
      return;
    }
    if (act === 'sel') {
      const id = Number(btn.dataset.id), max = Number(btn.dataset.max);
      if (U.sel.includes(id)) U.sel = U.sel.filter(x => x !== id);
      else if (max === 1) U.sel = [id];
      else if (U.sel.length < max) U.sel.push(id);
      return U.render();
    }
    if (act === 'send') return doSend({ type: btn.dataset.type });
    if (act === 'peek') { const id = U.sel[0]; U.sel = []; return doSend({ type: 'peek', id }, false); }
    if (act === 'pick') return doSend({ type: 'pick', ids: U.sel });
    if (act === 'vote') return doSend({ type: 'vote', id: btn.dataset.none ? null : U.sel[0] });
  }

  // ---------- ส่วนประกอบ ----------
  function roleCard(me, open) {
    return `
      <div class="flip small ${open ? 'flipped' : ''}" data-ch="card">
        <div class="flip-inner">
          <div class="card-face card-back ch-back">
            <div class="cb-moon">🧀</div>
            <div class="cb-title">CHEESE</div>
            <div class="cb-hint">แตะเพื่อดูบทบาทและลูกเต๋า</div>
          </div>
          <div class="card-face card-front ${me.team === 'thief' ? 'wolf' : 'village'}">
            <div class="cf-team">${me.teamName}</div>
            <div class="cf-icon">${me.icon}</div>
            <div class="cf-name">${me.roleName}</div>
            <div class="ch-die">${DICE[me.die]}<span>ตื่นตอนตี ${me.die}</span></div>
            <p class="cf-desc">${me.desc}</p>
          </div>
        </div>
      </div>`;
  }

  function notes(me) {
    if (!me.notes || !me.notes.length) return '';
    return `<div class="panel ch-notes"><strong>📝 สิ่งที่คุณรู้</strong>
      <ul>${me.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>`;
  }

  function header(v) {
    if (v.phase === 'night') return `<div class="phase-head">🌙 ${v.hour ? `ตี ${v.hour}` : 'กลางคืน'} · ${esc(v.me.name)}</div>`;
    if (v.phase === 'day') return `<div class="phase-head">☀️ ตอนเช้า · ${esc(v.me.name)}</div>`;
    return `<div class="phase-head">${esc(v.me.name)}</div>`;
  }

  function playerButtons(list, max) {
    return `<div class="players">${list.map(c => `
      <button class="player ${U.sel.includes(c.id) ? 'selected' : ''}" data-ch="sel" data-id="${c.id}" data-max="${max}">
        <span class="pname">${esc(c.name)}</span></button>`).join('')}</div>`;
  }

  function actionView(v) {
    const a = v.action;
    const waiting = U.sent === U.actionId && a.kind !== 'vote';
    if (waiting) return `<div class="stage"><div class="big-icon float">😴</div><p class="muted">✓ ส่งแล้ว รอสักครู่…</p></div>`;

    if (a.kind === 'awake') {
      const cheese = a.cheese === 'stolen-now'
        ? (v.me.team === 'thief' ? '<div class="result wolf">🧀 คุณขโมยชีสแล้ว!</div>' : `<div class="result wolf">🧀 คุณเห็น <b>${esc(a.thiefName)}</b> ขโมยชีส!</div>`)
        : a.cheese === 'gone' ? '<div class="result">🕳️ ชีสหายไปแล้ว!</div>' : '<div class="result village">🧀 ชีสยังอยู่ที่เดิม</div>';
      const others = a.others.length
        ? `<p>ตื่นพร้อมคุณ: <b>${a.others.map(esc).join(', ')}</b></p>`
        : '<p>คุณตื่นอยู่คนเดียว</p>';
      const peek = a.alone && !a.peeked
        ? `<div class="panel"><strong>👀 แอบดูลูกเต๋าของใครสักคน</strong>${playerButtons(a.peekCandidates, 1)}
            <button class="btn-block" data-ch="peek" ${U.sel.length ? '' : 'disabled'}>ดูลูกเต๋า</button></div>`
        : a.peeked ? `<div class="result">👀 ลูกเต๋าของ <b>${esc(a.peeked.name)}</b> คือ <span class="ch-die-inline">${DICE[a.peeked.die]} ${a.peeked.die}</span></div>` : '';
      return `<div class="stage tight"><div class="mid-icon">👁️</div><h2>ตี ${v.hour} — คุณตื่นแล้ว!</h2>
        ${others}</div>${cheese}${peek}
        <button class="btn-primary btn-block btn-big" data-ch="send" data-type="sleep">😴 จำได้แล้ว · หลับตา</button>`;
    }
    if (a.kind === 'pick') {
      const ready = U.sel.length === a.count;
      return `<div class="stage tight"><div class="mid-icon">🤝</div><h2>เลือกผู้สมรู้ร่วมคิด ${a.count > 1 ? `${a.count} คน` : ''}</h2>
        <p class="muted">เขาจะรู้ว่าเป็นพวกคุณ แต่ไม่รู้ว่าคุณคือใคร</p></div>
        ${playerButtons(a.candidates, a.count)}
        <button class="btn-primary btn-block btn-big" data-ch="pick" ${ready ? '' : 'disabled'}>ยืนยัน</button>`;
    }
    if (a.kind === 'vote') {
      const voted = a.myVote !== undefined;
      const votedName = a.myVote == null ? 'งดออกเสียง' : (a.candidates.find(c => c.id === a.myVote) || {}).name;
      return `<div class="stage tight"><div class="mid-icon">🗳️</div><h2>ใครคือหัวขโมย?</h2>
        <p class="muted">${voted ? `คุณโหวต: <b>${esc(votedName || '')}</b> (เปลี่ยนได้จนกว่าจะสรุปผล)` : 'เลือกคนที่คุณสงสัย'}</p></div>
        ${playerButtons(a.candidates, 1)}
        <div class="actions">
          <button data-ch="vote" data-none="1">งดออกเสียง</button>
          <button class="btn-primary" data-ch="vote" ${U.sel.length ? '' : 'disabled'}>⚖️ โหวต</button>
        </div>${notes(v.me)}`;
    }
    return '';
  }

  const VIEWS = {
    lobby(v) {
      return `
        <div class="stage">
          <div class="big-icon float">🐭</div>
          <h2>สวัสดี ${esc(v.name || '')}</h2>
          <p class="muted">เข้าร่วมแล้ว — รอคนสร้างห้องเริ่มเกม${v.count ? ` (ตอนนี้ ${v.count} คน)` : ''}</p>
        </div>
        <div class="panel fw-rules"><strong>วิธีเล่น</strong>
          <ol>
            <li>ทุกคนเป็นหนู มี <b>หัวขโมย 1 ตัว</b> แอบซ่อนอยู่</li>
            <li>ทุกคนได้ลูกเต๋าคนละลูก = <b>เวลาที่ตื่นตอนกลางคืน (ตี 1–6)</b></li>
            <li>หัวขโมยจะขโมยชีสตอนที่ตัวเองตื่น — ใครตื่นพร้อมกันจะเห็น!</li>
            <li>ถ้าตื่นอยู่คนเดียว แอบดูลูกเต๋าของคนอื่นได้ 1 คน</li>
            <li>ตอนเช้าคุยกันแล้วโหวต — ถ้าหัวขโมยได้คะแนนมากที่สุด หนูชนะ</li>
          </ol>
        </div>`;
    },

    reveal(v) {
      return `${header(v)}<div class="stage">
        <h2>บทบาทของคุณ</h2>
        ${roleCard(v.me, U.cardOpen)}
        ${v.ready ? '<p class="muted">✓ พร้อมแล้ว — รอคนอื่น…</p>'
          : `<button class="btn-primary btn-block btn-big" data-ch="send" data-type="ready" ${U.cardOpen ? '' : 'disabled'}>จำได้แล้ว · พร้อม</button>`}
      </div>`;
    },

    night(v) {
      if (v.action) return header(v) + actionView(v);
      return `${header(v)}<div class="stage">
        <div class="big-icon float">😴</div>
        <h2>หลับตา</h2>
        <p class="muted">คุณจะตื่นตอนตี ${v.me.die} — เมื่อถึงเวลา มือถือจะสั่น</p>
      </div>${notes(v.me)}`;
    },

    day(v) {
      if (v.action) return header(v) + actionView(v);
      const msg = v.dayPhase === 'talk' ? '🗣️ คุยกันหาตัวหัวขโมย' : v.dayPhase === 'vote' ? '🗳️ กำลังโหวต' : '☀️ ฟังประกาศ';
      return `${header(v)}<div class="stage"><div class="info-card"><div class="big-text">${msg}</div></div></div>
        ${notes(v.me)}${roleCard(v.me, U.cardOpen)}`;
    },

    end(v) {
      const mice = v.winner === 'mice';
      return `<div class="stage">
        <div class="big-icon trophy">${v.won ? '🏆' : '😵'}</div>
        <h2 class="win-title ${mice ? 'village' : 'wolf'}">${v.won ? 'คุณชนะ!' : 'คุณแพ้'}</h2>
        <p class="muted">${mice ? '🐭 ฝ่ายหนูจับหัวขโมยได้!' : '🧀 หัวขโมยหนีรอดไปได้!'}</p>
      </div>
      <section class="panel"><strong>เฉลย</strong>
        <div class="reveal-list">${v.players.map(p => `
          <div class="rl-item"><span class="rl-icon">${p.icon}</span>
            <span class="rl-name">${esc(p.name)}</span><span class="rl-role">${p.roleName}</span>
            <span class="ch-die-inline">${DICE[p.die]} ${p.die}</span></div>`).join('')}
        </div>
        ${v.tally ? `<p class="muted">ผลโหวต: ${esc(v.tally)}</p>` : ''}
      </section>
      <p class="muted" style="text-align:center">รอคนสร้างห้องเริ่มรอบใหม่…</p>`;
    },
  };

  return U;
}
