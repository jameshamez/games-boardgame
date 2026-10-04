'use strict';
// เครื่องเล่นเสียงพากย์ (ใช้ทั้งเครื่องคนสร้างห้องและมือถือผู้เล่น)
// ลำดับการเลือกเสียง: ไฟล์ที่อัดไว้ (voice/manifest.js) › server.py สร้างเสียงสด › เสียงของเบราว์เซอร์ › แสดงข้อความอย่างเดียว

const Voice = {
  voices: [],
  audio: new Audio(),
  server: false,        // มี server.py ที่สร้างเสียงชื่อผู้เล่นได้หรือไม่
  speechWorks: false,   // เสียงของเบราว์เซอร์เคยพูดได้จริง
  speechBroken: false,  // เสียงของเบราว์เซอร์ค้าง ไม่ยอมพูด
  current: null,

  load() {
    if (!('speechSynthesis' in window)) return;
    Voice.voices = speechSynthesis.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('th'));
  },
  cfg: () => ({ voice: true, rate: 1, voiceURI: '' }),  // หน้าเว็บที่ใช้กำหนดเองได้
  blocked: false,       // เบราว์เซอร์ไม่ยอมให้เล่นเสียงจนกว่าผู้ใช้จะแตะหน้าจอ
  onBlocked: () => {},
  pick() {
    return Voice.voices.find(v => v.voiceURI === Voice.cfg().voiceURI) || Voice.voices[0] || null;
  },
  async checkServer() {
    try { Voice.server = (await fetch('/tts?text=')).status === 204; } catch { Voice.server = false; }
  },

  /** เล่นไฟล์เสียง คืน true ถ้าเล่นได้ (หรือถูกสั่งหยุด) */
  playUrl(url) {
    return new Promise(resolve => {
      const a = Voice.audio;
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        a.onended = a.onerror = a.onpause = null;
        resolve(ok);
      };
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      a.onpause = () => finish(true);
      a.src = url;
      a.playbackRate = Voice.cfg().rate;
      a.play().then(() => { Voice.blocked = false; }).catch(err => {
        if (err && err.name === 'NotAllowedError') { Voice.blocked = true; Voice.onBlocked(); }
        finish(false);
      });
      setTimeout(() => finish(true), 20000);
    });
  },

  /** พูดข้อความหนึ่งชิ้น: ไฟล์ที่อัดไว้ › เซิร์ฟเวอร์สร้างเสียง › เสียงเบราว์เซอร์ › แสดงข้อความอย่างเดียว */
  async speak(text) {
    const fallbackMs = Math.min(900 + text.length * 70, 3500);
    if (!Voice.cfg().voice) return new Promise(r => setTimeout(r, fallbackMs));
    const file = typeof VOICE_MANIFEST !== 'undefined' && VOICE_MANIFEST[text];
    if (file && await Voice.playUrl('voice/' + file)) return;
    if (Voice.server && await Voice.playUrl('/tts?text=' + encodeURIComponent(text))) return;
    return Voice.speakBrowser(text, fallbackMs);
  },

  speakBrowser(text, fallbackMs) {
    return new Promise(resolve => {
      if (Voice.speechBroken || !('speechSynthesis' in window)) return setTimeout(resolve, fallbackMs);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'th-TH';
      const v = Voice.pick();
      if (v) u.voice = v;
      u.rate = Voice.cfg().rate;
      u.onstart = () => { Voice.speechWorks = true; };
      u.onend = finish;
      u.onerror = finish;
      Voice.current = u;
      // Chrome มักทิ้งประโยคที่สั่งพูดทันทีหลัง cancel() จึงเว้นจังหวะเล็กน้อย
      setTimeout(() => {
        if (done) return;
        speechSynthesis.resume();
        speechSynthesis.speak(u);
        setTimeout(() => {
          if (!done && !Voice.speechWorks) {
            Voice.speechBroken = true;
            speechSynthesis.cancel();
            showVoiceWarning();
            setTimeout(finish, fallbackMs);
          }
        }, 3000);
      }, 80);
      setTimeout(finish, fallbackMs * 3 / Voice.cfg().rate + 1500);
    });
  },

  stop() {
    Voice.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },

  unlock() {
    // Safari/iOS ต้องเริ่มเล่นเสียงจากการแตะของผู้ใช้หนึ่งครั้งก่อน
    const a = Voice.audio;
    const first = typeof VOICE_MANIFEST !== 'undefined' && Object.values(VOICE_MANIFEST)[0];
    if (first && a.paused) {
      a.muted = true;
      a.src = 'voice/' + first;
      a.play().then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
    }
  },
};
Voice.checkServer();
if ('speechSynthesis' in window) {
  Voice.load();
  speechSynthesis.addEventListener?.('voiceschanged', Voice.load);
}

function showVoiceWarning() {
  const el = document.getElementById('voice-warning');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `🔇 พากย์ชื่อผู้เล่นไม่ได้ จะแสดงชื่อเป็นข้อความแทน (บทพากย์อื่นยังมีเสียงปกติ)<br>
    <small>เบราว์เซอร์นี้ไม่มีเสียงภาษาไทย — ลองเปิดด้วย Chrome หรือ Safari หรือเปิดผ่าน python3 server.py บน Mac</small>`;
}

