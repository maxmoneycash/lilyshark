import SwiftUI
import MeshCoreKit
#if os(iOS)
import UIKit
#endif

/// Available without a radio or network connection. Reports are local snapshots
/// that the user can review and edit before invoking the system share sheet.
struct HelpView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    #if os(iOS)
    @Environment(\.openURL) private var openURL
    #endif

    var body: some View {
        List {
            #if os(iOS) || os(macOS)
            Section {
                NavigationLink {
                    TDeckExperienceView()
                } label: {
                    Label("Look around the deck", systemImage: "rotate.3d")
                        .touchable()
                }
                .listRowBackground(MeshTheme.surface)
            } footer: {
                Text("Drag to turn the reconstructed T-Deck. Swipe or use Next to walk through every firmware screen.")
            }
            #endif
            Section("Get Connected") {
                guidance("Choose your radio", "Turn on your radio and keep it nearby. Open Connect a Radio and choose its name under Meshtastic or MeshCore. Allow Bluetooth access when asked.")
                guidance("Wait for the radio", "After connecting, Lilyshark waits for the radio to share its contacts, channels, and messages. A missing position or signal reading means it has not been reported.")
                guidance("Find someone to message", "Contacts appear as your radio reports them. A compatible channel lets you message people who use the same channel settings. MeshCore and Meshtastic use different mesh protocols.")
            }

            Section("What Your Radio Supports") {
                guidance("Lilyshark decks · Meshtastic", "View the nodes your deck reports, exchange messages, and see reported positions and health. MeshCore configuration and remote management tools do not apply to these decks.")
                guidance("MeshCore radios", "Use messaging, channels, and the settings supported by your radio’s firmware. Wi-Fi connections require a MeshCore companion radio with TCP enabled on the same network.")
            }

            Section("If You Cannot Connect") {
                guidance("Check Bluetooth access", "Keep Bluetooth on and allow Lilyshark to use it. Return to the scanner and choose Scan Again after checking your radio.")
                #if os(iOS)
                Button {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    openURL(url)
                } label: {
                    Label("Open App Settings", systemImage: "arrow.up.right.square")
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshSecondary)
                .listRowBackground(MeshTheme.surface)
                #endif
                guidance("Check the radio", "Move closer and disconnect any other app using the radio. If it still does not appear, turn the radio off and on, then scan again.")
                guidance("If pairing keeps failing", "Follow your radio’s pairing instructions and check any PIN shown on its screen. If an old pairing is the problem, forget that radio in system Bluetooth settings and pair again.")
            }

            Section("If a Message Does Not Arrive") {
                guidance("Read its delivery status", "A failed message shows the reason reported by the radio when available. Check the connection and channel settings before retrying. A retry can create a duplicate if the first message arrived without an acknowledgment.")
                guidance("Sent and delivered", "A radio can confirm a local transmission without confirming that the other person received it. Use the status shown on each message; a missing acknowledgment does not prove the person is offline.")
            }

            #if !os(watchOS)
            Section {
                NavigationLink {
                    DiagnosticsReportView(report: diagnosticReport)
                } label: {
                    Label("Review Diagnostic Report", systemImage: "doc.text.magnifyingglass")
                        .touchable()
                }
                .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("Includes app details and recent activity from this app session. You can remove private details before choosing where to share it.")
            }
            #endif
        }
        .meshListStyle()
        .navigationTitle("Help & Diagnostics")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func guidance(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text(title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(detail)
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(MeshTheme.surface)
    }

    private var diagnosticReport: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Not reported"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Not reported"
        let connection: String
        switch connectionManager.connectionState {
        case .disconnected: connection = "Disconnected"
        case .scanning: connection = "Scanning"
        case .connecting: connection = "Connecting"
        case .connected: connection = "Connected; waiting for radio"
        case .ready: connection = "Ready"
        }
        let activity = DebugLogger.shared.exportText()
        return """
        Lilyshark diagnostic report
        App: \(version) (\(build))
        Created: \(Date().formatted(.iso8601))
        System: \(ProcessInfo.processInfo.operatingSystemVersionString)
        Connection: \(connection)

        Recent app activity
        \(activity.isEmpty ? "No activity recorded in this app session." : activity)
        """
    }
}

#if !os(watchOS)
private struct DiagnosticsReportView: View {
    @State var report: String

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.regular) {
            Text("Logs can include messages and device identifiers. Edit or remove details here before sharing.")
                .font(.footnote)
                .foregroundStyle(MeshTheme.textSecondary)
            TextEditor(text: $report)
                .font(.system(.body, design: .monospaced))
                .accessibilityLabel("Diagnostic report, editable")
            ShareLink(item: report) {
                Label("Share Diagnostic Report", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshPrimary)
            .disabled(report.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
        .background(MeshTheme.background)
        .navigationTitle("Review Report")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
#endif
