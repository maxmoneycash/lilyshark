# PommeCore — Localization Guide

German (`de`) is the first supported language beyond English. This document covers the infrastructure, code patterns, and workflow for adding and maintaining translations.

---

## Infrastructure Overview

### Catalog Files

| File | Location | Purpose |
|------|----------|---------|
| `Localizable.xcstrings` | `Shared/` | All in-app UI strings (~800 keys, 738 with `de`) |
| `InfoPlist.xcstrings` | `Shared/` | NSUsageDescription strings for App Review |

Both use Xcode 15+ String Catalog format (JSON). Both are compiled into all three targets (iOS, macOS, watchOS) — wired via the Resources build phase in `project.pbxproj`.

**knownRegions** in `project.pbxproj` already includes `"de"`. Adding a new language requires adding it there as well.

### Untranslated Entries (intentional)

62 keys in `Localizable.xcstrings` have no `de` entry. All are intentionally untranslated:
- Pure format tokens: `%@`, `%@/%@`, `%@:%@`, `%@%%`, etc.
- Numeric constants displayed verbatim: `100`, `200`, `500`, `1,000`
- Technical identifiers that don't translate: `GPS`, `PIN`, `SF`, `dBm`, `Li-Ion (3.7V)`, `LiFePO4 (3.2V)`, coding rates (`4/5`, `4/6`, `4/7`, `4/8`), range indicators (`-100–-120`, `< -120`, `> -100`)
- Empty/whitespace markers: `''`, `' '`, `':'`, `'—'`, `'•'`

---

## Code Patterns

### The Core Rule

`Text("literal string")` auto-localizes because `Text` infers `LocalizedStringKey`.  
`Text(stringVariable)` does **not** auto-localize when the variable is typed as `String`.

| Context | Use |
|---------|-----|
| `Text(...)` with a string literal | `LocalizedStringKey` — auto-extracted, auto-localized |
| Helper function parameters that feed `Text(...)` | `LocalizedStringKey` — must be declared as such |
| Computed property returning a `String` | `String(localized: "key")` — bypasses catalog without this |
| Package code (MeshCoreKit) | `String(localized: "key", bundle: .module)` |
| `@Observable` / non-SwiftUI contexts | `String(localized: "key")` |

### When to Use `String(localized:)`

Computed properties and functions that return `String` must use `String(localized:)` — the compiler cannot infer `LocalizedStringKey` in those contexts:

```swift
// Wrong — bypasses catalog entirely
var displayName: String { "System" }

// Correct
var displayName: String { String(localized: "System") }
```

### Helper Function Parameters

Any helper that passes a parameter into a `Text(...)` must declare it as `LocalizedStringKey`, not `String`. A `String` variable (even one holding a plain literal) will bypass the catalog:

```swift
// Wrong — Text(text) bypasses catalog when text: String
func stepRow(number: String, text: String) -> some View {
    Text(text)
}

// Correct — Text(text) localizes when text: LocalizedStringKey
func stepRow(number: String, text: LocalizedStringKey) -> some View {
    Text(text)
}
```

Call sites with string literals need no changes — literals auto-coerce to `LocalizedStringKey`.

### Optional `LocalizedStringKey` in Structs

`LocalizedStringKey` has no `isEmpty` property. When a struct field is optional (e.g., `SectionInfoHeader.title`), use `LocalizedStringKey?` with nil as the absent sentinel, not `""`:

```swift
struct SectionInfoHeader: View {
    let title: LocalizedStringKey?   // nil = no title, "" is not a valid absent marker
    let info: LocalizedStringKey

    init(title: LocalizedStringKey? = nil, info: LocalizedStringKey, ...) { ... }

    var body: some View {
        if let title { Text(title) }  // not: if !title.isEmpty
        Text(info)
    }
}
```

Provide an explicit `init` — Swift's synthesized memberwise init does not add default values to `LocalizedStringKey?` parameters reliably.

---

## String State in .xcstrings

Each localization entry has a `state` field:

| State | Meaning |
|-------|---------|
| `"translated"` | Complete — no warnings in Xcode editor |
| `"new"` | Yellow warning in Xcode editor — Xcode sets this on auto-extracted format strings |
| `"needs_review"` | Yellow warning — Xcode sets this when it auto-populates English source values for new entries |

All entries in both catalogs should have `"translated"` state. After any build that causes Xcode to auto-extract or auto-populate, run the cleanup script to reset states.

---

## Scripts

All scripts are in `scripts/`. Run from the repo root.

### `scripts/apply_german_translations.py`
The initial bulk translation script. Applied the first ~650 German translations from a structured dictionary. Run once; do not re-run (it would duplicate work).

### `scripts/add_missing_german.py`
Adds targeted German translations for strings identified as missing after the initial pass. Idempotent — skips keys that already have `de`.

### `scripts/add_remaining_german.py`
Added the final batch of translations: section titles, InfoButton text, SectionInfoHeader info strings, theme display names, and miscellaneous UI strings. Idempotent.

### Adding New Translations

To add German (or any language) translations for new strings:

1. Write a Python script following this pattern:

```python
import json

CATALOG = "Shared/Localizable.xcstrings"
TRANSLATIONS = {
    "New English String": "Neue deutsche Zeichenkette",
    "Another String": "Andere Zeichenkette",
}
LANG = "de"

with open(CATALOG) as f:
    data = json.load(f)

added = 0
for key, value in TRANSLATIONS.items():
    if key not in data["strings"]:
        print(f"MISSING KEY: {key}")
        continue
    locs = data["strings"][key].setdefault("localizations", {})
    if LANG not in locs:
        locs[LANG] = {"stringUnit": {"state": "translated", "value": value}}
        added += 1
    else:
        print(f"Already has {LANG}: {key}")

with open(CATALOG, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Added {added} translations")
```

2. **Important:** Write scripts as files using the Write tool, then run with `python3 scripts/filename.py`. Do not use bash heredocs for Python scripts containing German characters (`„`, `"`, `'`) — they cause `SyntaxError` due to shell quoting conflicts.

3. After adding translations, verify the build is clean:

```bash
./scripts/test_build.sh
```

### Fixing xcstrings Warnings After a Build

When Xcode auto-extracts format strings or auto-populates English source values, it sets states to `"new"` or `"needs_review"`. Fix with:

```python
import json

for catalog in ["Shared/Localizable.xcstrings", "Shared/InfoPlist.xcstrings"]:
    with open(catalog) as f:
        data = json.load(f)
    for key, entry in data["strings"].items():
        for lang, loc in entry.get("localizations", {}).items():
            if "stringUnit" in loc and loc["stringUnit"]["state"] in ("new", "needs_review"):
                loc["stringUnit"]["state"] = "translated"
    with open(catalog, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Fixed: {catalog}")
```

---

## InfoPlist.xcstrings

This catalog localizes the NSUsageDescription strings shown in system permission dialogs and checked by App Store Review. Keys are the Info.plist key names:

| Key | Description |
|-----|-------------|
| `NSBluetoothAlwaysUsageDescription` | Bluetooth permission dialog |
| `NSBluetoothPeripheralUsageDescription` | Bluetooth peripheral (legacy key, still required) |
| `NSCameraUsageDescription` | Camera permission for QR scanning |
| `NSFaceIDUsageDescription` | Face ID / biometric lock |
| `NSLocationWhenInUseUsageDescription` | Location for mesh map |
| `CFBundleDisplayName` | App name shown under icon |
| `CFBundleName` | Internal bundle name |
| `NSHumanReadableCopyright` | macOS copyright string |

**Xcode auto-populates** `CFBundleDisplayName`, `CFBundleName`, and `NSHumanReadableCopyright` in `en` when it first processes the file during a build — their German translations must already exist or Xcode will set them to `"needs_review"`.

---

## Adding a New Language

1. **Add the language code to `knownRegions`** in `project.pbxproj`:
   ```
   knownRegions = (
       en,
       de,
       fr,   ← add here
   );
   ```

2. **Write a translation script** following the pattern above for both `Localizable.xcstrings` and `InfoPlist.xcstrings`.

3. **Note for languages with plural forms** (e.g., Polish: one/few/many/other; Russian): xcstrings supports `pluralSubstitution` entries. Each plural form needs its own `"stringUnit"` keyed by CLDR plural category. Check the Apple String Catalog documentation for the exact JSON structure.

4. **Build and fix states:**
   ```bash
   ./scripts/test_build.sh
   ```
   Run the state-cleanup script if Xcode introduces `"new"` or `"needs_review"` warnings.

5. **Verify InfoPlist strings are wired correctly** — App Store Review checks that permission strings appear in the system dialog in the reviewer's language. Build on a device set to the new language and trigger each permission prompt.

---

## Current Status (v26.04.24)

| Language | Localizable.xcstrings | InfoPlist.xcstrings |
|----------|-----------------------|---------------------|
| English (`en`) | 800 keys (source) | 8 keys (source) |
| German (`de`) | 738 keys translated, 62 intentionally untranslated | 8 keys translated |
| French (`fr`) | — | — |
| Spanish (`es`) | — | — |
| Japanese (`ja`) | — | — |

French, Spanish, and Japanese are planned. Adding them is blocked on scope and translation tooling decisions (DeepL API vs. manual).
