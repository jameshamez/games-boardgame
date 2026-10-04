#!/usr/bin/env python3
"""อัดเสียงพากย์ของเกมล่วงหน้า: ภาษาไทยด้วยเสียง Kanya และภาษาอังกฤษด้วยเสียง Samantha ของ macOS

ใช้:  python3 tools/build_voice.py            อัดทุกเกม
      python3 tools/build_voice.py cheese     อัดเฉพาะเกมเดียว
ผลลัพธ์: games/<เกม>/voice/*.m4a และ games/<เกม>/voice/manifest.js
ต้องรันใหม่ทุกครั้งที่แก้บทพากย์ (ไฟล์ lines.js ของแต่ละเกม)
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE = "Kanya"
VOICE_EN = "Samantha"

# เกมที่มีเสียงพากย์ และไฟล์ที่ต้องโหลดเพื่อดึงบทพากย์ (ไฟล์สุดท้ายต้องมี allFixedPhrases และ allEnglishPhrases)
GAMES = {
    "werewolf": ["roles.js", "lines.js"],
    "cheese": ["lines.js"],
}


def voice_file(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12] + ".m4a"


def synth(text: str, out: Path, voice: str = VOICE) -> None:
    """สร้างไฟล์เสียง .m4a จากข้อความ ด้วยคำสั่ง say + afconvert ของ macOS"""
    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "v.aiff"
        subprocess.run(["say", "-v", voice, "-o", str(aiff), "--", text], check=True)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(aiff), str(out)], check=True)


def run_js(game: str, expr: str):
    """โหลดไฟล์บทพากย์ของเกมด้วย node แล้วคืนค่าของนิพจน์ expr"""
    folder = ROOT / "games" / game
    src = "\n".join((folder / f).read_text(encoding="utf-8") for f in GAMES[game])
    src += f"\nconsole.log(JSON.stringify({expr}));\n"
    res = subprocess.run(["node", "-"], input=src, check=True, capture_output=True, text=True)
    return json.loads(res.stdout)


def fixed_phrases(game: str) -> list:
    """บทพากย์ภาษาไทยคงที่ทั้งหมด"""
    return run_js(game, "allFixedPhrases()")


def english_phrases(game: str) -> list:
    """คำแปลภาษาอังกฤษของบทพากย์ทั้งหมด — หยุดทันทีถ้ามีประโยคไหนยังไม่มีคำแปล"""
    res = run_js(game, "allEnglishPhrases()")
    if res["missing"]:
        raise SystemExit(f"[{game}] ยังไม่มีคำแปลภาษาอังกฤษใน lines.js:\n  " + "\n  ".join(res["missing"]))
    return res["phrases"]


def build(game: str) -> None:
    voice_dir = ROOT / "games" / game / "voice"
    voice_dir.mkdir(exist_ok=True)
    jobs = [(t, VOICE) for t in fixed_phrases(game)] + [(t, VOICE_EN) for t in english_phrases(game)]
    manifest = {}
    made = 0
    for text, voice in jobs:
        name = voice_file(text)
        out = voice_dir / name
        if not out.exists():
            synth(text, out, voice)
            made += 1
            print(f"🎙  [{game}] {text}")
        manifest[text] = name
    # ลบไฟล์ที่ไม่ได้ใช้แล้ว
    keep = set(manifest.values())
    for f in voice_dir.glob("*.m4a"):
        if f.name not in keep:
            f.unlink()
    (voice_dir / "manifest.js").write_text(
        "// สร้างโดย tools/build_voice.py — อย่าแก้ด้วยมือ\n"
        "const VOICE_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8")
    print(f"[{game}] เสร็จแล้ว: ทั้งหมด {len(manifest)} ประโยค (อัดใหม่ {made})")


def main() -> None:
    games = sys.argv[1:] or list(GAMES)
    for game in games:
        if game not in GAMES:
            raise SystemExit(f"ไม่รู้จักเกม {game} — มี: {', '.join(GAMES)}")
        build(game)


if __name__ == "__main__":
    main()
