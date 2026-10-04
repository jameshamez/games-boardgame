'use strict';
// บทพากย์เกมหนูขโมยชีส (ไทย + อังกฤษ) — ใช้ทั้งในเกมและสคริปต์อัดเสียง (tools/build_voice.py cheese)
// แต่ละบรรทัดเป็นข้อความ หรืออาร์เรย์ของชิ้นส่วน [ชื่อผู้เล่น, ข้อความ]

const TALK_OPTIONS = [60, 120, 180, 240, 300, 420];

function minutesText(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s} วินาที`;
  return s ? `${m} นาที ${s} วินาที` : `${m} นาที`;
}
function minutesTextEn(sec) {
  const m = Math.floor(sec / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

const LINES = {
  nightStart: ['ค่ำคืนในบ้านหนูมาถึงแล้ว', 'ทุกคนหลับตาลง', 'แล้วฟังเสียงนาฬิกาให้ดี'],
  hour: h => [`ตี ${h}`, `ใครได้เลข ${h} ลืมตาขึ้น`],
  hourSleep: ['หลับตาลง'],
  thiefWake: ['หัวขโมย ลืมตาขึ้น', 'เลือกผู้สมรู้ร่วมคิดบนมือถือ'],
  thiefSleep: ['หัวขโมย หลับตาลง'],
  dawn: ['ไก่ขันแล้ว', 'เช้าแล้ว ทุกคนลืมตาขึ้น', 'ชีสหายไปแล้ว!', 'ใครคือหัวขโมย'],
  talk: sec => ['ถึงเวลาคุยกัน', `ทุกคนมีเวลา ${minutesText(sec)} หาตัวหัวขโมย`],
  talk30: ['เหลือเวลาอีก 30 วินาที'],
  talkEnd: ['หมดเวลาคุย'],
  vote: ['ถึงเวลาโหวต', 'ทุกคนเลือกผู้ต้องสงสัยบนมือถือ'],
  caught: name => [['จับได้แล้ว!', name, 'คือหัวขโมย'], 'ฝ่ายหนู ชนะ!'],
  escaped: name => [['หัวขโมยหนีรอดไปได้!', name, 'คือหัวขโมย'], 'หัวขโมย ชนะ!'],
  test: ['สวัสดีชาวหนูทุกตัว ระวังชีสของคุณให้ดี'],
};

const EN_FIXED = {
  'ค่ำคืนในบ้านหนูมาถึงแล้ว': 'Night falls on the mouse house.',
  'ทุกคนหลับตาลง': 'Everyone, close your eyes.',
  'แล้วฟังเสียงนาฬิกาให้ดี': 'Listen carefully to the clock.',
  'หลับตาลง': 'Close your eyes.',
  'หัวขโมย ลืมตาขึ้น': 'Cheese Thief, open your eyes.',
  'เลือกผู้สมรู้ร่วมคิดบนมือถือ': 'Choose your accomplice on your phone.',
  'หัวขโมย หลับตาลง': 'Cheese Thief, close your eyes.',
  'ไก่ขันแล้ว': 'Cock-a-doodle-doo!',
  'เช้าแล้ว ทุกคนลืมตาขึ้น': 'Good morning, everyone open your eyes.',
  'ชีสหายไปแล้ว!': 'The cheese is gone!',
  'ใครคือหัวขโมย': 'Who is the Cheese Thief?',
  'ถึงเวลาคุยกัน': 'Time to discuss.',
  'เหลือเวลาอีก 30 วินาที': '30 seconds left.',
  'หมดเวลาคุย': 'Time is up.',
  'ถึงเวลาโหวต': 'Time to vote.',
  'ทุกคนเลือกผู้ต้องสงสัยบนมือถือ': 'Everyone, choose your suspect on your phone.',
  'จับได้แล้ว!': 'Caught!',
  'คือหัวขโมย': 'is the Cheese Thief.',
  'ฝ่ายหนู ชนะ!': 'The mice win!',
  'หัวขโมยหนีรอดไปได้!': 'The thief got away!',
  'หัวขโมย ชนะ!': 'The Cheese Thief wins!',
  'สวัสดีชาวหนูทุกตัว ระวังชีสของคุณให้ดี': 'Hello little mice, keep an eye on your cheese.',
};

const EN = (() => {
  const map = Object.assign({}, EN_FIXED);
  for (let h = 1; h <= 6; h++) {
    map[`ตี ${h}`] = `${h} o'clock.`;
    map[`ใครได้เลข ${h} ลืมตาขึ้น`] = `If your die shows ${h}, open your eyes.`;
  }
  TALK_OPTIONS.forEach(s => {
    map[`ทุกคนมีเวลา ${minutesText(s)} หาตัวหัวขโมย`] = `You have ${minutesTextEn(s)} to find the thief.`;
  });
  return map;
})();

function englishLine(line) {
  const parts = Array.isArray(line) ? line : [line];
  return parts.map(p => EN[p] || p);
}

function allFixedPhrases() {
  const NAME = '\u0000';
  const out = new Set();
  const add = lines => lines.flat().forEach(p => { if (p !== NAME) out.add(p); });
  for (const [key, val] of Object.entries(LINES)) {
    if (Array.isArray(val)) add(val);
    else if (key === 'hour') for (let h = 1; h <= 6; h++) add(val(h));
    else if (key === 'talk') TALK_OPTIONS.forEach(s => add(val(s)));
    else add(val(NAME));
  }
  return [...out];
}

function allEnglishPhrases() {
  const all = allFixedPhrases();
  return { phrases: [...new Set(all.map(p => EN[p]).filter(Boolean))], missing: all.filter(p => !EN[p]) };
}
