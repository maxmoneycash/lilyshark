#!/usr/bin/env python3
"""
translate_strings.py — translate Localizable.xcstrings via local inference

Usage:
    python3 scripts/translate_strings.py [--lang fr,es,it,...] [--batch 10] [--dry-run]

Defaults to all 10 target languages if --lang is omitted.
Progress is saved after each batch so it's safe to interrupt and resume.
"""

import json
import re
import sys
import time
import argparse
import urllib.request
import urllib.error
from copy import deepcopy

XCSTRINGS_PATH = "Shared/Localizable.xcstrings"
INFERENCE_URL = "http://localhost:11434/api/generate"
MODEL = "aya-expanse:8b"

TARGET_LANGUAGES = {
    "de":      "German",
    "fr":      "French",
    "es":      "Spanish",
    "it":      "Italian",
    "nl":      "Dutch",
    "pt":      "Portuguese",
    "cs":      "Czech",
    "pl":      "Polish",
    "uk":      "Ukrainian",
    "ja":      "Japanese",
    "zh-Hans": "Simplified Chinese",
}

# Terms that must never be translated
PRESERVE_TERMS = [
    "PommeCore", "MeshCore", "MeshCoreKit", "LoRa", "BLE", "RSSI", "SNR",
    "dBm", "MHz", "kHz", "SF", "BW", "CR", "WiFi", "USB", "GPS", "LPP",
    "iCloud", "Siri", "Shortcuts", "TestFlight", "App Store", "iOS", "macOS",
    "watchOS", "SwiftUI", "Meshtastic", "Bluetooth", "JSON", "API", "URL",
    "SHA256", "PSK", "DFU", "OTA", "LPP", "Fresnel", "Cayenne", "ESP32",
    "nRF52", "GitHub", "CloudKit", "KeyValueStore", "Spotlight",
]

SYSTEM_PROMPT = """You are a professional app translator. Translate app UI strings from English to {lang_name}.

Rules (strictly follow all):
1. Output ONLY a numbered list matching the input numbers. No extra text, no explanations.
2. Preserve ALL format specifiers exactly as-is: %@, %d, %lld, %1$@, %2$@, etc.
3. Never translate these technical terms: {preserve}.
4. Keep UI tone natural and concise — this is a mobile/desktop mesh radio app.
5. If a string is a single symbol, number, or untranslatable term, output it unchanged.
6. Maintain the same capitalization style (title case → title case, sentence case → sentence case).

Output format — exactly like this (number, period, space, translation):
1. [translation]
2. [translation]
...
"""

def load_xcstrings(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_xcstrings(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

def get_source_text(key, value):
    """Return the English source string to translate (prefer the key, which is plain English)."""
    return key

def get_translatable_keys(data, lang):
    """Return list of (key, source_text) for keys that need translation in this lang."""
    result = []
    for key, val in data["strings"].items():
        if val.get("shouldTranslate") is False:
            continue
        locs = val.get("localizations", {})
        if lang in locs:
            continue
        src = get_source_text(key, val)
        # Skip keys that are purely symbols or numbers
        if not src.strip() or re.fullmatch(r'[\d\s\.\-–—:/]+', src):
            continue
        result.append((key, src))
    return result

def run_inference(texts, lang_name, dry_run=False):
    """Send a batch of texts to the local inference endpoint and return translated list."""
    if dry_run:
        return [f"[{lang_name}] {t}" for t in texts]

    preserve_list = ", ".join(PRESERVE_TERMS)
    system = SYSTEM_PROMPT.format(lang_name=lang_name, preserve=preserve_list)

    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = f"{system}\n\nTranslate these {len(texts)} English strings to {lang_name}:\n\n{numbered}"

    payload = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 2048,
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        INFERENCE_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            raw = result.get("response", "")
    except urllib.error.URLError as e:
        print(f"  ERROR calling inference endpoint: {e}")
        return None

    return parse_numbered_response(raw, len(texts), texts)

def parse_numbered_response(raw, expected, originals):
    """Parse '1. text\n2. text\n...' response into a list."""
    lines = raw.strip().splitlines()
    translations = {}
    for line in lines:
        m = re.match(r'^(\d+)\.\s*(.*)', line.strip())
        if m:
            idx = int(m.group(1)) - 1
            text = m.group(2).strip()
            # Strip surrounding brackets the model sometimes adds
            if text.startswith("[") and text.endswith("]"):
                text = text[1:-1].strip()
            if 0 <= idx < expected and text:
                translations[idx] = text

    result = []
    for i, orig in enumerate(originals):
        if i in translations:
            result.append(translations[i])
        else:
            # Fall back to original rather than leaving blank
            print(f"    WARNING: no translation for item {i+1}, using original")
            result.append(orig)
    return result

def write_translations(data, keys_texts, translations, lang):
    """Write translations back into data dict."""
    for (key, _src), translated in zip(keys_texts, translations):
        if key not in data["strings"]:
            continue
        val = data["strings"][key]
        if "localizations" not in val:
            val["localizations"] = {}
        val["localizations"][lang] = {
            "stringUnit": {
                "state": "translated",
                "value": translated,
            }
        }

def translate_language(data, lang, lang_name, batch_size, dry_run, path):
    keys = get_translatable_keys(data, lang)
    total = len(keys)
    if total == 0:
        print(f"  {lang}: nothing to translate, skipping.")
        return

    print(f"\n=== {lang_name} ({lang}) — {total} strings ===")
    done = 0
    errors = 0

    for batch_start in range(0, total, batch_size):
        batch = keys[batch_start:batch_start + batch_size]
        texts = [src for _, src in batch]
        batch_end = min(batch_start + batch_size, total)
        print(f"  [{batch_end}/{total}] translating batch...", end="", flush=True)

        translations = run_inference(texts, lang_name, dry_run)
        if translations is None:
            print(" FAILED, skipping batch")
            errors += 1
            time.sleep(2)
            continue

        write_translations(data, batch, translations, lang)
        done += len(batch)
        print(f" done")

        if not dry_run:
            save_xcstrings(path, data)

    print(f"  Completed {done} strings, {errors} batch errors")

def main():
    parser = argparse.ArgumentParser(description="Translate Localizable.xcstrings via local inference")
    parser.add_argument("--lang", default="", help="Comma-separated language codes (default: all)")
    parser.add_argument("--batch", type=int, default=10, help="Strings per inference request (default: 10)")
    parser.add_argument("--dry-run", action="store_true", help="Don't call inference endpoint, write dummy translations")
    args = parser.parse_args()

    langs = {}
    if args.lang:
        for code in args.lang.split(","):
            code = code.strip()
            if code in TARGET_LANGUAGES:
                langs[code] = TARGET_LANGUAGES[code]
            else:
                print(f"Unknown language code: {code}")
                sys.exit(1)
    else:
        langs = TARGET_LANGUAGES

    data = load_xcstrings(XCSTRINGS_PATH)

    for lang, lang_name in langs.items():
        translate_language(data, lang, lang_name, args.batch, args.dry_run, XCSTRINGS_PATH)

    print("\nAll done.")

if __name__ == "__main__":
    main()
