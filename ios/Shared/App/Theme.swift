//
//  Theme.swift
//  PommeCore
//
//  Color system, mesh theme constants, clipboard helpers, shared UI utilities.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - App Theme Preference

enum AppTheme: String, CaseIterable {
    case system = "System"
    case light = "Light"
    case dark = "Dark"

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var displayName: String {
        switch self {
        case .system: return String(localized: "System")
        case .light: return String(localized: "Light")
        case .dark: return String(localized: "Dark")
        }
    }
}

// MARK: - Theme Colors

enum MeshTheme {
    // Primary accent — adaptive green: darker/richer in light mode, bright in dark mode
    static var accent: Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(red: 0.0, green: 0.85, blue: 0.35, alpha: 1.0)
            } else {
                return NSColor(red: 0.0, green: 0.60, blue: 0.25, alpha: 1.0)
            }
        })
        #elseif os(watchOS)
        Color(red: 0.0, green: 0.85, blue: 0.35) // always bright on watch
        #else
        Color(uiColor: UIColor { traitCollection in
            if traitCollection.userInterfaceStyle == .dark {
                return UIColor(red: 0.0, green: 0.85, blue: 0.35, alpha: 1.0)
            } else {
                return UIColor(red: 0.0, green: 0.60, blue: 0.25, alpha: 1.0)
            }
        })
        #endif
    }

    // Surface colors — adaptive to light/dark mode
    static var surface: Color {
        #if os(macOS)
        Color(nsColor: .controlBackgroundColor)
        #elseif os(watchOS)
        Color(white: 0.15)
        #else
        Color(uiColor: .secondarySystemGroupedBackground)
        #endif
    }

    static var surfaceLight: Color {
        #if os(macOS)
        Color(nsColor: .unemphasizedSelectedContentBackgroundColor)
        #elseif os(watchOS)
        Color(white: 0.22)
        #else
        Color(uiColor: .tertiarySystemGroupedBackground)
        #endif
    }

    static var background: Color {
        #if os(macOS)
        Color(nsColor: .windowBackgroundColor)
        #elseif os(watchOS)
        Color.black
        #else
        Color(uiColor: .systemGroupedBackground)
        #endif
    }

    // Interactive green — for any element where green is the BACKGROUND with black text on top.
    // Lighter than accent in light mode so black text is readable; medium green in dark mode.
    // Used for: buttons, badges, toggles, pills, login buttons, chat bubbles.
    static var interactiveGreen: Color { outgoingBubble }

    // Message bubbles — independent from accent; light enough for black text
    static var outgoingBubble: Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(red: 0.0, green: 0.65, blue: 0.3, alpha: 1.0)
            } else {
                return NSColor(red: 0.75, green: 0.93, blue: 0.78, alpha: 1.0)
            }
        })
        #elseif os(watchOS)
        Color(red: 0.0, green: 0.65, blue: 0.3)
        #else
        Color(uiColor: UIColor { traitCollection in
            if traitCollection.userInterfaceStyle == .dark {
                return UIColor(red: 0.0, green: 0.65, blue: 0.3, alpha: 1.0)
            } else {
                return UIColor(red: 0.75, green: 0.93, blue: 0.78, alpha: 1.0)
            }
        })
        #endif
    }

    static var incomingBubble: Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                return NSColor(red: 0.80, green: 0.45, blue: 0.10, alpha: 1.0)
            } else {
                return NSColor(red: 1.0, green: 0.88, blue: 0.75, alpha: 1.0)
            }
        })
        #elseif os(watchOS)
        Color(red: 0.80, green: 0.45, blue: 0.10)
        #else
        Color(uiColor: UIColor { traitCollection in
            if traitCollection.userInterfaceStyle == .dark {
                return UIColor(red: 0.80, green: 0.45, blue: 0.10, alpha: 1.0)
            } else {
                return UIColor(red: 1.0, green: 0.88, blue: 0.75, alpha: 1.0)
            }
        })
        #endif
    }

    // Status colors — these system colors adapt automatically
    static let connected = Color.green
    static let connecting = Color.orange
    static let initialConnected = Color.yellow
    static let scanning = Color.blue
    static let disconnected = Color.red

    // Text — adaptive
    static let textPrimary = Color.primary
    static let textSecondary = Color.secondary
    static let textOnAccent = Color.black

    // Remote management accent colors
    static let remoteRoom = Color.teal
    static let remoteRepeater = Color.orange
}

// MARK: - TextField Style
//
// .roundedBorder uses systemBackground which is pure black on OLED in dark mode,
// making it invisible on secondarySystemGroupedBackground list rows.
// This style uses the correct elevated surface color for grouped lists.

#if !os(watchOS)
struct MeshTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .foregroundColor(.primary)
            .padding(7)
            #if os(macOS)
            .background(Color(nsColor: .controlBackgroundColor))
            #else
            .background(Color(uiColor: .tertiarySystemGroupedBackground))
            #endif
            .cornerRadius(7)
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(Color.primary.opacity(0.15), lineWidth: 0.5)
            )
    }
}
#endif

// MARK: - Theme Modifier

struct MeshThemeModifier: ViewModifier {
    @AppStorage("appTheme") private var appTheme: String = AppTheme.system.rawValue

    private var selectedTheme: AppTheme {
        AppTheme(rawValue: appTheme) ?? .system
    }

    func body(content: Content) -> some View {
        content
            .tint(MeshTheme.accent)
            .onAppear { applyToAllWindows() }
            .onChange(of: appTheme) { applyToAllWindows() }
    }

    /// Apply theme via UIKit window override — affects all windows including sheets.
    /// SwiftUI's `.preferredColorScheme(nil)` doesn't propagate to sheets,
    /// but UIKit's `overrideUserInterfaceStyle = .unspecified` does.
    /// Called synchronously on main thread (from onAppear/onChange) to avoid
    /// race conditions when the user switches themes rapidly.
    private func applyToAllWindows() {
        let theme = selectedTheme
        #if os(iOS)
        let style: UIUserInterfaceStyle = switch theme {
        case .light: .light
        case .dark: .dark
        case .system: .unspecified
        }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows {
                window.overrideUserInterfaceStyle = style
            }
        }
        #elseif os(macOS)
        switch theme {
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        case .system: NSApp?.appearance = nil
        }
        #endif
    }
}

extension View {
    func meshTheme() -> some View {
        modifier(MeshThemeModifier())
    }

    @ViewBuilder
    func meshListStyle() -> some View {
        #if os(iOS)
        self.listStyle(.insetGrouped)
        #elseif os(watchOS)
        self
        #else
        self
        #endif
    }
}

// MARK: - iCloud KV Store Helpers

extension NSUbiquitousKeyValueStore {

    /// Build a radio-scoped iCloud key. Returns scoped key if radio prefix available, else legacy key.
    func scopedKey(_ base: String, contactHex: String, radioPrefix: String?) -> String {
        if let prefix = radioPrefix, !prefix.isEmpty {
            return "\(base).\(prefix).\(contactHex)"
        }
        return "\(base).\(contactHex)"
    }

    /// Read a string from iCloud, trying scoped key first then legacy fallback.
    func scopedString(base: String, contactHex: String, radioPrefix: String?) -> String? {
        if let prefix = radioPrefix, !prefix.isEmpty {
            let key = "\(base).\(prefix).\(contactHex)"
            if let value = string(forKey: key), !value.isEmpty {
                return value
            }
        }
        let legacyKey = "\(base).\(contactHex)"
        let value = string(forKey: legacyKey)
        return (value?.isEmpty == true) ? nil : value
    }

    /// Read a double from iCloud, trying scoped key first then legacy fallback.
    func scopedDouble(base: String, contactHex: String, radioPrefix: String?) -> Double {
        if let prefix = radioPrefix, !prefix.isEmpty {
            let key = "\(base).\(prefix).\(contactHex)"
            let val = double(forKey: key)
            if val > 0 { return val }
        }
        let legacyKey = "\(base).\(contactHex)"
        return double(forKey: legacyKey)
    }

    /// Save a Codable value to iCloud KV store.
    func saveCodable<T: Encodable>(_ value: T, forKey key: String) {
        if let data = try? JSONEncoder().encode(value) {
            set(data, forKey: key)
            synchronize()
        }
    }

    /// Load a Codable value from iCloud KV store.
    func loadCodable<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        guard let data = data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Set a value and synchronize in one call.
    func setAndSync(_ value: Any?, forKey key: String) {
        set(value, forKey: key)
        synchronize()
    }
}

// MARK: - Feedback Utility

/// Set a Bool binding to true, then reset to false after a delay. Animates both transitions.
func showFeedback(_ state: Binding<Bool>, duration: TimeInterval = 2) {
    withAnimation { state.wrappedValue = true }
    DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
        withAnimation { state.wrappedValue = false }
    }
}

// MARK: - Linear Progress Bar

/// Custom progress bar that avoids NSProgressIndicator's stacking animation bug on macOS,
/// where rapid value updates cause the bar to visually bounce backwards.
struct LinearProgressBar: View {
    let progress: Double
    var tint: Color = MeshTheme.accent

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.2))
                Capsule()
                    .fill(tint)
                    .frame(width: geo.size.width * max(0, min(progress, 1)))
                    .animation(.linear(duration: 0.15), value: progress)
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Copy Button

/// Reusable copy-to-clipboard button with timed "Copied!" feedback and consistent styling.
struct CopyButton: View {
    let text: String
    let label: LocalizedStringKey
    let icon: String
    var copiedLabel: LocalizedStringKey = "Copied!"
    var copiedIcon: String = "checkmark"
    @State private var copied = false

    var body: some View {
        Button {
            copyToClipboard(text)
            showFeedback($copied)
        } label: {
            Label(copied ? copiedLabel : label, systemImage: copied ? copiedIcon : icon)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(MeshTheme.accent.opacity(0.1))
                .foregroundStyle(copied ? MeshTheme.interactiveGreen : MeshTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Label-Value Row

/// Reusable two-column row for displaying a label and value in a List.
struct LabelValueRow: View {
    let label: LocalizedStringKey
    let value: String
    var labelColor: Color = MeshTheme.accent
    var valueColor: Color = MeshTheme.textSecondary

    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(labelColor)
            Spacer()
            Text(value)
                .foregroundStyle(valueColor)
        }
        .listRowBackground(MeshTheme.surface)
        // Read label + value as one VoiceOver element (e.g. "Firmware, 1.15.0").
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Coordinate Input Field

/// Reusable lat/lon text field row for List/Form contexts.
struct CoordinateInputField: View {
    let label: LocalizedStringKey
    let placeholder: String
    @Binding var text: String
    var onChange: (() -> Void)? = nil

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 80, alignment: .leading)
            TextField(placeholder, text: $text)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(MeshTheme.textPrimary)
                #if os(iOS)
                .keyboardType(.numbersAndPunctuation)
                #endif
                .onChange(of: text) { onChange?() }
        }
        .listRowBackground(MeshTheme.surface)
    }
}

// MARK: - macOS Window State

#if os(macOS)
extension NSApplication {
    /// Whether the user can see the app: active and window not miniaturized.
    var isUserViewing: Bool {
        isActive && !(mainWindow?.isMiniaturized ?? true)
    }
}
#endif

// MARK: - Formatting Helpers

extension String {
    /// Strip emoji characters for sorting purposes (e.g. "🐝Mike" sorts as "Mike").
    var strippingEmoji: String {
        unicodeScalars.filter { !$0.properties.isEmoji || $0.properties.isASCIIHexDigit }.map(String.init).joined()
    }
}

/// Format raw SNR value (SNR * 4 from firmware) to human-readable dB string.
func formatSNR<T: BinaryInteger>(_ rawSNR: T) -> String {
    String(format: "%.1f dB", Double(Int(rawSNR)) / 4.0)
}

/// Format frequency from kHz to MHz display string.
func formatFrequency(_ kHz: Double) -> String {
    String(format: "%.3f MHz", kHz / 1000.0)
}

/// Format battery voltage from millivolts to volts string.
func formatBatteryVoltage<T: BinaryInteger>(_ mV: T) -> String {
    String(format: "%.2fV", Double(Int(mV)) / 1000.0)
}

/// Format a coordinate (latitude or longitude) to 6 decimal places.
func formatCoordinate(_ value: Double) -> String {
    String(format: "%.6f", value)
}

func formatUptime(_ seconds: UInt32) -> String {
    guard seconds > 0 else { return "—" }
    let s = Int(seconds)
    let d = s / 86400; let h = (s % 86400) / 3600; let m = (s % 3600) / 60
    if d > 0 { return "\(d)d \(h)h \(m)m" }
    if h > 0 { return "\(h)h \(m)m" }
    if m > 0 { return "\(m)m \(s % 60)s" }
    return "\(s % 60)s"
}

func formatDuration(_ ms: Double) -> String {
    if ms >= 1000 {
        return String(format: "%.2f s", ms / 1000)
    }
    return String(format: "%.1f ms", ms)
}

// MARK: - Shared Settings Components
#if !os(watchOS)

enum SaveButtonState {
    case idle, saved
}

struct SaveButton: View {
    let state: SaveButtonState
    let label: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if state == .saved {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Saved")
                        .foregroundStyle(.green)
                } else {
                    Text(label)
                        .foregroundStyle(MeshTheme.accent)
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .listRowBackground(MeshTheme.surface)
        .animation(.easeInOut(duration: 0.2), value: state)
    }
}

private struct InfoPopoverContent: View {
    let text: LocalizedStringKey

    var body: some View {
        #if os(macOS) || targetEnvironment(macCatalyst)
        Text(text)
            .font(.callout)
            .lineLimit(nil)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(16)
            .frame(minWidth: 240, maxWidth: 340)
        #else
        ScrollView {
            Text(text)
                .font(.callout)
                .lineLimit(nil)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
        }
        .frame(minWidth: 240, maxWidth: 300, minHeight: 60)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #endif
    }
}

struct InfoButton: View {
    let text: LocalizedStringKey
    @State private var showPopover = false

    var body: some View {
        Button {
            showPopover = true
        } label: {
            Image(systemName: "info.circle")
                .foregroundStyle(MeshTheme.textSecondary.opacity(0.75))
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showPopover) {
            InfoPopoverContent(text: text)
        }
    }
}

struct SectionInfoHeader: View {
    let title: LocalizedStringKey?
    let info: LocalizedStringKey
    var titleColor: Color?
    var action: (() -> Void)? = nil
    var actionIcon: String = "arrow.clockwise"
    @State private var showInfo = false

    init(title: LocalizedStringKey? = nil, info: LocalizedStringKey, titleColor: Color? = nil, action: (() -> Void)? = nil, actionIcon: String = "arrow.clockwise") {
        self.title = title
        self.info = info
        self.titleColor = titleColor
        self.action = action
        self.actionIcon = actionIcon
    }

    var body: some View {
        let color = titleColor ?? MeshTheme.textSecondary
        HStack(spacing: 4) {
            if let action {
                // Title + spacer + ↺ icon are one large button — whole row is tappable
                Button(action: action) {
                    HStack(spacing: 6) {
                        if let title {
                            Text(title)
                                .foregroundStyle(color)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: actionIcon)
                            .foregroundStyle(color.opacity(0.75))
                    }
                    .contentShape(Rectangle())
                }
                #if os(macOS) || targetEnvironment(macCatalyst)
                .buttonStyle(.borderless)
                #else
                .buttonStyle(.plain)
                #endif
            } else {
                if let title {
                    Text(title)
                        .foregroundStyle(color)
                }
                Spacer(minLength: 0)
            }
            // ⓘ is always independent — tap doesn't interfere with the title action
            Button {
                showInfo = true
            } label: {
                Image(systemName: "info.circle")
                    .foregroundStyle(color.opacity(0.75))
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showInfo) {
                InfoPopoverContent(text: info)
            }
        }
    }
}

// MARK: - CLI Shared Components

struct CLICommandButton: View {
    let icon: String
    let label: LocalizedStringKey
    var color: Color = MeshTheme.accent
    let action: () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .frame(width: 24)
                Text(label)
                    .foregroundStyle(color)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        .buttonStyle(.borderless)
        #else
        .buttonStyle(.plain)
        #endif
        .listRowBackground(MeshTheme.surface)
    }
}

struct CLIToggleRow: View {
    let icon: String
    let label: LocalizedStringKey
    let settingKey: String
    let onCommand: String
    let offCommand: String
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    var canEdit: Bool = true

    private var isOn: Bool? {
        guard let value = session.settings[settingKey]?.lowercased() else { return nil }
        if value == "on" || value == "1" || value == "true" || value == "enabled" || value.contains("on") { return true }
        if value == "off" || value == "0" || value == "false" || value == "disabled" || value.contains("off") { return false }
        return nil
    }

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Text(label)
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            if canEdit {
                let toggleActive = MeshTheme.interactiveGreen
                HStack(spacing: 0) {
                    Button {
                        sendCLI(onCommand)
                    } label: {
                        Text("On")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(isOn == true ? .black : MeshTheme.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(isOn == true ? toggleActive : Color.clear)
                    }
                    .buttonStyle(.plain)

                    Button {
                        sendCLI(offCommand)
                    } label: {
                        Text("Off")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(isOn == false ? .black : MeshTheme.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(isOn == false ? toggleActive : Color.clear)
                    }
                    .buttonStyle(.plain)
                }
                .background(MeshTheme.background)
                .clipShape(Capsule())
            } else {
                Text(isOn == true ? "On" : isOn == false ? "Off" : "\u{2014}")
                    .foregroundStyle(MeshTheme.textPrimary)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }
}

#endif // !os(watchOS)

// MARK: - Clipboard Utility

/// Copy text to clipboard with auto-expiration for security.
/// iOS: uses UIPasteboard setItems with expirationDate.
/// macOS: uses NSPasteboard with a timed clear.
func copyToClipboard(_ text: String, expireAfter: TimeInterval = 60) {
    #if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    let changeCount = NSPasteboard.general.changeCount
    DispatchQueue.main.asyncAfter(deadline: .now() + expireAfter) {
        // Only clear if clipboard hasn't been changed by user since our copy
        if NSPasteboard.general.changeCount == changeCount {
            NSPasteboard.general.clearContents()
        }
    }
    #elseif !os(watchOS)
    UIPasteboard.general.setItems(
        [[UIPasteboard.typeAutomatic: text]],
        options: [.expirationDate: Date().addingTimeInterval(expireAfter)]
    )
    #endif
}
