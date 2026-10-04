// ตั้งค่าโหมดออนไลน์ (เล่นหลายเครื่องผ่าน Supabase Realtime โดยไม่ต้องเปิดเซิร์ฟเวอร์เอง)
// ใส่ค่าจาก Supabase › Project Settings › API (ทั้งสองค่าเปิดเผยได้ ออกแบบมาให้อยู่ในหน้าเว็บ)
// ถ้าเว้นว่างไว้ โหมดหลายเครื่องจะใช้ server.py บนเครื่องแทน
window.WW_CONFIG = {
  supabaseUrl: 'https://kiylyxhncsjgjnwecjpn.supabase.co',     // โปรเจกต์ Supabase "boardgame"
  supabaseAnonKey: 'sb_publishable_l56CjYFU4Uai5ZbRTKiGpw_lh3uYNGA',  // คีย์ publishable (เปิดเผยได้)
};
