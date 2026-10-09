#!/usr/bin/env python3
"""เซิร์ฟเวอร์สำหรับเล่นบนเครื่อง Mac

- เปิดไฟล์เกม
- สร้างเสียงพากย์ชื่อผู้เล่นแบบสด ๆ (/tts)
- ห้องเล่นหลายเครื่อง: Mac เป็นเครื่องหลัก ผู้เล่นใช้มือถือที่ต่อ Wi-Fi เดียวกันเข้าร่วม (/api/...)

ใช้:  python3 server.py            เล่นใน Wi-Fi เดียวกัน
      python3 server.py --public   เปิดลิงก์สาธารณะ (ผ่าน cloudflared หรือ ngrok) ให้มือถือเข้าได้จากทุกเครือข่าย
แล้วเปิด http://localhost:8765
"""
import argparse
import atexit
import hashlib
import http.server
import json
import random
import re
import secrets
import shutil
import subprocess
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
from build_voice import VOICE, VOICE_EN, synth  # noqa: E402

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".tts-cache"
PORT = 8765
ONLINE_SECONDS = 6
MAX_ACTIONS = 500
PUBLIC = {"url": None, "enabled": False}
FAILED_JOINS = []  # เวลาที่มีคนใส่รหัสห้องผิด (กันการเดารหัสเมื่อเปิดลิงก์สาธารณะ)


def lan_ip() -> str:
    """IP ของเครื่องนี้ในวง Wi-Fi (ไม่ได้ส่งข้อมูลออกไปจริง แค่ให้ระบบเลือกการ์ดเครือข่าย)"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class Room:
    """ห้องเล่นหลายเครื่อง (มีได้ทีละห้อง) — เครื่องหลักเป็นคนคุมเกมทั้งหมด เซิร์ฟเวอร์แค่ส่งต่อข้อมูล"""

    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        # ลิงก์สาธารณะใช้เลขห้อง 6 หลัก เพราะใครในอินเทอร์เน็ตก็เข้าถึงเซิร์ฟเวอร์ได้
        if PUBLIC["enabled"]:
            self.code = str(100000 + secrets.randbelow(900000))
        else:
            self.code = f"{random.randint(0, 9999):04d}"
        self.key = secrets.token_hex(16)
        self.players = {}   # pid -> {name, token, seen}
        self.order = []
        self.views = {}     # pid -> ข้อมูลหน้าจอของผู้เล่นคนนั้น (เห็นเฉพาะเจ้าตัว)
        self.version = 0
        self.actions = []   # [{seq, pid, action}]
        self.seq = 0
        self.says = []      # บทพากย์ล่าสุด ให้มือถือพากย์ตาม [{seq, kind, ...}]

    def player_list(self):
        now = time.time()
        return [{"pid": pid, "name": self.players[pid]["name"],
                 "online": now - self.players[pid]["seen"] < ONLINE_SECONDS} for pid in self.order]


ROOM = Room()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/" not in self.path:  # ไม่ต้องพิมพ์ทุกครั้งที่มือถือถามสถานะ
            super().log_message(fmt, *args)

    def end_headers(self):
        # ไฟล์เกมเปลี่ยนบ่อยระหว่างพัฒนา: ให้เบราว์เซอร์ตรวจสอบไฟล์ใหม่ทุกครั้ง
        if not self.path.startswith("/tts"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ---------- ตัวช่วย ----------
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n or n > 2_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            return {}

    # ---------- GET ----------
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if url.path == "/tts":
            return self.tts(q.get("text", ""))
        if url.path == "/api/info":
            return self.send_json({"lan": f"http://{lan_ip()}:{PORT}", "public": PUBLIC["url"]})
        if url.path == "/api/host/poll":
            return self.host_poll(q)
        if url.path == "/api/view":
            return self.player_view(q)
        return super().do_GET()

    def tts(self, text):
        text = text.strip()[:60]
        if not text:
            self.send_response(204)
            self.end_headers()
            return
        CACHE.mkdir(exist_ok=True)
        # ข้อความที่มีอักษรไทยใช้เสียงไทย นอกนั้น (เช่นชื่อภาษาอังกฤษ) ใช้เสียงอังกฤษ
        voice = VOICE if re.search("[฀-๿]", text) else VOICE_EN
        out = CACHE / (hashlib.sha1(f"{voice}:{text}".encode("utf-8")).hexdigest()[:16] + ".m4a")
        try:
            if not out.exists():
                synth(text, out, voice)
        except Exception as e:  # say ไม่มีหรือสร้างไฟล์ไม่ได้
            self.send_error(500, str(e))
            return
        data = out.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def host_poll(self, q):
        with ROOM.lock:
            if q.get("key") != ROOM.key:
                return self.send_json({"error": "badkey"}, 403)
            since = int(q.get("since") or 0)
            actions = [a for a in ROOM.actions if a["seq"] > since]
            return self.send_json({"players": ROOM.player_list(), "actions": actions, "public": PUBLIC["url"]})

    def player_view(self, q):
        with ROOM.lock:
            p = ROOM.players.get(q.get("pid", ""))
            if not p or p["token"] != q.get("token"):
                return self.send_json({"error": "unknown"}, 404)
            p["seen"] = time.time()
            since = int(q.get("say") or 0)
            says = [s for s in ROOM.says if s.get("seq", 0) > since]
            if q.get("v") == str(ROOM.version):
                return self.send_json({"v": ROOM.version, "same": True, "says": says})
            view = ROOM.views.get(q["pid"]) or {"phase": "lobby", "name": p["name"]}
            return self.send_json({"v": ROOM.version, "view": view, "says": says})

    # ---------- POST ----------
    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        data = self.read_json()
        routes = {
            "/api/host/new": self.host_new,
            "/api/host/views": self.host_views,
            "/api/host/kick": self.host_kick,
            "/api/host/say": self.host_say,
            "/api/join": self.join,
            "/api/action": self.action,
        }
        fn = routes.get(url.path)
        if not fn:
            return self.send_json({"error": "notfound"}, 404)
        with ROOM.lock:
            return fn(data)

    def host_new(self, data):
        # ถ้าเครื่องหลักรีเฟรชหน้า ให้กลับเข้าห้องเดิมได้ด้วย key เดิม
        if data.get("key") != ROOM.key:
            ROOM.reset()
        return self.send_json({"room": ROOM.code, "key": ROOM.key})

    def host_views(self, data):
        if data.get("key") != ROOM.key:
            return self.send_json({"error": "badkey"}, 403)
        ROOM.views = data.get("views") or {}
        ROOM.version += 1
        return self.send_json({"ok": True, "v": ROOM.version})

    def host_say(self, data):
        if data.get("key") != ROOM.key:
            return self.send_json({"error": "badkey"}, 403)
        if isinstance(data.get("say"), dict):
            ROOM.says.append(data["say"])
            del ROOM.says[:-20]
        return self.send_json({"ok": True})

    def host_kick(self, data):
        if data.get("key") != ROOM.key:
            return self.send_json({"error": "badkey"}, 403)
        pid = data.get("pid")
        if pid in ROOM.players:
            del ROOM.players[pid]
            ROOM.order.remove(pid)
        return self.send_json({"ok": True})

    def join(self, data):
        now = time.time()
        FAILED_JOINS[:] = [t for t in FAILED_JOINS if now - t < 60]
        if len(FAILED_JOINS) >= 20:
            return self.send_json({"error": "ใส่รหัสผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่ · Too many wrong codes — wait a moment and try again"}, 429)
        if str(data.get("room", "")).strip().upper() != ROOM.code:
            FAILED_JOINS.append(now)
            return self.send_json({"error": "รหัสห้องไม่ถูกต้อง · Wrong room code"}, 400)
        # กลับเข้าห้องเดิม (เช่นรีเฟรชหน้า)
        pid, token = data.get("pid"), data.get("token")
        if pid in ROOM.players and ROOM.players[pid]["token"] == token:
            return self.send_json({"pid": pid, "token": token, "name": ROOM.players[pid]["name"]})
        name = str(data.get("name", "")).strip()[:20]
        if not name:
            return self.send_json({"error": "กรุณาใส่ชื่อ · Please enter a name"}, 400)
        if any(p["name"].lower() == name.lower() for p in ROOM.players.values()):
            return self.send_json({"error": "ชื่อนี้มีคนใช้แล้ว · That name is taken"}, 400)
        pid, token = secrets.token_hex(4), secrets.token_hex(12)
        ROOM.players[pid] = {"name": name, "token": token, "seen": time.time()}
        ROOM.order.append(pid)
        return self.send_json({"pid": pid, "token": token, "name": name})

    def action(self, data):
        p = ROOM.players.get(data.get("pid", ""))
        if not p or p["token"] != data.get("token") or not isinstance(data.get("action"), dict):
            return self.send_json({"error": "unknown"}, 404)
        p["seen"] = time.time()
        ROOM.seq += 1
        ROOM.actions.append({"seq": ROOM.seq, "pid": data["pid"], "action": data["action"]})
        del ROOM.actions[:-MAX_ACTIONS]
        return self.send_json({"ok": True})


# ---------- ลิงก์สาธารณะ (tunnel) ----------
def start_tunnel():
    """เปิด tunnel ด้วย cloudflared (ไม่ต้องมีบัญชี) หรือ ngrok (ต้องตั้งค่า authtoken ไว้แล้ว)
    แล้วเก็บ URL สาธารณะไว้ใน PUBLIC["url"] เมื่อพร้อม"""
    if shutil.which("cloudflared"):
        cmd = ["cloudflared", "tunnel", "--url", f"http://localhost:{PORT}", "--no-autoupdate"]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        atexit.register(proc.terminate)

        def read_url():
            for line in proc.stderr:
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if m and not PUBLIC["url"]:
                    PUBLIC["url"] = m.group(0)
                    print(f"🌍 ลิงก์สาธารณะ: {PUBLIC['url']}")
        threading.Thread(target=read_url, daemon=True).start()
        return "cloudflared"

    if shutil.which("ngrok"):
        proc = subprocess.Popen(["ngrok", "http", str(PORT), "--log=stdout"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        atexit.register(proc.terminate)

        def ask_ngrok():
            for _ in range(30):
                time.sleep(1)
                if proc.poll() is not None:
                    print("⚠️  ngrok ปิดตัวไป — ต้องตั้งค่า authtoken ก่อน: ngrok config add-authtoken <TOKEN>")
                    return
                try:
                    with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=2) as r:
                        tunnels = json.load(r).get("tunnels", [])
                    url = next((t["public_url"] for t in tunnels if t["public_url"].startswith("https")), None)
                    if url:
                        PUBLIC["url"] = url
                        print(f"🌍 ลิงก์สาธารณะ: {url}")
                        return
                except OSError:
                    pass
        threading.Thread(target=ask_ngrok, daemon=True).start()
        return "ngrok"
    return None


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="เซิร์ฟเวอร์คลังบอร์ดเกม")
    ap.add_argument("--public", action="store_true", help="เปิดลิงก์สาธารณะให้มือถือเข้าได้จากทุกเครือข่าย")
    args = ap.parse_args()

    print(f"เปิดเกมได้ที่ http://localhost:{PORT}")
    print(f"มือถือในวง Wi-Fi เดียวกันเข้าได้ที่ http://{lan_ip()}:{PORT}")
    if args.public:
        PUBLIC["enabled"] = True
        ROOM.reset()
        tool = start_tunnel()
        if tool:
            print(f"กำลังเปิดลิงก์สาธารณะด้วย {tool}…")
        else:
            print("⚠️  ไม่พบ cloudflared หรือ ngrok — ติดตั้งด้วย: brew install cloudflared")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
