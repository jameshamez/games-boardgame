'use strict';
// เล่นบทพากย์บนมือถือผู้เล่น ตามที่เครื่องคนสร้างห้องส่งมา (ใช้ร่วมทุกเกมที่มีเสียงพากย์)
// หน้าเว็บต้องมี #narr (แถบซับไตเติล), #mute (ปุ่มปิดเสียง), #unlock (ปุ่มแตะเพื่อเปิดเสียง) และโหลด assets/voice.js ก่อน

function setupNarration(pnet) {
  const Narr = {
    queue: [],
    playing: false,
    gen: 0,
    muted: (() => { try { return localStorage.getItem('party.mute') === '1'; } catch { return false; } })(),
    hideTimer: null,
  };
  Voice.cfg = () => ({ voice: !Narr.muted, rate: 1, voiceURI: '' });

  const $narr = document.getElementById('narr');
  const $mute = document.getElementById('mute');
  const $unlock = document.getElementById('unlock');

  function showNarr(say) {
    clearTimeout(Narr.hideTimer);
    $narr.hidden = false;
    $narr.querySelector('.narr-th').textContent = say.sub || '';
    $narr.querySelector('.narr-en').textContent = say.subEn || '';
  }

  function onSay(say) {
    if (say.kind === 'hush') {
      Narr.queue = [];
      Narr.gen += 1;
      Voice.stop();
      return;
    }
    Narr.queue.push(say);
    if (Narr.queue.length > 3) Narr.queue.shift();  // ตามไม่ทันก็ข้ามบรรทัดเก่า
    pumpNarr();
  }

  async function pumpNarr() {
    if (Narr.playing) return;
    Narr.playing = true;
    while (Narr.queue.length) {
      const say = Narr.queue.shift();
      const gen = Narr.gen;
      showNarr(say);
      for (const part of say.parts || []) {
        if (gen !== Narr.gen) break;
        await Voice.speak(part);
        if (!Voice.blocked) $unlock.hidden = true;  // เล่นเสียงได้แล้ว ซ่อนปุ่มเปิดเสียง
      }
    }
    Narr.playing = false;
    Narr.hideTimer = setTimeout(() => { $narr.hidden = true; }, 2500);
  }

  function renderMute() {
    $mute.textContent = Narr.muted ? '🔇' : '🔊';
    $mute.title = Narr.muted ? 'เปิดเสียงพากย์ · Unmute narration' : 'ปิดเสียงพากย์ · Mute narration';
  }
  $mute.addEventListener('click', () => {
    Narr.muted = !Narr.muted;
    try { localStorage.setItem('party.mute', Narr.muted ? '1' : '0'); } catch { /* ignore */ }
    if (Narr.muted) Voice.stop(); else Voice.unlock();
    renderMute();
  });
  renderMute();

  // เบราว์เซอร์มือถือไม่ให้เล่นเสียงจนกว่าจะแตะหน้าจอ: ปลดล็อกตอนแตะครั้งแรก หรือกดแถบด้านบน
  Voice.onBlocked = () => { if (!Narr.muted) $unlock.hidden = false; };
  $unlock.addEventListener('click', () => { Voice.unlock(); $unlock.hidden = true; });
  document.addEventListener('click', () => Voice.unlock(), { once: true });

  pnet.onSay = onSay;
}
