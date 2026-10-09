'use strict';
// บทพากย์ทั่วไปของเกม — ใช้ร่วมกันระหว่างตัวเกม (เบราว์เซอร์) และสคริปต์อัดเสียง (tools/build_voice.py)
// แต่ละบรรทัดเป็นข้อความ หรือเป็นอาร์เรย์ของชิ้นส่วน (เช่น [ชื่อผู้เล่น, ข้อความ])
// ชิ้นส่วนที่เป็นข้อความคงที่จะถูกอัดเสียงไว้ล่วงหน้า ส่วนชื่อผู้เล่นสร้างเสียงตอนเล่น
// ต้องโหลดหลัง roles.js

const TALK_OPTIONS = [60, 90, 120, 180, 240, 300, 420, 600];
const MAX_DAYS = 30;

function minutesText(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s} วินาที`;
  return s ? `${m} นาที ${s} วินาที` : `${m} นาที`;
}

const LINES = {
  nightStart: n => [`ค่ำคืนที่ ${n} มาถึงแล้ว`, 'ทุกคนหลับตาลง แล้วคว่ำหน้าลง'],
  sleep: role => [`${ROLES[role].name} หลับตาลง`],
  wolfSleep: ['มนุษย์หมาป่า หลับตาลง'],
  loversWake: ['ผู้ที่ถูกกามเทพแตะไหล่ ลืมตาขึ้น', 'มองหน้าคู่รักของคุณให้ดี'],
  loversSleep: ['คู่รัก หลับตาลง'],
  cupidTouch: ['กามเทพ แตะไหล่คู่รักทั้งสองคนเบา ๆ'],
  dawn: n => ['ฟ้าสางแล้ว', 'ทุกคนลืมตาขึ้นได้', `เช้าวันที่ ${n}`],
  nobodyDied: ['เมื่อคืนนี้ เป็นคืนที่สงบ', 'ไม่มีใครตาย'],
  deathCount: n => [`เมื่อคืนนี้ มีผู้เสียชีวิต ${n} คน`],
  died: name => [[name, 'เสียชีวิตแล้ว']],
  revealRole: (name, role) => [[name, `คือ ${ROLES[role].name}`]],
  lover: name => [[name, 'ตรอมใจตายตามคนรัก']],
  bomberBoom: ['ตูม! มือระเบิดพลีชีพระเบิดตัวเอง'],
  bombed: name => [[name, 'โดนแรงระเบิดเสียชีวิต']],
  hunter: name => [[name, 'คือนายพราน'], 'ก่อนสิ้นใจ จงเลือกผู้เล่นหนึ่งคนที่จะยิงไปด้วย'],
  hunterShot: name => [['นายพรานยิง', name]],
  banished: name => [[name, 'ถูกแม่หมอสาปให้ออกจากหมู่บ้านในวันนี้'], 'ห้ามพูด ห้ามโหวต และไม่ถูกโหวต'],
  silenced: name => [[name, 'ถูกจอมเวทร่ายมนตร์ ห้ามพูดตลอดวันนี้']],
  trouble: ['ตัวป่วนก่อเรื่องวุ่นวาย', 'วันนี้จะมีการประหารสองครั้ง'],
  talk: sec => ['ถึงเวลาอภิปราย', `ทุกคนมีเวลา ${minutesText(sec)} คุยกันเพื่อหาตัวหมาป่า`],
  talk30: ['เหลือเวลาอีก 30 วินาที'],
  talkEnd: ['หมดเวลาอภิปราย'],
  noVoteFirstDay: ['วันแรกยังไม่มีการลงคะแนน'],
  noExecutionFirstDay: ['วันแรกไม่มีการประหาร', 'เตรียมตัวเข้าสู่ค่ำคืน'],
  vote: ['ถึงเวลาลงคะแนน', 'นับสาม สอง หนึ่ง', 'ทุกคนชี้ไปที่ผู้ต้องสงสัยพร้อมกัน'],
  voteSecond: ['การประหารรอบที่สอง', 'นับสาม สอง หนึ่ง', 'ทุกคนชี้ไปที่ผู้ต้องสงสัยพร้อมกัน'],
  executed: name => [['หมู่บ้านลงมติ ประหาร', name]],
  prince: name => [[name, 'เผยตัวว่าเป็นเจ้าชาย'], 'จึงรอดพ้นจากการประหาร'],
  noExecution: ['หมู่บ้านไม่สามารถตัดสินใจได้', 'จึงไม่มีการประหาร'],
  villageWin: ['หมาป่าตัวสุดท้ายถูกกำจัดแล้ว', 'ฝ่ายชาวบ้าน ชนะ!'],
  wolfWin: ['หมาป่ามีจำนวนมากพอจะครองหมู่บ้านแล้ว', 'ฝ่ายมนุษย์หมาป่า ชนะ!'],
  tannerWin: ['ยาจกถูกประหารสมใจ', 'ยาจก ชนะ!'],
  test: ['สวัสดีชาวบ้านทุกคน ยินดีต้อนรับสู่หมู่บ้านมนุษย์หมาป่า'],
};

/** ข้อความคงที่ทุกชิ้นที่ต้องอัดเสียงล่วงหน้า (ไม่รวมชื่อผู้เล่น) */
function allFixedPhrases() {
  const NAME = '\u0000';
  const out = new Set();
  const add = lines => lines.flat().forEach(p => { if (p !== NAME) out.add(p); });
  for (const [key, val] of Object.entries(LINES)) {
    if (Array.isArray(val)) add(val);
    else if (key === 'nightStart' || key === 'dawn') for (let n = 1; n <= MAX_DAYS; n++) add(val(n));
    else if (key === 'deathCount') for (let n = 1; n <= 8; n++) add(val(n));
    else if (key === 'talk') TALK_OPTIONS.forEach(s => add(val(s)));
    else if (key === 'sleep') Object.keys(ROLES).filter(r => ROLES[r].wake).forEach(r => add(val(r)));
    else if (key === 'revealRole') Object.keys(ROLES).forEach(r => add(val(NAME, r)));
    else add(val(NAME));
  }
  Object.values(ROLES).forEach(r => r.wake && add(r.wake));
  Object.values(WOLF_WAKE).forEach(add);
  return [...out];
}

// ---------- คำแปลภาษาอังกฤษ (พากย์ต่อท้ายภาษาไทย) ----------
const EN_FIXED = {
  'ทุกคนหลับตาลง แล้วคว่ำหน้าลง': 'Everyone, close your eyes and put your heads down.',
  'ผู้ที่ถูกกามเทพแตะไหล่ ลืมตาขึ้น': 'If Cupid tapped your shoulder, open your eyes.',
  'มองหน้าคู่รักของคุณให้ดี': 'Look closely at your lover.',
  'คู่รัก หลับตาลง': 'Lovers, close your eyes.',
  'กามเทพ แตะไหล่คู่รักทั้งสองคนเบา ๆ': 'Cupid, gently tap the shoulders of both lovers.',
  'ฟ้าสางแล้ว': 'The sun is rising.',
  'ทุกคนลืมตาขึ้นได้': 'Everyone, open your eyes.',
  'เมื่อคืนนี้ เป็นคืนที่สงบ': 'Last night was peaceful.',
  'ไม่มีใครตาย': 'Nobody died.',
  'เสียชีวิตแล้ว': 'has died.',
  'ตรอมใจตายตามคนรัก': 'died of a broken heart.',
  'ตูม! มือระเบิดพลีชีพระเบิดตัวเอง': 'Boom! The Mad Bomber exploded.',
  'โดนแรงระเบิดเสียชีวิต': 'was killed by the blast.',
  'คือนายพราน': 'is the Hunter.',
  'ก่อนสิ้นใจ จงเลือกผู้เล่นหนึ่งคนที่จะยิงไปด้วย': 'With your last breath, choose one player to shoot.',
  'นายพรานยิง': 'The Hunter shot',
  'ถูกแม่หมอสาปให้ออกจากหมู่บ้านในวันนี้': 'has been banished from the village today by the Old Hag.',
  'ห้ามพูด ห้ามโหวต และไม่ถูกโหวต': 'They may not speak, vote, or be voted for.',
  'ถูกจอมเวทร่ายมนตร์ ห้ามพูดตลอดวันนี้': 'has been silenced by the Spellcaster for today.',
  'ตัวป่วนก่อเรื่องวุ่นวาย': 'The Troublemaker has stirred up chaos.',
  'วันนี้จะมีการประหารสองครั้ง': 'There will be two executions today.',
  'ถึงเวลาอภิปราย': 'Time for discussion.',
  'เหลือเวลาอีก 30 วินาที': '30 seconds left.',
  'หมดเวลาอภิปราย': 'Discussion time is over.',
  'วันแรกยังไม่มีการลงคะแนน': 'There is no vote on the first day.',
  'วันแรกไม่มีการประหาร': 'No one is executed on the first day.',
  'เตรียมตัวเข้าสู่ค่ำคืน': 'Get ready for the night.',
  'ถึงเวลาลงคะแนน': 'Time to vote.',
  'นับสาม สอง หนึ่ง': 'Three, two, one.',
  'ทุกคนชี้ไปที่ผู้ต้องสงสัยพร้อมกัน': 'Everyone, point at your suspect.',
  'การประหารรอบที่สอง': 'Second execution.',
  'หมู่บ้านลงมติ ประหาร': 'The village has voted to execute',
  'เผยตัวว่าเป็นเจ้าชาย': 'reveals they are the Prince,',
  'จึงรอดพ้นจากการประหาร': 'and is spared from execution.',
  'หมู่บ้านไม่สามารถตัดสินใจได้': 'The village could not decide.',
  'จึงไม่มีการประหาร': 'There is no execution.',
  'หมาป่าตัวสุดท้ายถูกกำจัดแล้ว': 'The last werewolf has been eliminated.',
  'ฝ่ายชาวบ้าน ชนะ!': 'The villagers win!',
  'หมาป่ามีจำนวนมากพอจะครองหมู่บ้านแล้ว': 'The werewolves now control the village.',
  'ฝ่ายมนุษย์หมาป่า ชนะ!': 'The werewolves win!',
  'ยาจกถูกประหารสมใจ': 'The Tanner got their wish and was executed.',
  'ยาจก ชนะ!': 'The Tanner wins!',
  'สวัสดีชาวบ้านทุกคน ยินดีต้อนรับสู่หมู่บ้านมนุษย์หมาป่า': 'Hello villagers, welcome to the werewolf village.',
  'เลือกผู้เล่นหนึ่งคนที่ต้องการตรวจสอบ': 'Choose one player to investigate.',
  'เลือกผู้เล่นหนึ่งคน เพื่อดูว่ามีพลังพิเศษหรือไม่': 'Choose one player to see if they have a special power.',
  'เลือกผู้เล่นหนึ่งคน เพื่อดูบทบาทที่แท้จริง': 'Choose one player to see their true role.',
  'เลือกผู้เล่นสองคน เพื่อดูว่าอยู่ฝ่ายเดียวกันหรือไม่': 'Choose two players to see if they are on the same team.',
  'จะใช้พลังสืบสวนคืนนี้หรือไม่': 'Will you investigate tonight?',
  'เลือกผู้เล่นหนึ่งคนที่จะปกป้องในคืนนี้': 'Choose one player to protect tonight.',
  'จะอวยพรใครหรือไม่': 'Will you bless anyone?',
  'ดูว่าคืนนี้ใครถูกทำร้าย แล้วตัดสินใจว่าจะใช้ยาหรือไม่': 'See who was attacked tonight, and decide whether to use a potion.',
  'จะล่าใครในคืนนี้หรือไม่': 'Will you hunt anyone tonight?',
  'จะชี้ตัวใครหรือไม่ ถ้าชี้ผิด คุณจะตายเอง': 'Will you reveal anyone? If you are wrong, you will die.',
  'เลือกผู้เล่นสองคนให้เป็นคู่รักกัน': 'Choose two players to fall in love.',
  'มองหน้ากันให้จำว่าใครเป็นพี่น้องภราดร': 'Look at each other and remember your fellow Masons.',
  'เลือกผู้เล่นหนึ่งคน ที่จะสาปให้ออกจากหมู่บ้านในวันพรุ่งนี้': 'Choose one player to banish from the village tomorrow.',
  'เลือกผู้เล่นหนึ่งคน ที่จะห้ามพูดในวันพรุ่งนี้': 'Choose one player to silence tomorrow.',
  'จะป่วนให้พรุ่งนี้มีการประหารสองครั้งหรือไม่': 'Will you cause two executions tomorrow?',
  'ดูหน้าจอว่าคืนนี้คุณยังเป็นมนุษย์อยู่หรือไม่': 'Look at the screen to see if you are still human.',
  'ดูหน้าจอให้จำว่าใครคือมนุษย์หมาป่า': 'Look at the screen and remember who the werewolves are.',
  'เลือกผู้เล่นหนึ่งคน เพื่อดูว่าเป็นเทพพยากรณ์หรือไม่': 'Choose one player to see if they are the Seer.',
  'มองหน้ากันให้จำว่าใครเป็นพวกเดียวกัน': 'Look at each other and remember your pack.',
  'แล้วเลือกเหยื่อที่จะกำจัดในคืนนี้': 'Then choose your victim for tonight.',
  'เลือกเหยื่อที่จะกำจัดในคืนนี้': 'Choose your victim for tonight.',
  'ฝูงหมาป่าโกรธแค้นที่ลูกหมาป่าตาย': 'The pack is enraged by the death of the Wolf Cub.',
  'คืนนี้เลือกเหยื่อได้สองคน': 'Tonight you may choose two victims.',
  'เมื่อคืนพวกคุณกินผู้ป่วยติดเชื้อเข้าไป': 'Last night you ate the Diseased.',
  'คืนนี้ป่วยหนัก ล่าใครไม่ได้': 'You are too sick to hunt tonight.',
};

function minutesTextEn(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  const mm = m === 1 ? '1 minute' : `${m} minutes`;
  if (!m) return `${s} seconds`;
  return s ? `${mm} ${s} seconds` : mm;
}

/** ตาราง ไทย → อังกฤษ ของทุกชิ้นข้อความคงที่ (สร้างครั้งเดียว) */
const EN = (() => {
  const map = Object.assign({}, EN_FIXED);
  const article = r => (['villager', 'werewolf'].includes(r) ? 'a' : 'the');
  for (const [key, r] of Object.entries(ROLES)) {
    const plural = key === 'werewolf' ? 'Werewolves' : key === 'mason' ? 'Masons' : r.en;
    map[`${r.name} ลืมตาขึ้น`] = `${plural}, open your eyes.`;
    map[`${r.name} หลับตาลง`] = `${plural}, close your eyes.`;
    map[`คือ ${r.name}`] = `is ${article(key)} ${r.en}.`;
  }
  for (let n = 1; n <= MAX_DAYS; n++) {
    map[`ค่ำคืนที่ ${n} มาถึงแล้ว`] = `Night ${n} has fallen.`;
    map[`เช้าวันที่ ${n}`] = `Day ${n}.`;
  }
  for (let n = 1; n <= 8; n++) {
    map[`เมื่อคืนนี้ มีผู้เสียชีวิต ${n} คน`] = n === 1 ? 'Last night, one player died.' : `Last night, ${n} players died.`;
  }
  TALK_OPTIONS.forEach(s => {
    map[`ทุกคนมีเวลา ${minutesText(s)} คุยกันเพื่อหาตัวหมาป่า`] = `You have ${minutesTextEn(s)} to find the werewolves.`;
  });
  return map;
})();

/** แปลบรรทัดเป็นอังกฤษ: ชิ้นที่ไม่มีคำแปล (เช่นชื่อผู้เล่น) ใช้ตามเดิม */
function englishLine(line) {
  const parts = Array.isArray(line) ? line : [line];
  return parts.map(p => EN[p] || p);
}

/** คำแปลอังกฤษของทุกข้อความคงที่ (ใช้อัดเสียง) — คืนรายการที่ขาดคำแปลไว้ใน missing */
function allEnglishPhrases() {
  const missing = allFixedPhrases().filter(p => !EN[p]);
  return { phrases: [...new Set(allFixedPhrases().map(p => EN[p]).filter(Boolean))], missing };
}
