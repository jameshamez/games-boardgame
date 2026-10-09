'use strict';
// หน้าจอของผู้เล่นหนึ่งคน (การ์ดบทบาท หน้าจอเลือก โหวต ฯลฯ)
// ใช้ทั้งบนมือถือผู้เล่น (play.html) และบนเครื่องเจ้าห้องที่เล่นด้วย (index.html)
// แค่แสดง "หน้าจอ" ที่เจ้าห้องส่งมา แล้วส่งการกดกลับผ่าน send(action)

// บรรทัดภาษาอังกฤษตัวเล็กใต้ข้อความไทย (ใช้ทั้งมือถือผู้เล่นและเครื่องเจ้าห้อง)
const enLine = s => `<span class="en-line">${s}</span>`;

function createPlayerUI(send) {
  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = {
    el: null,
    view: null,
    sel: [],          // ผู้เล่นที่เลือกไว้ในหน้าจอปัจจุบัน
    actionId: '',     // ระบุหน้าจอที่ต้องกด (เปลี่ยนเมื่อเจ้าห้องขึ้นหน้าจอใหม่)
    sent: '',         // ส่งการกดของหน้าจอนี้ไปแล้ว
    cardOpen: false,
    talkEnd: 0,       // เวลาที่ช่วงอภิปรายจะหมด (นาฬิกาของเครื่องนี้)
  };

  // นับเวลาอภิปรายถอยหลังบนเครื่องนี้ (เจ้าห้องส่งเวลาที่เหลือมาใหม่ทุกครั้งที่หยุด/เพิ่มเวลา)
  const talkLeft = () => {
    const t = U.view && U.view.talk;
    if (!t) return 0;
    return t.paused ? t.left : Math.max(0, Math.ceil((U.talkEnd - Date.now()) / 1000));
  };
  const fmtTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  setInterval(() => {
    const el = U.el && U.el.querySelector('[data-ptimer]');
    if (!el) return;
    const left = talkLeft();
    el.textContent = fmtTime(left);
    el.parentElement.classList.toggle('low', left <= 30);
  }, 250);

  U.mount = el => {
    U.el = el;
    el.onclick = onClick;
    U.render();
  };

  U.setView = view => {
    if (U.view && JSON.stringify(U.view) === JSON.stringify(view)) return;
    const a = view.action;
    const id = a ? `${view.key}|${a.kind}|${a.title || ''}` : '';
    if (id !== U.actionId) {
      U.actionId = id;
      U.sel = a && a.kind === 'vote' && a.myVote != null ? [a.myVote] : [];
      U.sent = '';
      if (a && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    }
    if (U.view && U.view.phase !== view.phase) U.cardOpen = false;
    if (view.talk) U.talkEnd = Date.now() + view.talk.left * 1000;
    U.view = view;
    U.render();
  };

  U.render = () => {
    if (!U.el || !U.view) return;
    U.el.innerHTML = (VIEWS[U.view.phase] || VIEWS.lobby)(U.view);
  };

  function doSend(action) {
    U.sent = U.actionId;
    U.render();
    Promise.resolve(send({ key: U.view.key, ...action })).catch(() => { U.sent = ''; U.render(); });
  }

  function onClick(e) {
    const btn = e.target.closest('[data-pact]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.pact;
    if (act === 'card') {
      // พลิกการ์ดโดยไม่วาดหน้าใหม่ เพื่อให้เห็นแอนิเมชัน
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
    if (act === 'send') {
      const a = { type: btn.dataset.type };
      if (btn.dataset.i != null) a.i = Number(btn.dataset.i);
      return doSend(a);
    }
    if (act === 'confirm') return doSend({ type: 'confirm', ids: U.sel });
    if (act === 'hunter') return doSend({ type: 'hunter', id: btn.dataset.none ? null : U.sel[0] });
    if (act === 'vote') return doSend({ type: 'vote', id: btn.dataset.none ? null : U.sel[0] });
  }

  // ---------- ส่วนประกอบ ----------
  function roleCard(me, open) {
    return `
      <div class="flip small ${open ? 'flipped' : ''}" data-pact="card">
        <div class="flip-inner">
          <div class="card-face card-back">
            <div class="cb-moon">🌕</div>
            <div class="cb-title">WEREWOLF</div>
            <div class="cb-hint">แตะเพื่อดูบทบาท${enLine('Tap to see your role')}</div>
          </div>
          <div class="card-face card-front ${me.team}">
            <div class="cf-team">${me.teamName}${enLine(me.teamEn)}</div>
            <div class="cf-icon">${me.icon}</div>
            <div class="cf-name">${me.role}</div>
            <div class="cf-en">${me.en}</div>
            <p class="cf-desc">${me.desc}${enLine(me.descEn)}</p>
            ${me.extra.map(e => `<p class="cf-extra">${e}</p>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function header(v) {
    if (v.phase === 'night') return `<div class="phase-head">🌙 คืนที่ ${v.day} <small>Night ${v.day}</small> · ${escHtml(v.me.name)}</div>`;
    if (v.phase === 'day') return `<div class="phase-head">☀️ วันที่ ${v.day} <small>Day ${v.day}</small> · ${escHtml(v.me.name)}</div>`;
    return `<div class="phase-head">${escHtml(v.me.name)}</div>`;
  }

  function playerButtons(list, max) {
    return `<div class="players">${list.map(c => `
      <button class="player ${U.sel.includes(c.id) ? 'selected' : ''}" data-pact="sel" data-id="${c.id}" data-max="${max}">
        <span class="pname">${escHtml(c.name)}</span></button>`).join('')}</div>`;
  }

  /** รายชื่อคนที่ยังไม่โหวต (ระหว่างลงคะแนน) */
  function notVotedList(v) {
    const list = v.notVoted || [];
    if (!list.length) return '';
    return `<div class="not-voted"><small>⏳ ยังไม่โหวต${enLine('Not voted yet')}</small>
      <div class="notes">${list.map(n => `<span class="chip">${escHtml(n)}</span>`).join('')}</div></div>`;
  }

  function actionView(v) {
    const a = v.action;
    const waiting = U.sent === U.actionId && !(a.kind === 'vote' && a.myVote !== undefined);
    const top = `<div class="stage tight"><div class="mid-icon">${a.icon || ''}</div><h2>${a.title}</h2>
      ${a.hint ? `<p class="muted">${a.hint}</p>` : ''}</div>`;
    if (waiting) return `${top}<div class="stage"><p class="muted">✓ ส่งแล้ว รอสักครู่…${enLine('Sent — please wait…')}</p></div>`;
    if (a.kind === 'result') {
      return `<div class="stage"><div class="big-icon">${a.icon}</div><h2>${a.title}</h2>
        <div class="result ${a.tone}">${a.text}</div>
        <button class="btn-primary btn-block btn-big" data-pact="send" data-type="next">รับทราบ${enLine('Got it')}</button></div>`;
    }
    if (a.kind === 'info') {
      return `${top}<div class="info-card">${a.html}</div>
        <button class="btn-primary btn-block btn-big" data-pact="send" data-type="next">${a.button}</button>`;
    }
    if (a.kind === 'choice') {
      return `${top}${a.html ? `<div class="info-card">${a.html}</div>` : ''}
        <div class="actions">${a.options.map((o, i) =>
          `<button class="${o.primary ? 'btn-primary' : ''}" data-pact="send" data-type="choice" data-i="${i}">${o.label}</button>`).join('')}</div>`;
    }
    if (a.kind === 'pick') {
      const ready = U.sel.length === a.count;
      return `${top}${playerButtons(a.candidates, a.count)}
        <div class="actions">
          ${a.optional ? `<button data-pact="send" data-type="skip">${a.skipLabel}</button>` : ''}
          <button class="btn-primary" data-pact="confirm" ${ready ? '' : 'disabled'}>
            ${a.count > 1 ? `ยืนยัน (${U.sel.length}/${a.count})` : 'ยืนยัน'}${enLine('Confirm')}</button>
        </div>`;
    }
    if (a.kind === 'hunter') {
      return `${top}${playerButtons(a.candidates, 1)}
        <div class="actions">
          <button data-pact="hunter" data-none="1">ไม่ยิง${enLine("Don't shoot")}</button>
          <button class="btn-primary" data-pact="hunter" ${U.sel.length ? '' : 'disabled'}>🏹 ยิง${enLine('Shoot')}</button>
        </div>`;
    }
    if (a.kind === 'vote') {
      const voted = a.myVote !== undefined;
      const votedName = a.myVote == null ? 'งดออกเสียง (abstain)' : (a.candidates.find(c => c.id === a.myVote) || {}).name;
      // โหวตแล้วเปลี่ยนไม่ได้: แสดงผลโหวตของตัวเองอย่างเดียว
      if (voted) {
        return `<div class="stage tight"><div class="mid-icon">🗳️</div><h2>${a.title}</h2></div>
          <div class="stage"><div class="info-card"><p>คุณโหวต${enLine('Your vote')}</p><div class="big-text">🔒 ${escHtml(votedName || '')}</div></div>
          <p class="muted">โหวตแล้วเปลี่ยนไม่ได้ — รอคนอื่นโหวต…${enLine('Votes are final — waiting for others…')}</p>
          ${notVotedList(v)}</div>`;
      }
      return `<div class="stage tight"><div class="mid-icon">🗳️</div><h2>${a.title}</h2>
        <p class="muted">เลือกคนที่คุณคิดว่าเป็นหมาป่า — โหวตแล้วเปลี่ยนไม่ได้${enLine('Pick who you think is a werewolf — votes are final')}</p></div>
        ${playerButtons(a.candidates, 1)}
        <div class="actions">
          <button data-pact="vote" data-none="1">งดออกเสียง${enLine('Abstain')}</button>
          <button class="btn-primary" data-pact="vote" ${U.sel.length ? '' : 'disabled'}>⚖️ โหวต${enLine('Vote')}</button>
        </div>`;
    }
    return '';
  }

  const VIEWS = {
    lobby(v) {
      return `
        <div class="stage">
          <div class="big-icon float">🏕️</div>
          <h2>สวัสดี ${escHtml(v.name || '')}${enLine(`Hi ${escHtml(v.name || '')}`)}</h2>
          <p class="muted">เข้าร่วมแล้ว — รอเจ้าของห้องเริ่มเกม${v.count ? ` (ตอนนี้ ${v.count} คน)` : ''}
            ${enLine(`Joined — waiting for the host to start${v.count ? ` (${v.count} players)` : ''}`)}</p>
          <div class="info-card"><p>วางมือถือไว้ข้างตัว เปิดหน้านี้ค้างไว้<br>เมื่อถึงตาคุณ มือถือจะสั่นและขึ้นหน้าจอให้เลือก
            ${enLine('Keep this page open beside you. Your phone will vibrate when it is your turn.')}</p></div>
        </div>`;
    },

    reveal(v) {
      return `${header(v)}<div class="stage">
        <h2>บทบาทของคุณ${enLine('Your role')}</h2>
        ${roleCard(v.me, U.cardOpen)}
        ${v.ready
          ? `<p class="muted">✓ พร้อมแล้ว — รอคนอื่น…${enLine('Ready — waiting for others…')}</p>`
          : `<button class="btn-primary btn-block btn-big" data-pact="send" data-type="ready" ${U.cardOpen ? '' : 'disabled'}>จำได้แล้ว · พร้อม${enLine("Got it · I'm ready")}</button>`}
      </div>`;
    },

    night(v) {
      if (v.action) return header(v) + actionView(v);
      return `${header(v)}<div class="stage">
        <div class="big-icon float">${v.me.alive ? '😴' : '👻'}</div>
        <h2>${v.me.alive ? `หลับตา${enLine('Close your eyes')}` : `คุณตายแล้ว${enLine('You are dead')}`}</h2>
        <p class="muted">${v.me.alive ? `ฟังเสียงเรียก เมื่อถึงตาคุณ มือถือจะสั่น${enLine('Listen for your call — your phone will vibrate on your turn')}`
          : `ห้ามพูด ห้ามบอกใบ้${enLine('No talking, no hints')}`}</p>
        ${roleCard(v.me, U.cardOpen)}
      </div>`;
    },

    day(v) {
      if (v.action) return header(v) + actionView(v);
      const msg = !v.me.alive ? `👻 คุณตายแล้ว — ห้ามพูดและห้ามบอกใบ้${enLine('You are dead — no talking, no hints')}`
        : v.dayPhase === 'talk' ? `🗣️ ช่วงอภิปราย — คุยกันหาตัวหมาป่า${enLine('Discussion — find the werewolves')}`
        : v.dayPhase === 'vote' ? `🗳️ กำลังลงคะแนน${enLine('Voting in progress')}`
        : `☀️ ฟังประกาศ${enLine('Listen to the announcement')}`;
      const t = v.dayPhase === 'talk' && v.talk;
      const left = t ? talkLeft() : 0;
      const timer = t ? `<div class="timer-ring ${left <= 30 ? 'low' : ''}">
          <div class="timer" data-ptimer>${fmtTime(left)}</div><small>${t.paused ? '⏸ หยุดเวลาไว้ · Paused' : 'เวลาอภิปราย · Discussion'}</small></div>
          ${t.noVote ? `<p class="muted">🚫 วันแรกไม่มีการโหวต — หมดเวลาแล้วเข้าสู่กลางคืนเลย${enLine('No vote on day 1 — night falls when time is up')}</p>` : ''}` : '';
      return `${header(v)}<div class="stage">${timer}
        <div class="info-card"><div class="big-text">${msg}</div>
          ${(v.status || []).map(s => `<p><strong>${s}</strong></p>`).join('')}
          ${v.dayPhase === 'vote' ? notVotedList(v) : ''}</div>
        ${roleCard(v.me, U.cardOpen)}
      </div>`;
    },

    end(v) {
      const title = v.winner === 'wolf' ? `ฝ่ายมนุษย์หมาป่าชนะ!${enLine('Werewolves win!')}`
        : v.winner === 'tanner' ? `ยาจกชนะ!${enLine('The Tanner wins!')}` : `ฝ่ายชาวบ้านชนะ!${enLine('Villagers win!')}`;
      return `<div class="stage">
        <div class="big-icon trophy">${v.won ? '🏆' : '😵'}</div>
        <h2 class="win-title ${v.won ? 'won' : 'lost'}">${v.won ? `คุณชนะ!${enLine('You win!')}` : `คุณแพ้${enLine('You lose')}`}</h2>
        <p class="muted">${title}</p>
      </div>
      <section class="panel"><strong>บทบาทของทุกคน · Everyone's roles</strong>
        <div class="reveal-list">${v.players.map(p => `
          <div class="rl-item ${p.alive ? '' : 'dead'} ${p.won ? 'won' : 'lost'}"><span class="rl-icon">${p.icon}</span>
            <span class="rl-name">${escHtml(p.name)}${p.won ? ' 🏆' : ''}</span><span class="rl-role">${p.role} <small>${p.en}</small></span><span>${p.alive ? 'รอด · alive' : '💀'}</span></div>`).join('')}
        </div></section>
      <p class="muted" style="text-align:center">รอเจ้าของห้องเริ่มเกมใหม่…${enLine('Waiting for the host to start a new game…')}</p>`;
    },
  };

  return U;
}
