#!/usr/bin/env python3
"""Add remaining German translations: themes, section titles, info strings, InfoButton text."""

import json

XCSTRINGS_PATH = "Shared/Localizable.xcstrings"

TRANSLATIONS: dict[str, str] = {
    # ── AppTheme display names ────────────────────────────────────────────────
    "Light": "Hell",
    "Dark": "Dunkel",
    "System": "System",

    # ── Section / navigation titles ───────────────────────────────────────────
    "Appearance": "Erscheinungsbild",
    "About": "Über",
    "Advanced": "Erweitert",
    "Troubleshooting": "Fehlerbehebung",
    "iCloud": "iCloud",
    "Storage": "Speicher",
    "App Version": "App-Version",
    "Support the App": "App unterstützen",
    "MeshCore Project": "MeshCore-Projekt",
    "Privacy Policy": "Datenschutzrichtlinie",
    "Original Name": "Ursprünglicher Name",
    "Channel name": "Kanalname",
    "Active Channels": "Aktive Kanäle",
    "Active Channel": "Aktiver Kanal",
    "Join Hashtag Channel": "Hashtag-Kanal beitreten",
    "Create Private Channel": "Privaten Kanal erstellen",
    "Join Private Channel": "Privatem Kanal beitreten",
    "Bluetooth Security": "Bluetooth-Sicherheit",
    "Device": "Gerät",
    "Time": "Zeit",
    "Radio Settings": "Radioeinstellungen",

    # ── SectionInfoHeader info strings ─────────────────────────────────────────
    "Choose which events trigger notifications. In-App Banners shows alerts even when the app is open.":
        "Legen Sie fest, welche Ereignisse Benachrichtigungen auslösen. In-App-Banner zeigt Hinweise auch an, wenn die App geöffnet ist.",

    "Auto Retry resends failed direct messages up to 3 times. Auto Reset Path clears the cached route and resends as flood. Multi-ACK sends delivery confirmations to all hops in the route.":
        "Automatisch wiederholen sendet fehlgeschlagene Direktnachrichten bis zu 3 Mal erneut. Pfad automatisch zurücksetzen löscht die gecachte Route und sendet als Übertragung. Multi-ACK sendet Zustellungsbestätigungen an alle Hops in der Route.",

    "Tap any row to view or change that setting on your connected radio.":
        "Tippen Sie auf eine Zeile, um die Einstellung Ihres verbundenen Radios anzuzeigen oder zu ändern.",

    "Each radio stores messages separately. If you replace a radio, use ‘Migrate’ to move history to your new device.":
        "Jedes Radio speichert Nachrichten separat. Wenn Sie ein Radio ersetzen, verwenden Sie „Migrieren“, um den Verlauf auf Ihr neues Gerät zu übertragen.",

    "Requires Apple Watch paired with this iPhone. Messages sync via WatchConnectivity when your iPhone is nearby or reachable.":
        "Erfordert eine Apple Watch, die mit diesem iPhone gekoppelt ist. Nachrichten werden über WatchConnectivity synchronisiert, wenn Ihr iPhone in der Nähe ist.",

    "Allow Read-Only lets guests read messages without a password. Disable to require authentication for all access.":
        "Nur lesen erlaubt ermöglicht Gästen das Lesen von Nachrichten ohne Passwort. Deaktivieren, um für alle Zugriffe eine Authentifizierung zu erfordern.",

    "Set access level for a client by their public key prefix. Guest = read-only, Read-Write = can post, Admin = full control.":
        "Legen Sie die Zugriffsebene eines Clients anhand seines öffentlichen Schlüsselpräfixes fest. Gast = nur lesen, Lesen-Schreiben = kann posten, Admin = volle Kontrolle.",

    "Direct GPIO pin control. Use with caution — incorrect operations may affect sensor readings.":
        "Direkte GPIO-Pin-Steuerung. Mit Vorsicht verwenden — falsche Operationen können die Sensorwerte beeinflussen.",

    "These commands are only available via direct USB connection for security. Factory Reset cannot be undone.":
        "Diese Befehle sind aus Sicherheitsgründen nur über eine direkte USB-Verbindung verfügbar. Werkseinstellung kann nicht rückgängig gemacht werden.",

    "Send raw CLI commands to the device. Type 'help' for available commands.":
        "Senden Sie rohe CLI-Befehle an das Gerät. Geben Sie 'help' für verfügbare Befehle ein.",

    "Factory reset erases all contacts, channels, settings, and encryption keys from the device. This cannot be undone.":
        "Werkseinstellung löscht alle Kontakte, Kanäle, Einstellungen und Verschlüsselungsschlüssel vom Gerät. Dies kann nicht rückgängig gemacht werden.",

    "Developer and diagnostic tools. Most users won’t need these.":
        "Entwickler- und Diagnosewerkzeuge. Die meisten Benutzer benötigen diese nicht.",

    "Syncs nicknames, notes, channel secrets, login credentials, recent messages, app settings, and telemetry history between your Apple devices via iCloud. Data is encrypted by Apple in transit and at rest. Messages and telemetry are stored per radio — switching radios keeps data separate.":
        "Synchronisiert Spitznamen, Notizen, Kanalgeheimnisse, Anmeldedaten, aktuelle Nachrichten, App-Einstellungen und Telemetrieverlauf zwischen Ihren Apple-Geräten via iCloud. Daten werden von Apple während der Übertragung und im Ruhezustand verschlüsselt. Nachrichten und Telemetrie werden pro Radio gespeichert — ein Radiowechsel hält die Daten getrennt.",

    "Choose how PommeCore looks. System follows your device’s Dark Mode setting.":
        "Legen Sie fest, wie PommeCore aussieht. System folgt der Dunkel-Modus-Einstellung Ihres Geräts.",

    "All radios on your mesh must use the same settings. SF (Spreading Factor): higher = longer range, slower. CR (Coding Rate): higher = more error correction. BW (Bandwidth): lower = longer range. Changes require reboot.":
        "Alle Radios in Ihrem Mesh müssen dieselben Einstellungen verwenden. SF (Spreizfaktor): höher = größere Reichweite, langsamer. CR (Codierungsrate): höher = mehr Fehlerkorrektur. BW (Bandbreite): niedriger = größere Reichweite. Änderungen erfordern einen Neustart.",

    "Controls what telemetry data is shared when requested. Per-Contact mode only shares with contacts that have telemetry permission set. App Lock requires Face ID, Touch ID, or your device passcode to open MeshCore.":
        "Steuert, welche Telemetriedaten auf Anfrage geteilt werden. Pro-Kontakt-Modus teilt nur mit Kontakten, die eine Telemetrieberechtigung gesetzt haben. App-Sperre erfordert Face ID, Touch ID oder Ihren Gerätecode zum Öffnen von MeshCore.",

    "Contacts listed here can request battery, temperature, and sensor data from your device. Toggle off to stop sharing telemetry with a specific contact.":
        "Kontakte, die hier aufgelistet sind, können Akku-, Temperatur- und Sensordaten von Ihrem Gerät anfordern. Deaktivieren Sie den Schalter, um die Telemetrie mit einem bestimmten Kontakt zu stoppen.",

    "Contacts listed here will receive your GPS coordinates when they request telemetry. Toggle off to stop sharing your location with a specific contact.":
        "Kontakte, die hier aufgelistet sind, erhalten Ihre GPS-Koordinaten, wenn sie Telemetrie anfordern. Deaktivieren Sie den Schalter, um Ihren Standort nicht mehr mit einem bestimmten Kontakt zu teilen.",

    "Key-value pairs stored on the radio. Used for advanced configuration and firmware development.":
        "Schlüssel-Wert-Paare, die auf dem Radio gespeichert sind. Wird für erweiterte Konfiguration und Firmware-Entwicklung verwendet.",

    "Live radio diagnostics. Noise Floor is background signal level (lower is better). RSSI is received signal strength. SNR is signal-to-noise ratio (higher is better).":
        "Live-Radiodiagnose. Rauschpegel ist der Hintergrundsignalpegel (niedriger ist besser). RSSI ist die Empfangssignalstärke. SNR ist das Signal-Rausch-Verhältnis (höher ist besser).",

    "Hardware and firmware details from your radio.":
        "Hardware- und Firmware-Details von Ihrem Radio.",

    "Long-press to copy. Share this with others to let them add you as a contact.":
        "Lang drücken zum Kopieren. Teilen Sie dies mit anderen, damit sie Sie als Kontakt hinzufügen können.",

    "Device clock is automatically synced from your phone on every connection.":
        "Die Geräteuhr wird bei jeder Verbindung automatisch von Ihrem Telefon synchronisiert.",

    "Your radio’s stored coordinates. These are shared with other radios when advertising.":
        "Die gespeicherten Koordinaten Ihres Radios. Diese werden beim Ankündigen mit anderen Radios geteilt.",

    "Set from Phone GPS copies your phone’s coordinates to the radio. Auto-Update periodically refreshes while the app is open.":
        "Von Telefon-GPS setzen kopiert die Koordinaten Ihres Telefons zum Radio. Automatische Aktualisierung aktualisiert regelmäßig, während die App geöffnet ist.",

    "Adds a random offset to your location before sharing. Only affects your personal device — repeater and room server locations are always exact.":
        "Fügt Ihrem Standort vor dem Teilen einen zufälligen Versatz hinzu. Betrifft nur Ihr persönliches Gerät — Repeater- und Raumserver-Standorte sind immer genau.",

    "Live reading from the radio’s battery sensor. Accuracy depends on correct chemistry selection below.":
        "Live-Ablesung vom Akkusensor des Radios. Genauigkeit hängt von der richtigen Chemie-Auswahl unten ab.",

    "Select battery chemistry for accurate percentage calculation.":
        "Wählen Sie die Akkuchemie für eine genaue Prozentberechnung.",

    "Tools to help diagnose connection problems between your phone and radio.":
        "Werkzeuge zur Diagnose von Verbindungsproblemen zwischen Ihrem Telefon und Radio.",

    "Debug Log records connection and protocol events for troubleshooting.":
        "Debug-Protokoll zeichnet Verbindungs- und Protokollereignisse zur Fehlerbehebung auf.",

    "Basic device information. Tap ↺ to re-read version, battery, and clock from the device.":
        "Grundlegende Geräteinformationen. Tippen Sie auf ↺, um Version, Akku und Uhr vom Gerät erneut zu lesen.",

    "This device generates a random PIN each time it starts. Check the device screen for the current PIN when pairing.":
        "Dieses Gerät generiert bei jedem Start eine zufällige PIN. Prüfen Sie den Gerätebildschirm für die aktuelle PIN beim Koppeln.",

    "Change the BLE PIN from the default (123456) for security. After changing, forget this device in Bluetooth settings and re-pair with the new PIN.":
        "Ändern Sie die BLE-PIN vom Standard (123456) für mehr Sicherheit. Nach der Änderung Gerät in den Bluetooth-Einstellungen vergessen und mit der neuen PIN erneut koppeln.",

    # ── InfoButton text strings ───────────────────────────────────────────────
    "Chat = people, Repeaters extend range, Room Servers host group chats, Sensors report data.":
        "Chat = Personen, Repeater erweitern die Reichweite, Raumserver hosten Gruppenchats, Sensoren berichten Daten.",

    "Uploads your node’s signed advert packet to map.meshcore.dev so others can see your node on the internet map. Only uploads when you have a location set. Your Position Accuracy setting (in GPS & Location) is applied before uploading — the map receives the fuzzed position, not your exact location.":
        "Lädt das signierte Ankündigungspaket Ihres Knotens auf map.meshcore.dev hoch, damit andere Ihren Knoten auf der Internet-Karte sehen können. Wird nur hochgeladen, wenn ein Standort festgelegt ist. Ihre Positionsgenauigkeitseinstellung (in GPS & Standort) wird vor dem Hochladen angewendet — die Karte erhält den ungenauen Standort.",

    "TIP: Use your initials + first 4 of your public key (e.g., NMA-5abd). Max 31 characters.":
        "TIPP: Verwenden Sie Ihre Initialen + erste 4 Ihres öffentlichen Schlüssels (z. B. NMA-5abd). Max. 31 Zeichen.",

    "Base delay for SNR-based packet prioritization. Higher values give better-signal packets more priority. 0 = disabled.":
        "Basisverzögerung für SNR-basierte Paketpriorisierung. Höhere Werte geben Paketen mit besserem Signal mehr Priorität. 0 = deaktiviert.",

    "Multiplier for airtime budget. Higher values allow more frequent transmissions. 0 = no limit.":
        "Multiplikator für Sendezeitbudget. Höhere Werte ermöglichen häufigere Übertragungen. 0 = kein Limit.",

    "Passwords are case-sensitive, max 15 characters.":
        "Passwörter sind groß-/kleinschreibungsabhängig, max. 15 Zeichen.",

    # ── RadioPreset and RemoteManagement ─────────────────────────────────────
    "Select a preset for your region. All nodes on your mesh must use the same settings.":
        "Wählen Sie eine Voreinstellung für Ihre Region. Alle Knoten in Ihrem Mesh müssen dieselben Einstellungen verwenden.",

    "Radio format: freq_MHz,bw_kHz,sf,cr (e.g. 910.525,62.5,7,5)":
        "Radioformat: freq_MHz,bw_kHz,sf,cr (z. B. 910.525,62.5,7,5)",

    "Standard adverts are local (0-hop, 60-240 min). Flood adverts are relayed by all repeaters (min 3 hours). Minimum intervals enforced by firmware.":
        "Standard-Ankündigungen sind lokal (0-Hop, 60–240 Min.). Übertragungsankündigungen werden von allen Repeatern weitergeleitet (min. 3 Stunden). Mindestintervalle werden von der Firmware erzwungen.",

    "Standard adverts are local (0-hop, 60–240 min). Flood adverts are relayed by all repeaters (min 3 hours). Minimum intervals enforced by firmware.":
        "Standard-Ankündigungen sind lokal (0-Hop, 60–240 Min.). Übertragungsankündigungen werden von allen Repeatern weitergeleitet (min. 3 Stunden). Mindestintervalle werden von der Firmware erzwungen.",

    # ── Misc UI strings ───────────────────────────────────────────────────────
    "Done": "Fertig",
    "Join": "Beitreten",
    "Join %@": "Beitreten %@",
    "Create Channel": "Kanal erstellen",
    "Join Channel": "Kanal beitreten",
    "Rename": "Umbenennen",
    "Channel name": "Kanalname",
    "Enter a new name for this channel.": "Geben Sie einen neuen Namen für diesen Kanal ein.",
    "Hashtag channels derive their encryption key from the channel name. Anyone who knows the name can join.":
        "Hashtag-Kanäle leiten ihren Verschlüsselungsschlüssel vom Kanalnamen ab. Jeder, der den Namen kennt, kann beitreten.",
    "Creates a channel with a random 128-bit encryption key. Share the key with others to let them join.":
        "Erstellt einen Kanal mit einem zufälligen 128-Bit-Verschlüsselungsschlüssel. Teilen Sie den Schlüssel mit anderen, damit sie beitreten können.",
    "Enter the channel name and the shared hex secret to join an existing private channel.":
        "Geben Sie den Kanalnamen und das gemeinsame Hex-Geheimnis ein, um einem bestehenden privaten Kanal beizutreten.",

    # ── Connection status strings ─────────────────────────────────────────────
    "Status": "Status",
    "Connected": "Verbunden",
    "Disconnected": "Getrennt",
    "Connecting": "Verbinden",
    "Connecting...": "Verbinden…",
    "Discovering services...": "Dienste werden gefunden…",
    "Scanning...": "Scannen…",
    "Scanning": "Scannen",
    "Ready": "Bereit",

    # ── Send Advertisement ────────────────────────────────────────────────────
    "Send Advertisement": "Ankündigung senden",
    "Send Advert": "Ankündigung senden",
    "Send Standard Advert": "Standard-Ankündigung senden",
}


def apply(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    strings = data.setdefault("strings", {})
    added = 0

    for en_key, de_value in TRANSLATIONS.items():
        entry = strings.setdefault(en_key, {})
        if not entry.get("shouldTranslate", True):
            continue
        locs = entry.setdefault("localizations", {})
        if "de" not in locs:
            locs["de"] = {"stringUnit": {"state": "translated", "value": de_value}}
            added += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Added {added} DE translations.")
    print(f"Total strings: {len(strings)}")


if __name__ == "__main__":
    apply(XCSTRINGS_PATH)
