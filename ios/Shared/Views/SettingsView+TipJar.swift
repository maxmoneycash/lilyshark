//
//  SettingsView+TipJar.swift
//  PommeCore
//
//  Device settings, radio config, privacy, iCloud, storage, and diagnostics.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import StoreKit
import LocalAuthentication
import CloudKit
import MeshCoreKit
#if !os(watchOS)
import CoreLocation
#endif

// MARK: - Tip Jar

@MainActor
class TipJarManager: ObservableObject {
    @Published var products: [Product] = []
    @Published var purchasedProductID: String?
    @Published var isLoading = false
    @Published var purchasingProductID: String?
    @Published var lastErrorMessage: String? = nil
    @Published var showSupporterNamePrompt = false

    var purchaseSuccess: Bool { purchasedProductID != nil }

    var thankYouEmoji: String {
        guard let id = purchasedProductID else { return "" }
        if id.hasSuffix(".decent") { return "\u{1F44B}" }
        if id.hasSuffix(".nice") { return "\u{1F60A}" }
        if id.hasSuffix(".great") { return "\u{1F389}" }
        if id.hasSuffix(".help") { return "\u{1F49A}" }
        return "\u{2764}\u{FE0F}"
    }

    var thankYouTitle: String {
        guard let id = purchasedProductID else { return "Thank You!" }
        if id.hasSuffix(".decent") { return "Thanks!" }
        if id.hasSuffix(".nice") { return "You're Awesome!" }
        if id.hasSuffix(".great") { return "Amazing, Thank You!" }
        if id.hasSuffix(".help") { return "You're a Legend!" }
        return "Thank You!"
    }

    var thankYouMessage: String {
        guard let id = purchasedProductID else { return "Your support means a lot." }
        if id.hasSuffix(".decent") { return "Every bit helps keep PommeCore free for everyone." }
        if id.hasSuffix(".nice") { return "Your generosity helps fund new features and improvements." }
        if id.hasSuffix(".great") { return "Seriously, thank you. People like you make PommeCore possible." }
        if id.hasSuffix(".help") { return "You're helping build the future of off-grid communication. Check the Supporters Wall!" }
        return "Your support means a lot."
    }

    struct PlaceholderTip: Identifiable {
        let id: String
        let emoji: String
        let name: String
        let description: String
        let price: String
    }

    static let placeholders: [PlaceholderTip] = [
        PlaceholderTip(id: "decent", emoji: "\u{1F44B}", name: "Decent Try!", description: "Thanks for giving PommeCore a shot", price: "$0.99"),
        PlaceholderTip(id: "nice", emoji: "\u{1F44D}", name: "Nice App!", description: "You're enjoying the mesh life", price: "$2.99"),
        PlaceholderTip(id: "great", emoji: "\u{1F389}", name: "Great Job!", description: "PommeCore has become your go-to client", price: "$4.99"),
        PlaceholderTip(id: "help", emoji: "\u{1F49A}", name: "I Want to Help!", description: "You believe in off-grid communication", price: "$9.99"),
    ]

    nonisolated static let productIDs = [
        "com.mbedworth.meshcore.tip.decent",
        "com.mbedworth.meshcore.tip.nice",
        "com.mbedworth.meshcore.tip.great",
        "com.mbedworth.meshcore.tip.help"
    ]

    func loadProductsIfNeeded() {
        guard !isLoading && products.isEmpty else { return }
        isLoading = true
        lastErrorMessage = nil

        let ids = Set(Self.productIDs)
        DebugLogger.shared.log("TIP JAR: requesting \(ids.count) products: \(ids.sorted().joined(separator: ", "))", level: .info)

        Task {
            let (result, fetchError) = await Self.fetchProducts(ids: ids)
            self.products = result
            self.lastErrorMessage = fetchError
            self.isLoading = false
        }
    }

    private static func fetchProducts(ids: Set<String>) async -> (products: [Product], error: String?) {
        do {
            let fetched = try await Product.products(for: ids)
            let sorted = fetched.sorted { $0.price < $1.price }
            for p in sorted {
                DebugLogger.shared.log("TIP JAR: product \(p.id) — \(p.displayPrice)", level: .info)
            }
            DebugLogger.shared.log("TIP JAR: loaded \(sorted.count) products", level: .info)
            if sorted.isEmpty {
                DebugLogger.shared.log("TIP JAR: no products returned — retrying in 5s", level: .warning)
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                let retry = try await Product.products(for: ids)
                let retrySorted = retry.sorted { $0.price < $1.price }
                DebugLogger.shared.log("TIP JAR: retry returned \(retrySorted.count) products", level: .info)
                if retrySorted.isEmpty {
                    let msg = "No products returned after retry — check App Store Connect IAP status and sandbox account"
                    DebugLogger.shared.log("TIP JAR: \(msg)", level: .error)
                    return ([], msg)
                }
                return (retrySorted, nil)
            }
            return (sorted, nil)
        } catch {
            // Log the full error type, not just localizedDescription, to distinguish
            // StoreKitError.notAvailable / .systemError / network errors etc.
            let msg = "StoreKit error: \(error) [\(type(of: error))]"
            DebugLogger.shared.log("TIP JAR: ERROR — \(msg)", level: .error)
            return ([], msg)
        }
    }

    func purchase(_ product: Product) async {
        DebugLogger.shared.log("TIP JAR: purchase START for \(product.id)", level: .info)
        purchasingProductID = product.id

        do {
            DebugLogger.shared.log("TIP JAR: calling product.purchase()", level: .info)
            let result = try await product.purchase()
            DebugLogger.shared.log("TIP JAR: purchase returned for \(product.id)", level: .info)

            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    DebugLogger.shared.log("TIP JAR: verified transaction \(transaction.id)", level: .info)
                    await transaction.finish()
                    self.purchasedProductID = product.id
                    if product.id.hasSuffix(".help") {
                        self.showSupporterNamePrompt = true
                        #if os(iOS)
                        WatchUnlockManager.shared.markSupporterUnlocked()
                        #endif
                    }
                case .unverified(let transaction, let error):
                    DebugLogger.shared.log("TIP JAR: unverified — \(error.localizedDescription)", level: .warning)
                    await transaction.finish()
                }
            case .pending:
                DebugLogger.shared.log("TIP JAR: pending (Ask to Buy?)", level: .warning)
            case .userCancelled:
                DebugLogger.shared.log("TIP JAR: user cancelled", level: .info)
            @unknown default:
                DebugLogger.shared.log("TIP JAR: unknown result", level: .warning)
            }
        } catch {
            DebugLogger.shared.log("TIP JAR: ERROR — \(error.localizedDescription)", level: .error)
        }

        self.purchasingProductID = nil
    }
}

// MARK: - Supporters Wall (CloudKit)

@MainActor
class SupportersManager: ObservableObject {
    @Published var supporters: [Supporter] = []
    @Published var isLoading = false

    struct Supporter: Identifiable {
        let id: String
        let displayName: String
        let date: Date
    }

    private let container = CKContainer(identifier: "iCloud.com.mbedworth.meshcore")

    @MainActor
    func fetchSupporters() async {
        isLoading = true
        objectWillChange.send()
        DebugLogger.shared.log("SUPPORTERS: fetching from CloudKit public DB...", level: .info)

        let db = container.publicCloudDatabase
        let query = CKQuery(recordType: "Supporter", predicate: NSPredicate(value: true))
        query.sortDescriptors = [NSSortDescriptor(key: "date", ascending: false)]

        do {
            let (results, cursor) = try await db.records(matching: query)
            DebugLogger.shared.log("SUPPORTERS: query returned \(results.count) results, cursor=\(cursor != nil)", level: .info)
            let fetched: [Supporter] = results.compactMap { (id, result) -> Supporter? in
                switch result {
                case .success(let record):
                    let name = record["displayName"] as? String ?? "(no name)"
                    let date = record["date"] as? Date ?? record.creationDate ?? Date()
                    DebugLogger.shared.log("SUPPORTERS: record \(id.recordName) — \(name)", level: .info)
                    return Supporter(id: id.recordName, displayName: name, date: date)
                case .failure(let error):
                    DebugLogger.shared.log("SUPPORTERS: record \(id.recordName) error — \(error)", level: .error)
                    return nil
                }
            }
            .sorted { $0.date > $1.date }
            DebugLogger.shared.log("SUPPORTERS: updating UI with \(fetched.count) supporters", level: .info)
            self.supporters = fetched
            self.isLoading = false
        } catch {
            DebugLogger.shared.log("SUPPORTERS: fetch error — \(error)", level: .error)
            self.isLoading = false
        }
    }

    func addSupporter(name: String) async -> Bool {
        DebugLogger.shared.log("SUPPORTERS: saving name '\(name)' to CloudKit...", level: .info)

        // Check account status first
        do {
            let status = try await container.accountStatus()
            DebugLogger.shared.log("SUPPORTERS: iCloud account status = \(status.rawValue) (1=available)", level: .info)
            guard status == .available else {
                DebugLogger.shared.log("SUPPORTERS: iCloud not available (status \(status.rawValue)) — cannot save", level: .error)
                return false
            }
        } catch {
            DebugLogger.shared.log("SUPPORTERS: account status check failed — \(error)", level: .error)
            return false
        }

        let db = container.publicCloudDatabase
        let record = CKRecord(recordType: "Supporter")
        record["displayName"] = name as CKRecordValue
        record["date"] = Date() as CKRecordValue

        do {
            let saved = try await db.save(record)
            DebugLogger.shared.log("SUPPORTERS: saved record \(saved.recordID.recordName) for '\(name)'", level: .info)
            await fetchSupporters()
            return true
        } catch {
            DebugLogger.shared.log("SUPPORTERS: save error — \(error)", level: .error)
            return false
        }
    }
}

extension SettingsView {
    var storageSection: some View {
        Section {
            Picker(selection: $maxMessagesPerContact) {
                Text("50").tag(50)
                Text("100").tag(100)
                Text("200").tag(200)
                Text("500").tag(500)
                Text("1,000").tag(1000)
            } label: {
                Label("Messages Per Contact", systemImage: "number")
                    .foregroundStyle(MeshTheme.accent)
            }
            .tint(.primary)
            .listRowBackground(MeshTheme.surface)

            Button {
                showPurgeOptions = true
            } label: {
                HStack {
                    Label("Manage Storage", systemImage: "externaldrive")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    let msgCount = messageStoreManager.messagesByContact.values.reduce(0) { $0 + $1.count }
                    #if !os(watchOS)
                    let telCount = rfMonitorStore.totalSnapshotCount
                    let covCount = rfMonitorStore.coveragePoints.count
                    let msgStatus: Color = msgCount > 20_000 ? .red : msgCount > 5_000 ? .orange : .green
                    let telStatus: Color = telCount > 2_000 ? .red : telCount > 500 ? .orange : .green
                    let worstStatus: Color = msgStatus == .red || telStatus == .red ? .red : msgStatus == .orange || telStatus == .orange ? .orange : .green
                    Text("\(msgCount) msg, \(telCount) telemetry, \(covCount) coverage")
                        .font(.caption)
                        .foregroundStyle(worstStatus)
                    #else
                    Text("\(msgCount) messages")
                        .font(.caption)
                        .foregroundStyle(msgCount > 20_000 ? .red : msgCount > 5_000 ? .orange : .green)
                    #endif
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            .confirmationDialog("Manage Storage", isPresented: $showPurgeOptions) {
                Button("Clear All Messages", role: .destructive) {
                    messageStoreManager.clearAllMessages()
                }
                Button("Clear Message Drafts") {
                    messageStoreManager.clearAllDrafts()
                }
                #if !os(watchOS)
                Button("Clear Telemetry History", role: .destructive) {
                    rfMonitorStore.clearTelemetryHistory()
                }
                Button("Clear Coverage Map", role: .destructive) {
                    rfMonitorStore.clearCoveragePoints()
                }
                #endif
                Button("Cancel", role: .cancel) {}
            }
        } header: {
            sectionInfoHeader("Storage", info: "Maximum messages stored on this device per contact. Oldest are pruned automatically. iCloud syncs the last 50 per contact separately.")
        }
    }

    var tipJarSection: some View {
        Section {
            #if os(macOS) || targetEnvironment(macCatalyst)
            // macOS/Catalyst: sheet instead of NavigationLink — dismiss() inside a NavigationLink
            // destination in a bare NavigationSplitView detail exits Settings entirely.
            Button {
                showTipJarSheet = true
            } label: {
                HStack {
                    Label("Tip Jar", systemImage: "heart.fill")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    if tipJar.purchaseSuccess {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(MeshTheme.connected)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            // Sheet is intentionally NOT attached here — see settingsForm for the macOS/Catalyst
            // .sheet(isPresented: $showTipJarSheet) anchor. Attaching .sheet to a List row
            // causes Catalyst to corrupt navigation state when the sheet closes (same class of
            // bug as the iOS Device Info sheet — fixed by lifting to the List level).
            #else
            // iOS: sheet instead of NavigationLink — NavigationLink push in a NavigationSplitView
            // detail column corrupts sidebar selection state on pop (same bug class as macOS).
            Button {
                showTipJarSheet = true
            } label: {
                HStack {
                    Label("Tip Jar", systemImage: "heart.fill")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    if tipJar.purchaseSuccess {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(MeshTheme.connected)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            #endif

            Button {
                showSupportersSheet = true
            } label: {
                HStack {
                    Label("Supporters Wall", systemImage: "star.fill")
                        .foregroundStyle(.yellow)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
        } header: {
            sectionInfoHeader("Support the App", info: "PommeCore is free with all features. Tips help fund development. \u{1F49A} tippers join the Supporters Wall!")
        }
    }

}

/// MARK: - Tip Jar Standalone View (outside List hierarchy)

struct TipJarView: View {
    @ObservedObject var manager: TipJarManager
    @Environment(\.dismiss) private var dismiss
    @State private var showSupportersSheet = false

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(MeshTheme.accent)
                    .padding(.top, 20)

                Text("Support PommeCore Development")
                    .font(.title2.bold())
                    .foregroundStyle(MeshTheme.textPrimary)

                Text("PommeCore is free with all features unlocked. If you find it useful, consider leaving a tip to support continued development.")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                if manager.products.isEmpty && manager.isLoading {
                    ProgressView("Loading products...")
                        .padding()
                } else if manager.products.isEmpty {
                    VStack(spacing: 12) {
                        Text("Products unavailable")
                            .foregroundStyle(MeshTheme.textSecondary)
                        if let errorMessage = manager.lastErrorMessage {
                            Text(errorMessage)
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        Button("Try Again") {
                            manager.loadProductsIfNeeded()
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding()
                } else {
                    ForEach(manager.products) { product in
                        TipButton(product: product, manager: manager)
                    }
                }

                if manager.purchaseSuccess {
                    VStack(spacing: 12) {
                        Text(manager.thankYouEmoji)
                            .font(.system(size: 48))
                        Text(manager.thankYouTitle)
                            .font(.title2.bold())
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text(manager.thankYouMessage)
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .transition(.scale.combined(with: .opacity))
                    .id("thankYou")
                }

                Divider()
                    .padding(.vertical, 8)

                Button {
                    showSupportersSheet = true
                } label: {
                    HStack {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                        Text("View Supporters Wall")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)

                Text("\u{1F49A} I Want to Help! tippers can add their name to the Supporters Wall.")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding()
            .onChange(of: manager.purchasedProductID) { _, newValue in
                if newValue != nil {
                    withAnimation {
                        proxy.scrollTo("thankYou", anchor: .bottom)
                    }
                }
            }
        }
        } // ScrollViewReader
        .background(MeshTheme.background)
        .navigationTitle("Tip Jar")
        .sheet(isPresented: $showSupportersSheet) {
            NavigationStack {
                SupportersView()
            }
            .meshTheme()
        }
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #elseif os(macOS)
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") {
                    // Deferred dismiss prevents navigation state corruption when the sheet
                    // closes and the presenting List row re-renders (Catalyst and iOS).
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #endif
        }
        #if !os(macOS) && !targetEnvironment(macCatalyst)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            DebugLogger.shared.log("TIP JAR VIEW: appeared, products=\(manager.products.count)", level: .info)
            manager.loadProductsIfNeeded()
        }
        .onDisappear {
            // Cancel any pending purchase to prevent UI freeze from stuck StoreKit overlay
            manager.purchasingProductID = nil
            DebugLogger.shared.log("TIP JAR VIEW: disappeared, cleaned up", level: .info)
        }
        .onChange(of: manager.purchasedProductID) { _, newValue in
            if newValue != nil {
                // Auto-dismiss after enough time to read the thank-you message
                DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
                    dismiss()
                }
            }
        }
    }
}

struct TipButton: View {
    let product: Product
    @ObservedObject var manager: TipJarManager

    private var emoji: String {
        if product.id.hasSuffix(".decent") { return "\u{1F44B}" }
        if product.id.hasSuffix(".nice") { return "\u{1F44D}" }
        if product.id.hasSuffix(".great") { return "\u{1F389}" }
        if product.id.hasSuffix(".help") { return "\u{1F49A}" }
        return "\u{2764}\u{FE0F}"
    }

    var body: some View {
        Button {
            DebugLogger.shared.log("TIP JAR: BUTTON TAPPED \(product.id)", level: .info)
            Task {
                await manager.purchase(product)
            }
        } label: {
            HStack {
                Text(emoji)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.displayName)
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                    Text(product.description)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                Spacer()
                if manager.purchasingProductID == product.id {
                    ProgressView()
                        .frame(width: 60)
                } else {
                    Text(product.displayPrice)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(MeshTheme.interactiveGreen)
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding()
            .background(MeshTheme.surfaceLight)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(manager.purchasingProductID != nil)
    }
}

// MARK: - Supporters Wall View

struct SupportersView: View {
    @StateObject private var manager = SupportersManager()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if manager.isLoading && manager.supporters.isEmpty {
                    ProgressView()
                        .padding(.top, 40)
                    Text("Loading supporters...")
                        .foregroundStyle(MeshTheme.textSecondary)
                } else if manager.supporters.isEmpty {
                    Image(systemName: "heart.circle")
                        .font(.system(size: 48))
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.top, 20)
                    Text("No supporters yet")
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                    Text("Be the first! Leave a \u{1F49A} I Want to Help! tip to join the wall.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                } else {
                    Text("These generous people help keep PommeCore free for everyone.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    ForEach(manager.supporters) { supporter in
                        HStack {
                            Image(systemName: "star.fill")
                                .foregroundStyle(.yellow)
                            Text(supporter.displayName)
                                .font(.body)
                                .foregroundStyle(MeshTheme.textPrimary)
                            Spacer()
                            Text(supporter.date, style: .date)
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .padding()
                        .background(MeshTheme.surfaceLight)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding()
        }
        .background(MeshTheme.background)
        .navigationTitle("Supporters Wall")
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #elseif os(macOS)
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") {
                    DispatchQueue.main.async { dismiss() }
                }
            }
            #endif
        }
        #if !os(macOS) && !targetEnvironment(macCatalyst)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            Task {
                await manager.fetchSupporters()
            }
        }
    }
}

