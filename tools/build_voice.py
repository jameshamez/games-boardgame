#!/usr/bin/env python3
"""อัดเสียงพากย์ของเกมมนุษย์หมาป่าล่วงหน้า: ภาษาไทยด้วยเสียง Kanya และภาษาอังกฤษด้วยเสียง Samantha ของ macOS

ใช้:  python3 tools/build_voice.py
ผลลัพธ์: games/werewolf/voice/*.m4a และ games/werewolf/voice/manifest.js
ต้องรันใหม่ทุกครั้งที่แก้บทพากย์ใน games/werewolf/lines.js
"""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "werewolf"
VOICE_DIR = GAME / "voice"
VOICE = "Kanya"
VOICE_EN = "Samantha"


def voice_file(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12] + ".m4a"


def synth(text: str, out: Path, voice: str = VOICE) -> None:
    """สร้างไฟล์เสียง .m4a จากข้อความ ด้วยคำสั่ง say + afconvert ของ macOS"""
    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "v.aiff"
        subprocess.run(["say", "-v", voice, "-o", str(aiff), "--", text], check=True)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(aiff), str(out)], check=True)


def run_js(expr: str):
    """โหลด roles.js + lines.js ด้วย node แล้วคืนค่าของนิพจน์ expr"""
    src = "\n".join((GAME / f).read_text(encoding="utf-8") for f in ("roles.js", "lines.js"))
    src += f"\nconsole.log(JSON.stringify({expr}));\n"
    res = subprocess.run(["node", "-"], input=src, check=True, capture_output=True, text=True)
    return json.loads(res.stdout)


def fixed_phrases() -> list:
    """บทพากย์ภาษาไทยคงที่ทั้งหมด"""
    return run_js("allFixedPhrases()")


def english_phrases() -> list:
    """คำแปลภาษาอังกฤษของบทพากย์ทั้งหมด — หยุดทันทีถ้ามีประโยคไหนยังไม่มีคำแปล"""
    res = run_js("allEnglishPhrases()")
    if res["missing"]:
        raise SystemExit("ยังไม่มีคำแปลภาษาอังกฤษใน lines.js (EN_FIXED):\n  " + "\n  ".join(res["missing"]))
    return res["phrases"]


def main() -> None:
    VOICE_DIR.mkdir(exist_ok=True)
    jobs = [(t, VOICE) for t in fixed_phrases()] + [(t, VOICE_EN) for t in english_phrases()]
    manifest = {}
    made = 0
    for text, voice in jobs:
        name = voice_file(text)
        out = VOICE_DIR / name
        if not out.exists():
            synth(text, out, voice)
            made += 1
            print("🎙 ", text)
        manifest[text] = name
    # ลบไฟล์ที่ไม่ได้ใช้แล้ว
    keep = set(manifest.values())
    for f in VOICE_DIR.glob("*.m4a"):
        if f.name not in keep:
            f.unlink()
    (VOICE_DIR / "manifest.js").write_text(
        "// สร้างโดย tools/build_voice.py — อย่าแก้ด้วยมือ\n"
        "const VOICE_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8")
    print(f"เสร็จแล้ว: ทั้งหมด {len(manifest)} ประโยค (อัดใหม่ {made})")


if __name__ == "__main__":
    main()
