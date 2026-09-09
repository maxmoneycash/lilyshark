#if !os(watchOS)
import SwiftUI
import MeshCoreKit

/// One app-owned map workspace; external services supply data only.
struct MeshMapView: View {
    @Environment(ConnectionManager.self) private var connection
    @State private var coverage = CommunityCoverageStore()
    @State private var showLocalMesh = false
    @State private var openedLocalMesh = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showSources = false
    @State private var showRadio = false
    @AppStorage("coverageMapArea") private var area = "oak"

    var body: some View {
        ZStack {
            NativeCoverageView(store: coverage, area: area, openSources: { showSources = true })
                .opacity(showLocalMesh ? 0 : 1)
                .allowsHitTesting(!showLocalMesh)
                .accessibilityHidden(showLocalMesh)
            if openedLocalMesh {
                RadioMapView(topControlsInset: Design.minimumTouchTarget + Design.Space.regular)
                    .opacity(showLocalMesh ? 1 : 0)
                    .allowsHitTesting(showLocalMesh)
                    .accessibilityHidden(!showLocalMesh)
            }
        }
        .overlay(alignment: .top) { floatingMapControls }
        .onChange(of: showLocalMesh) { if showLocalMesh { openedLocalMesh = true } }
        .navigationTitle("Map")
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .sheet(isPresented: $showSources) {
            NavigationStack {
                CoverageSourcesView(store: coverage, area: $area)
                    .lilysharkSheet { showSources = false }
            }.meshTheme()
        }
        .sheet(isPresented: $showRadio) {
            NavigationStack { RadioVisibilityView().lilysharkSheet { showRadio = false } }.meshTheme()
        }
    }

    private var floatingMapControls: some View {
        HStack(spacing: Design.Space.tight) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    Picker("Map source", selection: $showLocalMesh) {
                        Text("Coverage").tag(false)
                        Text("My mesh").tag(true)
                    }.pickerStyle(.menu)
                } else {
                    Picker("Map source", selection: $showLocalMesh) {
                        Text("Coverage").tag(false)
                        Text("My mesh").tag(true)
                    }.pickerStyle(.segmented)
                }
            }
            .frame(maxWidth: 260, minHeight: Design.minimumTouchTarget)
            .padding(.horizontal, Design.Space.hairline)
            .background(.regularMaterial, in: Capsule())
            .accessibilityIdentifier("map-source-picker")
            Spacer(minLength: 0)
            Button { showRadio = true } label: {
                Image(systemName: connection.isActivelyConnected ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                    .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                    .background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("My radio")
            .accessibilityIdentifier("map-my-radio")
            Button { showSources = true } label: {
                Image(systemName: "externaldrive")
                    .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                    .background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("Map data")
            .accessibilityIdentifier("map-sources")
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(MeshTheme.textPrimary)
        .buttonStyle(.meshPlain)
        .padding(.horizontal, Design.Space.snug)
        .padding(.top, Design.Space.tight)
    }
}

private struct CoverageSourcesView: View {
    @Bindable var store: CommunityCoverageStore
    @Binding var area: String
    @State private var key = ""
    @State private var saved = false
    var body: some View {
        Form {
            Section("Map area") {
                Picker("Open on", selection: $area) {
                    Text("Oakland").tag("oak")
                    Text("San Francisco Bay Area").tag("baus")
                    Text("San Francisco").tag("sfo")
                }
                Text("Your coverage feed opens on its own region when data is loaded.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
            Section {
                Text("Community coverage uses the app’s shared regional data connection. Repeater records remain useful when measured coverage is unavailable.")
                    .font(.subheadline)
                if let error = store.errorMessage { Text(error).font(.caption).foregroundStyle(MeshTheme.textSecondary) }
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Button("Refresh map data", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
                        .disabled(store.isLoading || (store.nextRefresh.map { $0 > context.date } ?? false))
                }
            } header: { Text("Community coverage") }
            Section {
                SecureField("Coverage API key", text: $key)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("coverage-api-key")
                Button("Save data connection") {
                    saved = store.saveKey(key)
                    if saved { key = ""; Task { await store.refresh() } }
                }
                .disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isLoading)
                if store.hasKey {
                    Label(saved ? "Connection saved" : "Data connection configured", systemImage: "checkmark.shield")
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        Button("Refresh coverage") { Task { await store.refresh() } }
                            .disabled(store.isLoading || (store.nextRefresh.map { $0 > context.date } ?? false))
                        if let next = store.nextRefresh, next > context.date {
                            Text("Next refresh \(next, style: .relative) from now").font(.caption)
                        }
                    }
                    Button("Remove data connection", role: .destructive) { _ = store.saveKey("") }
                        .disabled(store.isLoading)
                }
                if let message = store.errorMessage { Text(message).foregroundStyle(.orange) }
            } header: { Text("Advanced · Personal data connection") }
            footer: {
                Text("A personal key overrides the shared connection. Credentials stay in Keychain. Saved observations remain available offline; map tiles need internet.")
            }
            if let report = store.report {
                Section("Data in this map") {
                    LabeledContent("Region", value: report.regionName)
                    LabeledContent("Coverage cells", value: "\(report.validCells.count)")
                    LabeledContent("Repeaters", value: "\(report.repeaters?.count ?? 0)")
                    LabeledContent("Snapshot", value: Date(timeIntervalSince1970: report.generatedAt).formatted())
                    Text("These are community observations. They do not confirm reception by your radio.")
                }
            }
        }
        .navigationTitle("Map data")
    }
}
#endif
