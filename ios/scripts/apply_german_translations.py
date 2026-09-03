#!/usr/bin/env python3
"""Apply German translations to Localizable.xcstrings."""

import json, sys

XCSTRINGS_PATH = "Shared/Localizable.xcstrings"

# (English key) -> German translation
# Rules:
#  - Technical terms (LoRa, BLE, dBm, MHz, MeshCore, PommeCore) stay in English
#  - Formal "Sie" throughout
#  - Firmware-defined literals (password, hello) stay in English
#  - Format specifiers (%@, %lld, \n) preserved unchanged
DIRECT: dict[str, str] = {
    # ── Time values ──────────────────────────────────────────────────────────
    "1 hour": "1 Stunde",
    "10 minutes": "10 Minuten",
    "12 hours": "12 Stunden",
    "15 min": "15 Min",
    "15 minutes": "15 Minuten",
    "180 min": "180 Min",
    "120 min": "120 Min",
    "24 hours": "24 Stunden",
    "240 min": "240 Min",
    "3 hours": "3 Stunden",
    "30 min": "30 Min",
    "30 minutes": "30 Minuten",
    "5 min": "5 Min",
    "5 minutes": "5 Minuten",
    "6 hours": "6 Stunden",
    "60 min": "60 Min",
    "90 min": "90 Min",
    "Min": "Min",
    "ago": "vor",

    # ── Plural inflect strings ────────────────────────────────────────────────
    "^[%@ hop](inflect: true)": "^[%@ Hop](inflect: true)",
    "^[%@ contact](inflect: true) can request your telemetry data.": "^[%@ Kontakt](inflect: true) kann Ihre Telemetriedaten anfordern.",
    "^[%@ contact](inflect: true) will receive your location in telemetry.": "^[%@ Kontakt](inflect: true) erhält Ihren Standort in der Telemetrie.",
    "^[%@ node](inflect: true) Found": "^[%@ Knoten](inflect: true) gefunden",
    "^[%@ result](inflect: true)": "^[%@ Ergebnis](inflect: true)",

    # ── Distance / location approximate ──────────────────────────────────────
    "± 100m (~1 block)": "± 100 m (~1 Block)",
    "± 500m (~¼ mile)": "± 500 m (~¼ Meile)",
    "± 1km (~½ mile)": "± 1 km (~½ Meile)",
    "± 5km (~3 miles)": "± 5 km (~3 Meilen)",

    # ── nRF DFU steps ────────────────────────────────────────────────────────
    "1. Open the nRF DFU app": "1. nRF-DFU-App öffnen",
    "2. Tap Settings → enable Packet Receipt Notifications, set to 8": "2. Einstellungen antippen → Paketemfangsbestätigungen aktivieren, auf 8 setzen",
    "3. Select the ZIP file you saved": "3. Die gespeicherte ZIP-Datei auswählen",
    "4. Select your device from the list": "4. Gerät aus der Liste auswählen",
    "5. Tap Upload and wait for completion": "5. Upload antippen und auf Abschluss warten",
    "Install the free nRF Device Firmware Update app by Nordic Semiconductor, then:": "Installieren Sie die kostenlose nRF-DFU-App von Nordic Semiconductor, dann:",
    "Save the firmware ZIP to your Files so the nRF DFU app can access it.": "Firmware-ZIP in Dateien speichern, damit die nRF-DFU-App darauf zugreifen kann.",

    # ── Short UI labels ───────────────────────────────────────────────────────
    "ACL requires USB serial connection": "ACL erfordert USB-Seriellanschluss",
    "Active": "Aktiv",
    "Active Channels": "Aktive Kanäle",
    "Admin": "Administrator",
    "Admin: **password**": "Administrator: **password**",
    "Airtime": "Sendezeit",
    "Airtime Factor": "Sendezeitfaktor",
    "All": "Alle",
    "All boards": "Alle Boards",
    "Allow All": "Alle erlauben",
    "Allowed Repeat Frequencies": "Erlaubte Wiederholungsfrequenzen",
    "Analyze Line of Sight": "Sichtlinienanalyse",
    "Antenna": "Antenne",
    "Antenna & RF Settings": "Antenne & HF-Einstellungen",
    "Apply": "Anwenden",
    "Apply Preset": "Voreinstellung anwenden",
    "Auto (device discovers path)": "Automatisch (Gerät ermittelt Pfad)",
    "Auto-Add Contact Types": "Kontakttypen automatisch hinzufügen",
    "BLE PIN": "BLE-PIN",
    "Battery": "Akku",
    "Bit Rate": "Bitrate",
    "Channels": "Kanäle",
    "Chat exported": "Chat exportiert",
    "Checking for updates...": "Nach Updates suchen…",
    "Clock": "Uhr",
    "Clock out of sync": "Uhr nicht synchronisiert",
    "Close": "Schließen",
    "Communicate Off-Grid": "Off-Grid kommunizieren",
    "Configure Your Device": "Gerät konfigurieren",
    "Connect Your Radio": "Radio verbinden",
    "Connected": "Verbunden",
    "Connection": "Verbindung",
    "Contact": "Kontakt",
    "Contact Info": "Kontaktinformationen",
    "Contact not found": "Kontakt nicht gefunden",
    "Contact shared on mesh.": "Kontakt im Mesh geteilt.",
    "Contacts": "Kontakte",
    "Coords": "Koordinaten",
    "Copied to clipboard": "In die Zwischenablage kopiert",
    "Custom": "Benutzerdefiniert",
    "Custom Nickname": "Benutzerdefinierter Spitzname",
    "Custom:": "Benutzerdefiniert:",
    "Debug Log": "Debug-Protokoll",
    "Default Passwords": "Standardpasswörter",
    "Deny": "Ablehnen",
    "Detected": "Erkannt",
    "Device": "Gerät",
    "Direct": "Direkt",
    "Direct connection (no hops)": "Direktverbindung (keine Hops)",
    "Direct path blocked — relay required": "Direktpfad blockiert — Relais erforderlich",
    "Disable App Lock": "App-Sperre deaktivieren",
    "Disabled": "Deaktiviert",
    "Disconnect": "Trennen",
    "Disconnect USB": "USB trennen",
    "Done": "Fertig",
    "Download & Update Firmware": "Firmware herunterladen und aktualisieren",
    "Draft": "Entwurf",
    "Duty Cycle": "Tastverhältnis",
    "Estimated Range": "Geschätzte Reichweite",
    "Exact": "Genau",
    "Export failed": "Export fehlgeschlagen",
    "Factory Reset": "Werkseinstellung",
    "Fetching terrain data...": "Geländedaten werden abgerufen…",
    "Firmware Installed": "Firmware installiert",
    "Firmware Update Available": "Firmware-Update verfügbar",
    "Flood (broadcast to all)": "Übertragung (an alle senden)",
    "Flooding...": "Wird gesendet…",
    "Frequency": "Frequenz",
    "Frequency (MHz)": "Frequenz (MHz)",
    "Fresnel: %@": "Fresnel: %@",
    "GPS — use live GPS coordinates": "GPS — Live-GPS-Koordinaten verwenden",
    "Generated by PommeCore": "Erstellt von PommeCore",
    "Generating contact code...": "Kontaktcode wird generiert…",
    "Generating contact link...": "Kontaktlink wird generiert…",
    "Get Started": "Loslegen",
    "Groups": "Gruppen",
    "Guest (read-only)": "Gast (nur lesen)",
    "Guest: **hello**": "Gast: **hello**",
    "Hops": "Hops",
    "Icon": "Symbol",
    "Internet map (%@)": "Internetkarte (%@)",
    "Keep the app open while downloading.": "App beim Herunterladen geöffnet lassen.",
    "Latest: %@%@": "Aktuell: %@%@",
    "Listening for LoRa packets...": "Warte auf LoRa-Pakete…",
    "Loading %@...": "Lade %@…",
    "Loading internet map…": "Internetkarte wird geladen…",
    "Loading supporters...": "Unterstützer werden geladen…",
    "Local mesh": "Lokales Mesh",
    "Location unavailable": "Standort nicht verfügbar",
    "Logging in...": "Anmeldung läuft…",
    "Login": "Anmelden",
    "Login Required": "Anmeldung erforderlich",
    "Login Status": "Anmeldestatus",
    "Manual (select repeaters)": "Manuell (Repeater auswählen)",
    "Manual Add Contacts": "Kontakte manuell hinzufügen",
    "Manual — use saved lat/lon settings": "Manuell — gespeicherte Koordinaten verwenden",
    "Map requires iOS 17+": "Karte erfordert iOS 17+",
    "Map requires iOS 17+ or macOS 14+": "Karte erfordert iOS 17+ oder macOS 14+",
    "Mentions": "Erwähnungen",
    "Mesh broadcast channel": "Mesh-Rundsendkanal",
    "MeshCore Project": "MeshCore-Projekt",
    "Messages in this channel will be deleted from your device.": "Nachrichten in diesem Kanal werden von Ihrem Gerät gelöscht.",
    "Messages sent to this channel will appear here.": "An diesen Kanal gesendete Nachrichten erscheinen hier.",
    "Migrate Messages": "Nachrichten migrieren",
    "Mod": "Mod",
    "Monitoring": "Überwachung",
    "Multi-ACK": "Multi-ACK",
    "Muted": "Stummgeschaltet",
    "Name": "Name",
    "Name Wizard": "Namensassistent",
    "Nearby Devices": "Geräte in der Nähe",
    "Need at least 2 readings to show a chart. Request telemetry again.": "Mindestens 2 Messwerte für ein Diagramm erforderlich. Telemetrie erneut anfordern.",
    "Never seen": "Noch nie gesehen",
    "New Messages": "Neue Nachrichten",
    "New contact discovered": "Neuer Kontakt entdeckt",
    "No Blocked Contacts": "Keine gesperrten Kontakte",
    "No Contacts Yet": "Noch keine Kontakte",
    "No Device Connected": "Kein Gerät verbunden",
    "No Radio Connected": "Kein Radio verbunden",
    "No chat contacts available": "Keine Chat-Kontakte verfügbar",
    "No contacts in this group": "Keine Kontakte in dieser Gruppe",
    "No contacts with GPS coordinates": "Keine Kontakte mit GPS-Koordinaten",
    "No contacts with GPS coordinates available": "Keine Kontakte mit GPS-Koordinaten verfügbar",
    "No contacts with location data": "Keine Kontakte mit Standortdaten",
    "No devices found": "Keine Geräte gefunden",
    "No log entries": "Keine Protokolleinträge",
    "No messages yet": "Noch keine Nachrichten",
    "No nodes discovered": "Keine Knoten entdeckt",
    "No password required. Then return to this screen.": "Kein Passwort erforderlich. Dann zu diesem Bildschirm zurückkehren.",
    "No repeaters discovered": "Keine Repeater entdeckt",
    "No serial ports detected": "Keine seriellen Ports erkannt",
    "No supporters yet": "Noch keine Unterstützer",
    "No telemetry data": "Keine Telemetriedaten",
    "No telemetry data yet": "Noch keine Telemetriedaten",
    "None — don’t include location": "Keine — Standort nicht einschließen",
    "Not delivered": "Nicht zugestellt",
    "Off": "Aus",
    "Off-Grid Mesh Messaging": "Off-Grid-Mesh-Nachrichten",
    "On": "Ein",
    "Open Node Namer": "Knotenbenennungstool öffnen",
    "Open Settings Now": "Einstellungen jetzt öffnen",
    "Or Enter Path Manually": "Oder Pfad manuell eingeben",
    "Others can scan this QR code to add you as a contact.": "Andere können diesen QR-Code scannen, um Sie als Kontakt hinzuzufügen.",
    "Outbound path has been reset. A new path will be discovered on next communication.": "Ausgehender Pfad wurde zurückgesetzt. Beim nächsten Kontakt wird ein neuer Pfad ermittelt.",
    "Pan the map to position the pin, then click Place Pin Here": "Karte verschieben, um Pin zu positionieren, dann auf „Pin hier setzen“ klicken",
    "Parameters": "Parameter",
    "Passwords are case-sensitive, max 15 characters.": "Passwörter unterscheiden Groß-/Kleinschreibung, max. 15 Zeichen.",
    "Paste a meshcore:// link to import a contact or channel.": "meshcore://-Link einfügen, um Kontakt oder Kanal zu importieren.",
    "Paste the hex-encoded private key from a previous backup. The device will reboot after restoring.": "Hex-kodierten privaten Schlüssel aus einem früheren Backup einfügen. Das Gerät wird nach der Wiederherstellung neu gestartet.",
    "Paste your generated name:": "Generierten Namen einfügen:",
    "Path: %@": "Pfad: %@",
    "Pending Contacts": "Ausstehende Kontakte",
    "Per-Contact": "Pro Kontakt",
    "Performance by Spreading Factor": "Leistung nach Spreizfaktor",
    "Planning": "Planung",
    "Point A Antenna": "Antenne Punkt A",
    "Point B Antenna": "Antenne Punkt B",
    "PommeCore is Locked": "PommeCore ist gesperrt",
    "Position": "Position",
    "Position: %@ along path": "Position: %@ entlang des Pfades",
    "Preview": "Vorschau",
    "Privacy Policy": "Datenschutzerklärung",
    "Products unavailable": "Produkte nicht verfügbar",
    "Protocol operations will appear here": "Protokolloperationen werden hier angezeigt",
    "Public Channel": "Öffentlicher Kanal",
    "Public Key": "Öffentlicher Schlüssel",
    "Query Repeat Frequencies": "Wiederholungsfrequenzen abfragen",
    "Quick Reference": "Kurzübersicht",
    "RF Monitor": "HF-Monitor",
    "RSSI (dBm)": "RSSI (dBm)",
    "RX Delay": "Empfangsverzögerung",
    "Radio": "Radio",
    "Radio %@...": "Radio %@…",
    "Range": "Reichweite",
    "Raw Voltage": "Rohspannung",
    "Read-Write": "Lesen-Schreiben",
    "Read-only access — posting not available": "Nur-Lese-Zugriff — Senden nicht verfügbar",
    "Reboot Device": "Gerät neu starten",
    "Received": "Empfangen",
    "Refresh Stats": "Statistiken aktualisieren",
    "Relay Analysis": "Relaisanalyse",
    "Repeat Mode": "Wiederholungsmodus",
    "Repeated": "Wiederholt",
    "Request telemetry from the device to start collecting history.": "Telemetrie vom Gerät anfordern, um den Verlauf zu starten.",
    "Reset Calibration": "Kalibrierung zurücksetzen",
    "Restore Identity Key": "Identitätsschlüssel wiederherstellen",
    "Results": "Ergebnisse",
    "Retry %@ of 3": "Versuch %@ von 3",
    "Retrying (%@/3)...": "Wird wiederholt (%@/3)…",
    "Retrying (attempt %@)...": "Wird wiederholt (Versuch %@)…",
    "Rooms": "Räume",
    "Routing Path": "Routing-Pfad",
    "SNR (dB)": "SNR (dB)",
    "Saved": "Gespeichert",
    "Scan QR code to add channel": "QR-Code scannen, um Kanal hinzuzufügen",
    "Scan QR code to import all channels": "QR-Code scannen, um alle Kanäle zu importieren",
    "Scan this QR code or share the link to add this contact.": "Diesen QR-Code scannen oder Link teilen, um diesen Kontakt hinzuzufügen.",
    "Scanning...": "Wird gescannt…",
    "Searching for MeshCore devices...": "Suche nach MeshCore-Geräten…",
    "Select Bandwidth": "Bandbreite auswählen",
    "Select a Contact": "Kontakt auswählen",
    "Select...": "Auswählen…",
    "Send a message to start the conversation.": "Nachricht senden, um das Gespräch zu beginnen.",
    "Sensitivity": "Empfindlichkeit",
    "Sensors require admin access. Guest login is not supported.": "Sensoren erfordern Administratorzugriff. Gast-Anmeldung wird nicht unterstützt.",
    "Set": "Setzen",
    "Set Your Region": "Region festlegen",
    "Share Location in Advert": "Standort in Ankündigung teilen",
    "Share Location on MeshCore Map": "Standort auf MeshCore-Karte teilen",
    "Share Results": "Ergebnisse teilen",
    "Show Welcome Guide": "Willkommensführung anzeigen",
    "Skip": "Überspringen",
    "Slot %@": "Slot %@",
    "Start Log": "Protokoll starten",
    "Start OTA Mode Only": "Nur OTA-Modus starten",
    "Status": "Status",
    "Status: %@": "Status: %@",
    "Stop Log": "Protokoll stoppen",
    "Stop Scan": "Scan stoppen",
    "Strict": "Streng",
    "Support PommeCore Development": "PommeCore-Entwicklung unterstützen",
    "Sync Clock": "Uhr synchronisieren",
    "TX Power": "Sendeleistung",
    "TX Power: %@ dBm": "Sendeleistung: %@ dBm",
    "Tap Start Discover to scan the mesh": "Suche starten antippen, um das Mesh zu scannen",
    "Tap Start to begin capturing LoRa packet signal data.": "Start antippen, um LoRa-Paketsignaldaten zu erfassen.",
    "Tap the map to place a pin": "Karte antippen, um einen Pin zu setzen",
    "Tap to retry": "Antippen zum Wiederholen",
    "Tap to scan again": "Antippen, um erneut zu scannen",
    "Telemetry History": "Telemetrieverlauf",
    "Telemetry: %@": "Telemetrie: %@",
    "Terrain Profile": "Geländeprofil",
    "Timed Discovery": "Zeitgesteuerte Erkennung",
    "Try Again": "Erneut versuchen",
    "USB Device": "USB-Gerät",
    "USB Serial": "USB-Seriell",
    "USB Serial • Admin": "USB-Seriell • Administrator",
    "USB Terminal": "USB-Terminal",
    "USB device not connected": "USB-Gerät nicht verbunden",
    "Update Failed": "Update fehlgeschlagen",
    "Verified": "Verifiziert",
    "View Supporters Wall": "Unterstützerwand anzeigen",
    "Welcome to PommeCore": "Willkommen bei PommeCore",
    "WiFi": "WiFi",
    "WiFi Radio": "WiFi-Radio",
    "Your Key Prefix": "Ihr Schlüsselpräfix",
    "direct": "direkt",
    "iCloud Storage": "iCloud-Speicher",
    "v%@ available — tap to update (you have v%@)": "v%@ verfügbar — antippen zum Aktualisieren (Sie haben v%@)",

    # ── Format strings with %@ ────────────────────────────────────────────────
    "$9.99 supporters also receive Watch Companion automatically.": "Unterstützer für $9,99 erhalten den Watch Companion automatisch.",
    "%@ (%@%%)": "%@ (%@%%)",
    "%@ Channels": "%@ Kanäle",
    "%@ Login": "%@ Anmeldung",
    "%@ contacts total, %@ with coordinates": "%@ Kontakte gesamt, %@ mit Koordinaten",
    "%@ keys, %@": "%@ Schlüssel, %@",
    "%@ messages": "%@ Nachrichten",
    "%@ messages in iCloud": "%@ Nachrichten in iCloud",
    "%@ msg, %@ telemetry, %@ coverage": "%@ Nachr., %@ Telemetrie, %@ Abdeckung",
    "%@ nodes in this area": "%@ Knoten in diesem Bereich",
    "Clearance: %@": "Freiheit: %@",
    "Connected — %@": "Verbunden — %@",
    "Connected — %@ · %@": "Verbunden — %@ · %@",
    "Connecting to USB device...": "Verbindung mit USB-Gerät…",
    "Delete (%@)": "Löschen (%@)",
    "Export (%@)": "Exportieren (%@)",
    "Authentication failed %@ times": "Authentifizierung %@ mal fehlgeschlagen",
    "Enter the admin password to manage this %@.": "Administratorpasswort eingeben, um dieses %@ zu verwalten.",

    # ── Longer descriptive strings ────────────────────────────────────────────
    "Approaching iCloud limit (1 MB). Consider deleting old radio data below.": "iCloud-Limit (1 MB) wird erreicht. Alte Radiodaten unten löschen.",
    "Are you sure you want to remove %@? This will delete all messages with this contact.": "Möchten Sie %@ wirklich entfernen? Dabei werden alle Nachrichten mit diesem Kontakt gelöscht.",
    "Authenticate to access your messages": "Authentifizieren Sie sich, um auf Ihre Nachrichten zuzugreifen",
    "Be the first! Leave a \U0001f49a I Want to Help! tip to join the wall.": "Seien Sie der Erste! Hinterlassen Sie ein \U0001f49a Ich möchte helfen!-Trinkgeld, um auf der Wand zu erscheinen.",
    "\U0001f49a I Want to Help! tippers can add their name to the Supporters Wall.": "\U0001f49a Ich möchte helfen!-Trinkgeldgeber können ihren Namen der Unterstützerwand hinzufügen.",
    "Blocked contacts won’t appear in your contact list and their messages will be suppressed.": "Gesperrte Kontakte erscheinen nicht in Ihrer Kontaktliste und ihre Nachrichten werden unterdrückt.",
    "Change default passwords after login via Remote Management → Security.": "Standardpasswörter nach der Anmeldung über Remote-Verwaltung → Sicherheit ändern.",
    "Channel secret not available locally. Recipients will need the secret separately to join.": "Kanalgeheimnis ist lokal nicht verfügbar. Empfänger benötigen das Geheimnis separat zum Beitreten.",
    "Choose a contact or channel from the sidebar to start messaging.": "Kontakt oder Kanal aus der Seitenleiste auswählen, um Nachrichten zu senden.",
    "Connect to a MeshCore radio to view and change device settings.": "Verbinden Sie sich mit einem MeshCore-Radio, um Geräteeinstellungen anzuzeigen und zu ändern.",
    "Connect to a companion radio with WiFi enabled (TCP, default port 5000).": "Verbinden Sie sich mit einem Companion-Radio mit aktiviertem WiFi (TCP, Standardport 5000).",
    "Connect via USB. If not listed, run ‘ls /dev/cu.*’ in Terminal and enter the path manually.": "Per USB verbinden. Falls nicht aufgelistet, „ls /dev/cu.*’ im Terminal ausführen und Pfad manuell eingeben.",
    "Copy all message history from the old radio to your currently connected radio.": "Gesamten Nachrichtenverlauf vom alten Radio auf das aktuell verbundene Radio kopieren.",
    "Could not connect to the device. Would you like to scan again?": "Verbindung zum Gerät konnte nicht hergestellt werden. Möchten Sie erneut scannen?",
    "Do not close the app or disconnect from ‘%@’ WiFi.": "App nicht schließen oder vom WiFi „%@“ trennen.",
    "Drag across the chart to inspect elevation and clearance at any point.": "Über das Diagramm ziehen, um Höhe und Freiheit an beliebigen Punkten zu prüfen.",
    "Enter a new name for this channel.": "Neuen Namen für diesen Kanal eingeben.",
    "Enter a valid latitude (−90 to 90) and longitude (−180 to 180)": "Gültige Breite (−90 bis 90) und Länge (−180 bis 180) eingeben",
    "Enter repeater hashes separated by commas.": "Repeater-Hashes durch Kommas getrennt eingeben.",
    "Enter the room server password to view and post messages.": "Raumserver-Passwort eingeben, um Nachrichten anzuzeigen und zu senden.",
    "EU 868 MHz band: 1% duty cycle. US 915 MHz: no duty cycle limit (FCC dwell time applies instead).": "EU-868-MHz-Band: 1% Tastverhältnis. US 915 MHz: kein Tastverhältnislimit (FCC-Verweilzeit gilt stattdessen).",
    "Free-space path loss assumes ideal conditions (no obstacles, reflections, or atmospheric absorption). Real-world loss is typically 10-30 dB higher.": "Freiraumdämpfung setzt ideale Bedingungen voraus (keine Hindernisse, Reflexionen oder atmosphärische Absorption). Realer Verlust ist typischerweise 10–30 dB höher.",
    "Location access denied. Enable in Settings → Privacy → Location Services.": "Standortzugriff verweigert. In Einstellungen → Datenschutz → Ortungsdienste aktivieren.",
    "Make sure your device is connected to ‘%@’ WiFi.": "Stellen Sie sicher, dass Ihr Gerät mit dem WiFi „%@“ verbunden ist.",
    "Note: if your radio is connected via WiFi, it will disconnect when OTA mode starts — that’s expected.": "Hinweis: Wenn Ihr Radio über WiFi verbunden ist, wird es beim Start des OTA-Modus getrennt — das ist erwartet.",
    "Outbound path has been reset. A new path will be discovered on next communication.": "Ausgehender Pfad wurde zurückgesetzt. Beim nächsten Kontakt wird ein neuer Pfad ermittelt.",
    "PommeCore is free with all features unlocked. If you find it useful, consider leaving a tip to support continued development.": "PommeCore ist kostenlos und alle Funktionen sind verfügbar. Wenn Sie es nützlich finden, hinterlassen Sie ein Trinkgeld zur Unterstützung der weiteren Entwicklung.",
    "Press the physical OTA button on your hardware, or connect via USB serial and run:": "Die physische OTA-Taste an der Hardware drücken oder per USB-Seriell verbinden und ausführen:",
    "Remove “%@” from your channels?": "„%@“ aus Ihren Kanälen entfernen?",
    "Add “%@” to your channels, or replace all existing channels?": "„%@“ zu Ihren Kanälen hinzufügen oder alle bestehenden Kanäle ersetzen?",
    "Set a local nickname for %@. This is only visible to you.": "Lokalen Spitznamen für %@ festlegen. Dieser ist nur für Sie sichtbar.",
    "Sets the default region scope for flood packets originating from this device. Leave empty to clear.": "Legt den Standard-Regionsbereich für Übertragungspakete dieses Geräts fest. Zum Löschen leer lassen.",
    "Send an advertisement to announce your presence on the mesh. Other nodes will appear here as they respond.": "Ankündigung senden, um die eigene Präsenz im Mesh bekannt zu geben. Andere Knoten erscheinen hier, sobald sie antworten.",
    "Send and receive mesh messages from your Apple Watch.": "Mesh-Nachrichten von Ihrer Apple Watch senden und empfangen.",
    "Send direct messages, join channels, and connect with others across the mesh network without internet or cell service.": "Direktnachrichten senden, Kanäle beitreten und mit anderen im Mesh-Netzwerk kommunizieren – ohne Internet oder Mobilfunk.",
    "Send messages, share channels, and connect with others using LoRa radio — no internet or cell service needed.": "Nachrichten senden, Kanäle teilen und mit anderen per LoRa-Radio kommunizieren – kein Internet oder Mobilfunk erforderlich.",
    "Sends periodic flood advertisements for the selected duration. Uses more battery and airtime than a single scan.": "Sendet periodische Übertragungsankündigungen für die ausgewählte Dauer. Verbraucht mehr Akku und Sendezeit als ein einzelner Scan.",
    "Sensitivity assumes CR 4/5. Range is theoretical FSPL max with 22 dBm TX + 2 dBi antenna. Real-world range is typically 30-50% of theoretical.": "Empfindlichkeit setzt CR 4/5 voraus. Reichweite ist theoretisches FSPL-Maximum mit 22 dBm TX + 2 dBi Antenne. Reale Reichweite beträgt typischerweise 30–50% des Theoretischen.",
    "Thank you for your generous tip! Enter a display name to appear on the Supporters Wall, visible to all PommeCore users.": "Vielen Dank für Ihr großzügiges Trinkgeld! Geben Sie einen Anzeigenamen ein, um auf der Unterstützerwand zu erscheinen, die für alle PommeCore-Benutzer sichtbar ist.",
    "The contact’s meshcore:// link has been copied to the clipboard.": "Der meshcore://-Link des Kontakts wurde in die Zwischenablage kopiert.",
    "The device name has been updated. A reboot is required for the change to take effect.": "Der Gerätename wurde aktualisiert. Ein Neustart ist erforderlich, damit die Änderung wirksam wird.",
    "The device rebooted successfully. Reconnect your WiFi to your normal network if needed — the app will reconnect automatically.": "Das Gerät wurde erfolgreich neu gestartet. Verbinden Sie Ihr WiFi bei Bedarf wieder mit Ihrem normalen Netzwerk – die App verbindet sich automatisch wieder.",
    "The device will create a ‘MeshCore-OTA’ WiFi hotspot. Connect to it and use ‘Download & Update Firmware’ to upload the binary.": "Das Gerät erstellt einen „MeshCore-OTA“ WiFi-Hotspot. Verbinden Sie sich damit und verwenden Sie „Firmware herunterladen und aktualisieren“, um die Binärdatei hochzuladen.",
    "The radio will disconnect and restart. You’ll need to reconnect via Bluetooth.": "Das Radio wird getrennt und neu gestartet. Sie müssen sich erneut über Bluetooth verbinden.",
    "The remote device will restart. You will need to log in again.": "Das entfernte Gerät wird neu gestartet. Sie müssen sich erneut anmelden.",
    "Theoretical maximum based on TX power, antenna gains, and RX sensitivity. Actual range depends on terrain, obstructions, and interference.": "Theoretisches Maximum basierend auf Sendeleistung, Antennengewinn und Empfangsempfindlichkeit. Tatsächliche Reichweite hängt von Gelände, Hindernissen und Interferenzen ab.",
    "These generous people help keep PommeCore free for everyone.": "Diese großzügigen Menschen helfen, PommeCore für alle kostenlos zu halten.",
    "These tools don’t require a radio connection.": "Diese Tools erfordern keine Radioverbindung.",
    "These tools require a radio connection.": "Diese Tools erfordern eine Radioverbindung.",
    "This may take up to 30 seconds after the radio starts OTA mode.": "Dies kann bis zu 30 Sekunden dauern, nachdem das Radio den OTA-Modus gestartet hat.",
    "This nickname is stored locally on your device. It doesn’t change anything on the radio or the mesh network.": "Dieser Spitzname wird lokal auf Ihrem Gerät gespeichert. Er ändert nichts am Radio oder im Mesh-Netzwerk.",
    "This will erase all data and cannot be undone.\n\nType RESET to confirm.": "Alle Daten werden gelöscht und dies kann nicht rückgängig gemacht werden.\n\nRESET eingeben zur Bestätigung.",
    "This will permanently delete all synced messages for this radio from iCloud and all your devices. This cannot be undone.": "Alle synchronisierten Nachrichten für dieses Radio werden dauerhaft aus iCloud und allen Ihren Geräten gelöscht. Dies kann nicht rückgängig gemacht werden.",
    "This will remove the selected contacts from the device. This cannot be undone.": "Die ausgewählten Kontakte werden vom Gerät entfernt. Dies kann nicht rückgängig gemacht werden.",
    "TIP: Name your radio with your initials + first 4 of your public key (e.g., NMA-5abd). You can change this in Settings after connecting.": "TIPP: Benennen Sie Ihr Radio mit Ihren Initialen + den ersten 4 Zeichen Ihres öffentlichen Schlüssels (z. B. NMA-5abd). Sie können dies in den Einstellungen nach dem Verbinden ändern.",
    "Turn on your MeshCore radio and tap Connect to begin.": "Schalten Sie Ihr MeshCore-Radio ein und tippen Sie auf Verbinden, um zu beginnen.",
    "Turn on your MeshCore radio and tap the button below to scan for nearby devices.": "Schalten Sie Ihr MeshCore-Radio ein und tippen Sie unten auf den Knopf, um nach Geräten in der Nähe zu suchen.",
    "Use the MeshCore Node Namer to generate a standardized name for your device.": "Verwenden Sie den MeshCore-Knotenbenenner, um einen standardisierten Namen für Ihr Gerät zu generieren.",
    "Your device advertisement has been broadcast to the mesh network.": "Ihre Gerätankündigung wurde an das Mesh-Netzwerk gesendet.",
    "Your radio is connected via USB. Tap the button below to send the command.": "Ihr Radio ist über USB verbunden. Tippen Sie auf die Schaltfläche unten, um den Befehl zu senden.",
    "Your radio is logged in via remote admin. Tap the button below to send the command.": "Ihr Radio ist über Remote-Admin angemeldet. Tippen Sie auf die Schaltfläche unten, um den Befehl zu senden.",
    "Your radio must use the correct frequency for your country. Using the wrong frequency may violate local regulations.": "Ihr Radio muss die richtige Frequenz für Ihr Land verwenden. Die Verwendung der falschen Frequenz kann gegen lokale Vorschriften verstoßen.",
    "Zero-hop reaches nearby nodes only. Flood is relayed by repeaters across the entire mesh network.": "Zero-Hop erreicht nur nahe Knoten. Übertragung wird von Repeatern im gesamten Mesh-Netzwerk weitergeleitet.",
    "After the radio starts OTA mode, click the WiFi icon in the menu bar and connect to:": "Nachdem das Radio den OTA-Modus gestartet hat, auf das WiFi-Symbol in der Menüleiste klicken und verbinden mit:",
    "After the radio starts OTA mode, go to Settings → Wi-Fi and connect to:": "Nachdem das Radio den OTA-Modus gestartet hat, zu Einstellungen → WLAN gehen und verbinden mit:",
    "Permanently erases ALL data including keys, contacts, and settings. This cannot be undone.": "Löscht ALLE Daten dauerhaft, einschließlich Schlüssel, Kontakte und Einstellungen. Dies kann nicht rückgängig gemacht werden.",
    "Once connected, tap the gear icon at the top of the sidebar — or tap the connection bar — to open Settings. From there you can set your radio frequency, display name, privacy options, and more.": "Nach dem Verbinden tippen Sie auf das Zahnrad-Symbol oben in der Seitenleiste — oder tippen Sie auf die Verbindungsleiste — um die Einstellungen zu öffnen. Dort können Sie Radiofrequenz, Anzeigename, Datenschutzoptionen und mehr festlegen.",
    "This will change your radio to %@, BW %@ kHz, SF%@, CR 4/%@.\n\nAll nodes on your mesh must use the same settings.": "Das Radio wird auf %@, BW %@ kHz, SF%@, CR 4/%@ umgestellt.\n\nAlle Knoten im Mesh müssen dieselben Einstellungen verwenden.",
    "Import %@?\n\nAdd will keep your existing channels. Replace will remove all current channels first.": "Import %@?\n\nHinzufügen behält bestehende Kanäle. Ersetzen entfernt zunächst alle aktuellen Kanäle.",

    # Multiline strings
    "Signal strength data is collected automatically while the RF Monitor is open and you’re moving. Every received packet is GPS-tagged and plotted here as a colour-coded heat map.\n\nOpen the RF Monitor tab and move around with your radio to start building coverage data.": (
        "Signalstärkendaten werden automatisch gesammelt, wenn der HF-Monitor geöffnet ist und Sie sich bewegen. "
        "Jedes empfangene Paket wird GPS-markiert und hier als farbkodierte Heatmap dargestellt.\n\n"
        "Öffnen Sie den HF-Monitor-Tab und bewegen Sie sich mit Ihrem Radio, um Abdeckungsdaten aufzubauen."
    ),
    "Your companion radio will act as a portable repeater.\n\nAllowed frequency ranges:\n%@\n\nThis is useful for camping, hiking, and search & rescue where repeater infrastructure doesn’t exist.": (
        "Ihr Companion-Radio fungiert als tragbarer Repeater.\n\n"
        "Erlaubte Frequenzbereiche:\n%@\n\n"
        "Dies ist nützlich beim Camping, Wandern und bei Such- und Rettungsaktionen, wo keine Repeater-Infrastruktur vorhanden ist."
    ),
    "Your companion radio will act as a portable repeater.\n\nThis is useful for camping, hiking, and search & rescue where repeater infrastructure doesn’t exist.\n\nRepeat mode is restricted to allowed frequency ranges configured on the device.": (
        "Ihr Companion-Radio fungiert als tragbarer Repeater.\n\n"
        "Dies ist nützlich beim Camping, Wandern und bei Such- und Rettungsaktionen, wo keine Repeater-Infrastruktur vorhanden ist.\n\n"
        "Wiederholungsmodus ist auf die am Gerät konfigurierten erlaubten Frequenzbereiche beschränkt."
    ),
    "Your radio’s frequency is set during flashing. If you need to change it, go to Settings → Radio after connecting. All radios on your mesh must use the same frequency, bandwidth, spreading factor, and coding rate.": (
        "Die Frequenz Ihres Radios wird beim Flashen eingestellt. Um sie zu ändern, gehen Sie nach dem Verbinden "
        "zu Einstellungen → Radio. Alle Radios im Mesh müssen dieselbe Frequenz, Bandbreite, "
        "Spreizfaktor und Kodierungsrate verwenden."
    ),
    "If your radio won’t appear in the scanner:\n\n1. Go to Settings → Bluetooth\n2. Find your MeshCore device and tap ⓘ\n3. Tap ‘Forget This Device’\n4. Power off the radio for 30 seconds\n5. Power it back on and scan again\n\nForce-quitting the app can leave the radio’s Bluetooth in a stuck state. A full power cycle clears it.": (
        "Wenn Ihr Radio im Scanner nicht erscheint:\n\n"
        "1. Zu Einstellungen → Bluetooth gehen\n"
        "2. Ihr MeshCore-Gerät finden und ⓘ antippen\n"
        "3. „Disses Gerät vergessen“ antippen\n"
        "4. Radio 30 Sekunden ausschalten\n"
        "5. Wieder einschalten und erneut scannen\n\n"
        "Ein erzwungenes Beenden der App kann den Bluetooth des Radios in einem blockierten Zustand hinterlassen. Ein vollständiger Neustart behebt dies."
    ),
}


def apply_translations(path: str, translations: dict[str, str]) -> None:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    strings = data.setdefault("strings", {})
    applied = 0
    skipped_missing = []

    for en_key, de_value in translations.items():
        if en_key not in strings:
            skipped_missing.append(en_key)
            continue
        entry = strings[en_key]
        if not entry.get("shouldTranslate", True):
            continue
        locs = entry.setdefault("localizations", {})
        if "de" not in locs:
            locs["de"] = {"stringUnit": {"state": "translated", "value": de_value}}
            applied += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Applied {applied} German translations.")
    if skipped_missing:
        print(f"\nKeys in DIRECT dict not found in xcstrings ({len(skipped_missing)}):")
        for k in skipped_missing:
            print(f"  {repr(k)}")

    # Report remaining untranslated
    remaining = [
        k for k, v in strings.items()
        if v.get("shouldTranslate", True) and "de" not in v.get("localizations", {})
    ]
    print(f"\nRemaining untranslated: {len(remaining)}")
    for k in sorted(remaining):
        print(f"  {repr(k)}")


if __name__ == "__main__":
    apply_translations(XCSTRINGS_PATH, DIRECT)
