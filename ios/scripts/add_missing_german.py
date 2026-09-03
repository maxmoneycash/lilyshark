#!/usr/bin/env python3
"""Add all strings found by the comprehensive sweep but missing from the catalog."""

import json

XCSTRINGS_PATH = "Shared/Localizable.xcstrings"

# Strings that should be marked shouldTranslate: false (brand names, technical placeholders)
NO_TRANSLATE = {
    "PommeCore",
    "e.g. US-NC-RDU-CR-f9ac5",
    "Toggle",  # accessibility technical term, kept English
    "GPS",     # acronym
    "PIN",     # acronym
}

TRANSLATIONS: dict[str, str] = {
    # ── Common buttons / actions ──────────────────────────────────────────────
    "OK": "OK",
    "Cancel": "Abbrechen",
    "Retry": "Wiederholen",
    "Save": "Speichern",
    "Confirm": "Bestätigen",
    "Connect": "Verbinden",
    "Enable": "Aktivieren",
    "Delete": "Löschen",
    "Remove": "Entfernen",
    "Rename": "Umbenennen",
    "Reset": "Zurücksetzen",
    "Import": "Importieren",
    "Share": "Teilen",
    "Copy": "Kopieren",
    "Copy All": "Alle kopieren",
    "Copy Link": "Link kopieren",
    "Copy Text": "Text kopieren",
    "Copy File Path": "Dateipfad kopieren",
    "Copy Public Key": "Öffentlichen Schlüssel kopieren",
    "Forward": "Weiterleiten",
    "Migrate": "Migrieren",
    "Randomize": "Zufällig",
    "React": "Reagieren",
    "Quote": "Zitieren",
    "Refresh": "Aktualisieren",
    "Unblock": "Entsperren",
    "Unlock": "Entsperren",
    "Discover": "Suchen",
    "Pin": "Pin",
    "Favourite": "Favorit",
    "Emoji": "Emoji",
    "Sent": "Gesendet",
    "Sending": "Wird gesendet",
    "Delivered": "Zugestellt",
    "Reading": "Wird gelesen",
    "Add": "Hinzufügen",
    "Create": "Erstellen",
    "Replace": "Ersetzen",
    "Retry Send": "Erneut senden",
    "Unblock": "Entsperren",
    "Block Contact": "Kontakt sperren",

    # ── Alert / confirmation titles ───────────────────────────────────────────
    "Connection Failed": "Verbindung fehlgeschlagen",
    "Device Error": "Gerätefehler",
    "Advertisement Sent": "Ankündigung gesendet",
    "Name Updated": "Name aktualisiert",
    "Contact Shared": "Kontakt geteilt",
    "Link Copied": "Link kopiert",
    "Reboot Required": "Neustart erforderlich",
    "Factory Reset?": "Werkseinstellung?",
    "Reboot Device?": "Gerät neu starten?",
    "Reboot Remote Device?": "Entferntes Gerät neu starten?",
    "Delete Radio Data?": "Radiodaten löschen?",
    "Enable Repeat Mode?": "Wiederholungsmodus aktivieren?",
    "Start OTA Mode Only?": "Nur OTA-Modus starten?",
    "Apply Radio Preset?": "Radio-Voreinstellung anwenden?",
    "Leave Channel?": "Kanal verlassen?",
    "Remove Channel?": "Kanal entfernen?",
    "Remove Contact?": "Kontakt entfernen?",
    "Rename Channel": "Kanal umbenennen",
    "New Contacts Discovered": "Neue Kontakte entdeckt",
    "Join the Supporters Wall?": "Der Unterstützerwand beitreten?",
    "Path Reset": "Pfad zurückgesetzt",
    "Can't Connect to Radio?": "Verbindung zum Radio nicht möglich?",

    # ── Toolbar / menu / navigation labels ───────────────────────────────────
    "Discover Nodes": "Knoten suchen",
    "Mesh Map": "Mesh-Karte",
    "Tools": "Tools",
    "More": "Mehr",
    "Advertise": "Ankündigen",
    "Scan for Devices": "Nach Geräten suchen",
    "Scan for devices": "Nach Geräten suchen",
    "Scanner": "Scanner",
    "Network Tools": "Netzwerktools",
    "Settings": "Einstellungen",
    "Map": "Karte",

    # ── Navigation titles / section headers ───────────────────────────────────
    "Device Info": "Geräteinformationen",
    "Device Details": "Gerätedetails",
    "Contact Details": "Kontaktdetails",
    "Network Details": "Netzwerkdetails",
    "Node Info": "Knoteninformationen",
    "Channel Info": "Kanalinformationen",
    "Radio Settings": "Radioeinstellungen",
    "Radio Configuration": "Radiokonfiguration",
    "Radio Parameters": "Radioparameter",
    "Radio Presets": "Radio-Voreinstellungen",
    "Radio Preset": "Radio-Voreinstellung",
    "Radio Calculator": "Radio-Rechner",
    "Airtime Calculator": "Sendezeit-Rechner",
    "SF/BW Reference": "SF/BW-Referenz",
    "Line of Sight": "Sichtlinie",
    "Coverage Heat Map": "Abdeckungs-Heatmap",
    "Remote Management": "Remote-Verwaltung",
    "Danger Zone": "Gefahrenzone",
    "App Lock": "App-Sperre",
    "Privacy & Security": "Datenschutz & Sicherheit",
    "Notifications": "Benachrichtigungen",
    "Message Delivery": "Nachrichtenzustellung",
    "Known Radios": "Bekannte Radios",
    "Tip Jar": "Trinkgeldglas",
    "Supporters Wall": "Unterstützerwand",
    "Watch Companion": "Watch Companion",
    "Unlock Watch Companion": "Watch Companion freischalten",
    "My Contact Code": "Mein Kontaktcode",
    "Blocked Contacts": "Gesperrte Kontakte",
    "Direct Messages": "Direktnachrichten",
    "Channel Messages": "Kanalnachrichten",
    "Room Server Messages": "Raumserver-Nachrichten",
    "Repeaters": "Repeater",
    "Room Server": "Raumserver",
    "Room Servers": "Raumserver",
    "Chat Users": "Chat-Benutzer",
    "Statistics": "Statistiken",
    "Sensors": "Sensoren",
    "Sensor GPIO": "Sensor-GPIO",
    "Custom Variables": "Benutzerdefinierte Variablen",
    "Client Permissions": "Client-Berechtigungen",
    "USB Serial Commands": "USB-Seriell-Befehle",
    "Firmware": "Firmware",
    "Firmware Update": "Firmware-Update",
    "Trace Route": "Traceroute",
    "Connection Status": "Verbindungsstatus",
    "Connection Troubleshooting": "Verbindungsfehlerbehebung",
    "Login Status": "Anmeldestatus",

    # ── Fields / labels / pickers ─────────────────────────────────────────────
    "Device Name": "Gerätename",
    "Device name": "Gerätename",
    "Display name": "Anzeigename",
    "Nickname": "Spitzname",
    "Notes": "Notizen",
    "Password": "Passwort",
    "Password (leave blank if none)": "Passwort (leer lassen, falls keines)",
    "Guest Password": "Gastpasswort",
    "New Admin Password": "Neues Administratorpasswort",
    "Add Channel": "Kanal hinzufügen",
    "Add Relay": "Relais hinzufügen",
    "Add to Existing Channels": "Zu bestehenden Kanälen hinzufügen",
    "Add My Name": "Meinen Namen hinzufügen",
    "Add Contact": "Kontakt hinzufügen",
    "Add contact": "Kontakt hinzufügen",
    "Add channel": "Kanal hinzufügen",
    "New Group…": "Neue Gruppe…",
    "Group name": "Gruppenname",
    "Bandwidth": "Bandbreite",
    "Spreading Factor": "Spreizfaktor",
    "Coding Rate": "Codierungsrate",
    "Battery Type": "Akkutyp",
    "Flood Scope": "Übertragungsbereich",
    "Routing Mode": "Routing-Modus",
    "Repeat Mode": "Wiederholungsmodus",
    "Loop Detection": "Schleiferkennung",
    "Low Data Rate Optimize": "Niedrige Datenrate optimieren",
    "Explicit Header": "Expliziter Header",
    "IP Address": "IP-Adresse",
    "Port": "Port",
    "Mode": "Modus",
    "Source": "Quelle",
    "Interval": "Intervall",
    "Duration": "Dauer",
    "Time": "Zeit",
    "Theme": "Design",
    "Sound": "Ton",
    "Permission Level": "Berechtigungsstufe",
    "Path Hash": "Pfad-Hash",
    "Path Order": "Pfadreihenfolge",
    "Position Accuracy": "Positionsgenauigkeit",
    "Manual Frequency Override": "Manuelle Frequenzüberschreibung",
    "Pubkey hex": "Öffentlicher Schlüssel (Hex)",
    "Pubkey hex prefix": "Öffentlicher Schlüssel (Hex-Präfix)",
    "Hex hops (e.g., A3,B7,4F)": "Hex-Hops (z. B. A3,B7,4F)",
    "Hex private key": "Privater Hex-Schlüssel",
    "CLI command": "CLI-Befehl",
    "Enter command...": "Befehl eingeben...",
    "Search messages...": "Nachrichten suchen...",
    "Type a message...": "Nachricht eingeben...",
    "Secret (hex)": "Geheimnis (Hex)",
    "Region name (e.g. SoCal)": "Regionsname (z. B. SoCal)",
    "Sync to iCloud": "Mit iCloud synchronisieren",
    "Messages Per Contact": "Nachrichten pro Kontakt",
    "Channels First": "Kanäle zuerst",
    "Theme": "Design",
    "Auto-Update": "Automatische Aktualisierung",
    "Auto Retry": "Automatisch wiederholen",
    "Auto Reset Path": "Pfad automatisch zurücksetzen",
    "In-App Banners": "In-App-Banner",
    "Location in Advertisements": "Standort in Ankündigungen",
    "Include Location": "Standort einschließen",
    "Contacts with Location Permission": "Kontakte mit Standortberechtigung",
    "Contacts with Telemetry Permission": "Kontakte mit Telemetrieberechtigung",
    "GPS & Location": "GPS & Standort",
    "Has notes": "Hat Notizen",
    "Point A": "Punkt A",
    "Point B": "Punkt B",
    "Select Location": "Standort auswählen",
    "Place Pin Here": "Pin hier setzen",

    # ── Actions / menu items (context menus) ──────────────────────────────────
    "Edit Path": "Pfad bearbeiten",
    "Edit Route": "Route bearbeiten",
    "Reset Path": "Pfad zurücksetzen",
    "Forget Saved Password": "Gespeichertes Passwort vergessen",
    "Remember Password": "Passwort merken",
    "Forward To": "Weiterleiten an",
    "Set Nickname": "Spitzname festlegen",
    "Share Channel": "Kanal teilen",
    "Share All Channels": "Alle Kanäle teilen",
    "Share Contact": "Kontakt teilen",
    "Share QR Code": "QR-Code teilen",
    "Scan QR Code": "QR-Code scannen",
    "Leave Channel": "Kanal verlassen",
    "Remove Channel": "Kanal entfernen",
    "Delete Contact": "Kontakt löschen",
    "Delete Message": "Nachricht löschen",
    "Delete All Data": "Alle Daten löschen",
    "Clear Log": "Protokoll löschen",
    "Clear Message Drafts": "Nachrichtenentwürfe löschen",
    "Mute All Members": "Alle Mitglieder stummschalten",
    "Unmute All Members": "Stummschaltung aller Mitglieder aufheben",
    "Import from Link": "Aus Link importieren",
    "Paste Channel Link": "Kanallink einfügen",
    "Paste Contact Link": "Kontaktlink einfügen",
    "Export chat": "Chat exportieren",
    "Send location": "Standort senden",
    "Select Repeaters": "Repeater auswählen",
    "Request Status": "Status anfordern",
    "Request Telemetry": "Telemetrie anfordern",
    "Verify Radio Config": "Radiokonfiguration überprüfen",
    "Refresh all settings": "Alle Einstellungen aktualisieren",
    "Refresh contacts and channels": "Kontakte und Kanäle aktualisieren",
    "Refresh Ports": "Ports aktualisieren",
    "Reload settings": "Einstellungen neu laden",
    "Apply & Reboot": "Anwenden und neu starten",
    "Restore & Reboot": "Wiederherstellen und neu starten",
    "Migrate to Current Radio": "Auf aktuelles Radio migrieren",
    "Migrate Radio Data": "Radiodaten migrieren",
    "Use Connected Radio Settings": "Einstellungen des verbundenen Radios verwenden",
    "View MeshCore Frequency Guide": "MeshCore-Frequenzleitfaden anzeigen",
    "Get nRF Device Firmware Update": "nRF-DFU-App herunterladen",
    "Send start ota Command": "OTA-Startbefehl senden",

    # ── Advert / discovery ────────────────────────────────────────────────────
    "Advertising": "Wird angekündigt",
    "Flood Advert": "Übertragungsankündigung",
    "Standard Advert": "Standard-Ankündigung",
    "Send Flood Advert": "Übertragungsankündigung senden",
    "Flood (entire mesh)": "Übertragung (gesamtes Mesh)",
    "Zero-Hop (nearby only)": "Zero-Hop (nur in der Nähe)",
    "Direct neighbor (0 hops)": "Direkter Nachbar (0 Hops)",

    # ── Stats / data labels ───────────────────────────────────────────────────
    "Avg": "Ø",
    "Max": "Max",
    "Loss": "Verlust",
    "Recv": "Empf.",
    "Value": "Wert",
    "Tuning": "Abstimmung",

    # ── Tip Jar / supporters ──────────────────────────────────────────────────
    "Manage Storage": "Speicher verwalten",
    "Use Passcode": "Passcode verwenden",

    # ── Notification help text ────────────────────────────────────────────────
    "Notify when a contact sends you a direct message.":
        "Benachrichtigen, wenn ein Kontakt eine Direktnachricht sendet.",
    "Notify when a message is posted to a channel you are on.":
        "Benachrichtigen, wenn eine Nachricht in einem Ihren Kanäle veröffentlicht wird.",
    "Notify when a new radio is detected on the mesh.":
        "Benachrichtigen, wenn ein neues Radio im Mesh erkannt wird.",
    "Notify when a room server relays a message to you.":
        "Benachrichtigen, wenn ein Raumserver eine Nachricht weiterleitet.",
    "Notify when your radio connects or disconnects.":
        "Benachrichtigen, wenn Ihr Radio verbindet oder trennt.",
    "Show notification banners even while the app is open.":
        "Benachrichtigungsbanner auch anzeigen, wenn die App geöffnet ist.",
    "Resend failed direct messages up to 3 times before marking as failed.":
        "Fehlgeschlagene Direktnachrichten bis zu 3 Mal erneut senden, bevor sie als fehlgeschlagen markiert werden.",
    "Send delivery confirmations back through every hop in the message route.":
        "Zustellungsbestätigungen über jeden Hop im Nachrichtenweg zurücksenden.",
    "After retries are exhausted, clear the cached route and resend as a mesh flood.":
        "Nach Ablauf aller Wiederholungsversuche wird die gecachte Route gelöscht und als Mesh-Übertragung erneut gesendet.",
}


def apply(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    strings = data.setdefault("strings", {})
    added = 0
    skipped_no_translate = 0

    for key in NO_TRANSLATE:
        if key in strings:
            strings[key]["shouldTranslate"] = False
        else:
            strings[key] = {"shouldTranslate": False}
        skipped_no_translate += 1

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

    print(f"Added {added} DE translations, marked {skipped_no_translate} as shouldTranslate=false.")
    print(f"Total strings: {len(strings)}")


if __name__ == "__main__":
    apply(XCSTRINGS_PATH)
