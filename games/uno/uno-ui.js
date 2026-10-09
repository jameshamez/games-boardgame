'use strict';
// หน้าจอผู้เล่นของเกม UNO — ใช้ทั้งบนมือถือ (play.html) และบนเครื่องคนสร้างห้อง (index.html)
// แค่แสดงหน้าจอที่เครื่องคนสร้างห้องส่งมา แล้วส่งการกดกลับผ่าน send(action)

/** บรรทัดภาษาอังกฤษตัวเล็กใต้ข้อความไทย */
const enLine = s => `<span class="en-line">${s}</span>`;

function createUnoUI(send) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLOR_NAME = { r: 'แดง', y: 'เหลือง', g: 'เขียว', b: 'น้ำเงิน' };
  const COLOR_EN = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
  const U = {
    el: null,
    view: null,
    picking: null,      // id ของไพ่เปลี่ยนสีที่กำลังเลือกสี
    sent: false,        // ส่งการกดไปแล้ว รอเครื่องคนสร้างห้อง (กันกดซ้ำ)
    wasMyTurn: false,
  };

  U.mount = el => {
    U.el = el;
    el.onclick = onClick;
    U.render();
  };

  U.setView = view => {
    if (view.myTurn && !U.wasMyTurn && navigator.vibrate) navigator.vibrate([150, 80, 150]);
    U.wasMyTurn = !!view.myTurn;
    if (!view.myTurn) U.picking = null;
    U.sent = false;
    U.view = view;
    U.render();
  };

  U.render = () => {
    if (!U.el || !U.view) return;
    U.el.innerHTML = (VIEWS[U.view.phase] || VIEWS.lobby)(U.view);
  };

  function doSend(action) {
    U.sent = true;
    U.render();
    Promise.resolve(send({ key: U.view.key, ...action })).catch(() => { U.sent = false; U.render(); });
    // ถ้าเครื่องคนสร้างห้องไม่ตอบ (เช่นกดไม่ทันตา) ให้กดใหม่ได้
    setTimeout(() => { if (U.sent) { U.sent = false; U.render(); } }, 4000);
  }

  function onClick(e) {
    const btn = e.target.closest('[data-uno]');
    if (!btn || btn.disabled || U.sent) return;
    const act = btn.dataset.uno;
    const v = U.view;
    if (act === 'card') {
      const card = v.me.hand.find(c => c.id === Number(btn.dataset.id));
      if (!card || !card.ok) return;
      if (card.c === 'w') { U.picking = card.id; return U.render(); }
      return doSend({ type: 'play', card: card.id });
    }
    if (act === 'color') { const id = U.picking; U.picking = null; return doSend({ type: 'play', card: id, color: btn.dataset.color }); }
    if (act === 'cancel') { U.picking = null; return U.render(); }
    if (act === 'draw') return doSend({ type: 'draw' });
    if (act === 'pass') return doSend({ type: 'pass' });
    if (act === 'uno') return doSend({ type: 'uno' });
    if (act === 'catch') return doSend({ type: 'catch', target: Number(btn.dataset.id) });
  }

  // ---------- ไพ่ ----------
  function face(card) {
    if (card.v === 'skip') return '⊘';
    if (card.v === 'rev') return '⇄';
    if (card.v === 'd2') return '+2';
    if (card.v === 'd4') return '+4';
    if (card.v === 'wild') return '';
    return card.v;
  }
  function cardHtml(card, { cls = '', act = false } = {}) {
    const f = face(card);
    const small = card.v === 'wild' ? '★' : f;
    return `<${act ? 'button' : 'div'} class="uno-card c-${card.c} ${cls}" ${act ? `data-uno="card" data-id="${card.id}"` : ''}>
      <span class="uc-corner">${small}</span>
      <span class="uc-oval"><b>${f}</b></span>
      <span class="uc-corner br">${small}</span>
    </${act ? 'button' : 'div'}>`;
  }

  // ---------- หน้าจอ ----------
  function table(v) {
    const t = v.top;
    return `<div class="uno-table">
      <div class="uno-pile">
        <div class="uno-card back"><span class="uc-oval"><b>UNO</b></span></div>
        <small>${v.deckCount} ใบ · cards</small>
      </div>
      <div class="uno-pile">
        ${cardHtml(t, { cls: 'top' })}
        <small class="uno-color-tag c-${v.color}">สี${COLOR_NAME[v.color]} · ${COLOR_EN[v.color]}</small>
      </div>
      <div class="uno-dir" title="ทิศทาง · Direction">${v.dir === 1 ? '↻' : '↺'}</div>
    </div>`;
  }

  function players(v) {
    return `<div class="uno-players">${v.players.map(p => `
      <div class="uno-pl ${p.turn ? 'turn' : ''} ${p.isMe ? 'me' : ''}">
        <span class="uno-pl-name">${p.turn ? '👉 ' : ''}${esc(p.name)}${p.isMe ? ' (คุณ · you)' : ''}</span>
        <span class="uno-pl-count ${p.uno ? 'uno' : ''}">🂠 ${p.count}${p.uno ? ' UNO' : ''}</span>
        ${p.catchable ? `<button class="uno-catch" data-uno="catch" data-id="${p.id}">🚨 จับ! ไม่พูด UNO${enLine('Catch! No UNO')}</button>` : ''}
      </div>`).join('')}</div>`;
  }

  function status(v) {
    if (v.myTurn) {
      if (v.pending) {
        return `<div class="uno-status mine hit">ตาคุณ! โดน +${v.pending} ${v.stack ? '— ลง +2/+4 ซ้อนส่งต่อ หรือกดรับไพ่' : ''}
          ${enLine(`Your turn! You got +${v.pending}${v.stack ? ' — stack a +2/+4 to pass it on, or take the cards' : ''}`)}</div>`;
      }
      if (v.drawn != null) return `<div class="uno-status mine">จั่วได้ใบที่ลงได้ — ลงเลย หรือเก็บไว้แล้วผ่าน${enLine('You drew a playable card — play it, or keep it and pass')}</div>`;
      return `<div class="uno-status mine">ตาคุณ! เลือกไพ่ที่จะลง หรือจั่ว${enLine('Your turn! Play a card or draw')}</div>`;
    }
    return `<div class="uno-status">รอ ${esc(v.turnName)} เล่น…${enLine(`Waiting for ${esc(v.turnName)}…`)}</div>`;
  }

  function actions(v) {
    const me = v.me;
    const btns = [];
    if (v.myTurn && v.drawn == null) {
      btns.push(`<button class="btn-primary" data-uno="draw" ${U.sent ? 'disabled' : ''}>${v.pending ? `🂠 รับ +${v.pending} · Take +${v.pending}` : '🂠 จั่วไพ่ · Draw'}</button>`);
    }
    if (v.myTurn && v.drawn != null) btns.push(`<button data-uno="pass" ${U.sent ? 'disabled' : ''}>เก็บไว้ · ผ่าน${enLine('Keep · Pass')}</button>`);
    if (me.hand.length <= 2 && !me.saidUno) btns.push(`<button class="uno-call" data-uno="uno" ${U.sent ? 'disabled' : ''}>UNO!</button>`);
    if (me.saidUno && me.hand.length <= 2) btns.push('<span class="uno-said">✓ พูด UNO แล้ว · UNO called</span>');
    return btns.length ? `<div class="uno-actions">${btns.join('')}</div>` : '';
  }

  function picker() {
    if (U.picking == null) return '';
    return `<div class="uno-overlay"><h2>เลือกสี${enLine('Choose a color')}</h2>
      <div class="uno-colors">${['r', 'y', 'g', 'b'].map(c =>
        `<button class="uno-color c-${c}" data-uno="color" data-color="${c}">${COLOR_NAME[c]}${enLine(COLOR_EN[c])}</button>`).join('')}</div>
      <button data-uno="cancel">ยกเลิก · Cancel</button></div>`;
  }

  const VIEWS = {
    lobby(v) {
      return `
        <div class="uno-stage">
          <div class="uno-logo">UNO</div>
          <h2>สวัสดี ${esc(v.name || '')}${enLine(`Hi ${esc(v.name || '')}`)}</h2>
          <p class="muted">เข้าร่วมแล้ว — รอคนสร้างห้องเริ่มเกม${v.count ? ` (ตอนนี้ ${v.count} คน)` : ''}
            ${enLine(`Joined — waiting for the host to start${v.count ? ` (${v.count} players)` : ''}`)}</p>
        </div>
        <div class="panel uno-rules">
          <strong>วิธีเล่น · How to play</strong>
          <ol>
            <li>ลงไพ่ที่ <b>สีเดียวกัน</b> หรือ <b>ตัวเลข/สัญลักษณ์เดียวกัน</b> กับใบบนกอง${enLine('Play a card matching the color or the number/symbol of the top card')}</li>
            <li>ลงไม่ได้ต้องจั่ว ถ้าจั่วได้ใบที่ลงได้ ลงต่อได้เลย${enLine('Can\'t play? Draw — if the drawn card fits, you may play it')}</li>
            <li>⊘ ข้ามคนถัดไป · ⇄ กลับทาง · +2 คนถัดไปจั่ว 2 · ★ เปลี่ยนสี · +4 เปลี่ยนสีและคนถัดไปจั่ว 4${enLine('⊘ skip next · ⇄ reverse · +2 next draws 2 · ★ change color · +4 change color and next draws 4')}</li>
            <li>เหลือ 2 ใบ กด <b>UNO!</b> ไว้ก่อนลง — ถ้าเหลือใบเดียวแล้วลืม เพื่อนกดจับได้ ต้องจั่ว 2 ใบ${enLine('With 2 cards left, press UNO! before playing — forget it and friends can catch you: draw 2')}</li>
            <li>หมดมือก่อนชนะ ได้แต้มเท่ากับไพ่ที่เหลือในมือคนอื่น${enLine('First to empty their hand wins the points left in everyone else\'s hand')}</li>
          </ol>
        </div>`;
    },

    play(v) {
      const hand = v.me.hand;
      return `${picker()}
        ${table(v)}
        ${v.event ? `<div class="uno-event ${v.event.kind || ''}">${esc(v.event.text)}${v.event.en ? enLine(esc(v.event.en)) : ''}</div>` : ''}
        ${players(v)}
        ${status(v)}
        ${actions(v)}
        <div class="uno-hand ${v.myTurn ? 'my-turn' : ''}">${hand.map(c =>
          cardHtml(c, { act: true, cls: `${c.ok ? 'ok' : ''} ${v.drawn === c.id ? 'drawn' : ''}` })).join('')}</div>
        <p class="muted small" style="text-align:center">ไพ่ในมือ ${hand.length} ใบ · ${hand.length} cards in hand</p>`;
    },

    end(v) {
      return `
        <div class="uno-stage">
          <div class="uno-big pop">${v.won ? '🏆' : '😵'}</div>
          <h2 class="win-title ${v.won ? 'won' : 'lost'}">${v.won ? `คุณชนะ!${enLine('You win!')}` : `คุณแพ้${enLine('You lose')}`}</h2>
          <p><b>${esc(v.winnerName)}</b> หมดมือก่อน ได้ ${v.points} แต้ม${enLine(`${esc(v.winnerName)} went out first and scores ${v.points} points`)}</p>
        </div>
        <div class="panel"><strong>แต้มสะสม · Scores</strong>
          <div class="uno-results">${v.results.map(r => `
            <div class="uno-res ${r.won ? 'won' : 'lost'}">
              <span class="uno-res-name">${r.won ? '🏆 ' : ''}${esc(r.name)}${r.isMe ? ' (คุณ · you)' : ''}</span>
              <span class="uno-res-score">${r.score} แต้ม · pts</span>
              <span class="uno-res-hand">${r.hand.length ? `${r.hand.map(c => cardHtml(c, { cls: 'mini' })).join('')} <small>(${r.pts} แต้ม · pts)</small>` : '<small>หมดมือ · Out</small>'}</span>
            </div>`).join('')}
          </div>
        </div>
        <p class="muted" style="text-align:center">รอคนสร้างห้องเริ่มรอบใหม่…${enLine('Waiting for the host to start a new round…')}</p>`;
    },
  };

  return U;
}
