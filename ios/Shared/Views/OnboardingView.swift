//
//  OnboardingView.swift
//  PommeCore
//
//  First-launch onboarding flow with connection guide and region selection.
//
//  Created by Michael P. Bedworth on 3/16/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI

struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    /// Optional closure called when the user taps "Open Settings" on the Configure page.
    var navigateToSettings: (() -> Void)? = nil
    @State private var currentPage = 0
    private let lastPage = 5

    var body: some View {
        ZStack(alignment: .top) {
            TabView(selection: $currentPage) {
                welcomePage.tag(0)
                connectPage.tag(1)
                communicatePage.tag(2)
                regionPage.tag(3)
                configurePage.tag(4)
                getStartedPage.tag(5)
            }
            #if os(watchOS)
            .tabViewStyle(.carousel)
            #elseif os(iOS)
            .tabViewStyle(.page(indexDisplayMode: .never))
            #endif
            .background(MeshTheme.background)
            .animation(.easeInOut, value: currentPage)

            // Skip button (top-right, all pages except last)
            if currentPage < lastPage {
                HStack {
                    Spacer()
                    Button {
                        withAnimation { hasCompletedOnboarding = true }
                    } label: {
                        Text("Skip")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 8)
                .padding(.trailing, 8)
            }
        }
    }

    // MARK: - Pages

    private var welcomePage: some View {
        VStack(spacing: 24) {
            Spacer()
            ZStack {
                MeshAnimationBackdrop()
                    .frame(height: 210)
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 72))
                    .foregroundStyle(MeshTheme.accent)
            }
            Text("Welcome to Lilyshark")
                .font(.largeTitle.bold())
                .foregroundStyle(MeshTheme.textPrimary)
            Text("Off-Grid Mesh Messaging")
                .font(.title3)
                .foregroundStyle(MeshTheme.accent)
            Text("Send messages, share channels, and connect with others using LoRa radio \u{2014} no internet or cell service needed.")
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
            navigationControls
        }
        .padding()
    }

    private var connectPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "cable.connector")
                .font(.system(size: 60))
                .foregroundStyle(MeshTheme.accent)
            Text("Connect Your Radio")
                .font(.title2.bold())
                .foregroundStyle(MeshTheme.textPrimary)

            VStack(alignment: .leading, spacing: 10) {
                stepRow(number: "1", text: "Power on your MeshCore radio and make sure Bluetooth is enabled on your device.")
                stepRow(number: "2", text: "Lilyshark will scan for nearby radios automatically.")
                stepRow(number: "3", text: "Tap your radio\u{2019}s name when it appears.")
                stepRow(number: "4", text: "Enter the BLE PIN shown on your radio\u{2019}s screen (if required).")
                stepRow(number: "5", text: "Once connected, your contacts and channels will sync automatically.")
            }
            .padding(.horizontal, 24)

            Text("TIP: Name your radio with your initials + first 4 of your public key (e.g., NMA-5abd). You can change this in Settings after connecting.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Spacer()
            navigationControls
        }
        .padding()
    }

    private var communicatePage: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 60))
                .foregroundStyle(MeshTheme.accent)
            Text("Communicate Off-Grid")
                .font(.title2.bold())
                .foregroundStyle(MeshTheme.textPrimary)
            Text("Send direct messages, join channels, and connect with others across the mesh network without internet or cell service.")
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            HStack(spacing: 32) {
                VStack {
                    Image(systemName: "person.2")
                        .font(.title2)
                        .foregroundStyle(MeshTheme.accent)
                    Text("Direct")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                VStack {
                    Image(systemName: "number")
                        .font(.title2)
                        .foregroundStyle(MeshTheme.accent)
                    Text("Channels")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                VStack {
                    Image(systemName: "server.rack")
                        .font(.title2)
                        .foregroundStyle(MeshTheme.accent)
                    Text("Rooms")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            Spacer()
            navigationControls
        }
        .padding()
    }

    private var regionPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "globe.americas")
                .font(.system(size: 60))
                .foregroundStyle(MeshTheme.accent)
            Text("Set Your Region")
                .font(.title2.bold())
                .foregroundStyle(MeshTheme.textPrimary)

            Text("Your radio must use the correct frequency for your country. Using the wrong frequency may violate local regulations.")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            VStack(spacing: 6) {
                frequencyRow(region: "\u{1F1FA}\u{1F1F8} Americas (US, CA, AU, NZ)", freq: "915 MHz")
                frequencyRow(region: "\u{1F1EA}\u{1F1FA} Europe (EU, UK)", freq: "868 MHz")
                frequencyRow(region: "\u{1F1EF}\u{1F1F5} Japan", freq: "920 MHz")
                frequencyRow(region: "\u{1F1EE}\u{1F1F3} India", freq: "865 MHz")
            }
            .padding(.horizontal, 24)

            Text("Your radio\u{2019}s frequency is set during flashing. If you need to change it, go to Settings \u{2192} Radio after connecting. All radios on your mesh must use the same frequency, bandwidth, spreading factor, and coding rate.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Link("View MeshCore Frequency Guide", destination: URL(string: "https://meshcore.co.uk")!)
                .font(.caption)
                .foregroundStyle(MeshTheme.accent)

            Spacer()
            navigationControls
        }
        .padding()
    }

    private var configurePage: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "gearshape.2")
                .font(.system(size: 72))
                .foregroundStyle(MeshTheme.accent)
            Text("Configure Your Device")
                .font(.title2.bold())
                .foregroundStyle(MeshTheme.textPrimary)
            Text("Once connected, tap the gear icon at the top of the sidebar — or tap the connection bar — to open Settings. From there you can set your radio frequency, display name, privacy options, and more.")
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            #if !os(watchOS)
            if navigateToSettings != nil {
                Button {
                    withAnimation { hasCompletedOnboarding = true }
                    navigateToSettings?()
                } label: {
                    Text("Open Settings Now")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(MeshTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 40)
            }
            #endif
            Spacer()
            navigationControls
        }
        .padding()
    }

    private var getStartedPage: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "checkmark.circle")
                .font(.system(size: 72))
                .foregroundStyle(MeshTheme.accent)
            Text("Get Started")
                .font(.title.bold())
                .foregroundStyle(MeshTheme.textPrimary)
            Text("Turn on your MeshCore radio and tap Connect to begin.")
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
            Button {
                withAnimation { hasCompletedOnboarding = true }
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(MeshTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)

            navigationControls
        }
        .padding()
    }

    // MARK: - Helpers

    private func stepRow(number: String, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(number + ".")
                .fontWeight(.bold)
                .frame(width: 20, alignment: .trailing)
                .foregroundStyle(MeshTheme.accent)
            Text(text)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .font(.subheadline)
    }

    private func frequencyRow(region: LocalizedStringKey, freq: String) -> some View {
        HStack {
            Text(region)
                .foregroundStyle(MeshTheme.textSecondary)
            Spacer()
            Text(freq)
                .fontWeight(.medium)
                .foregroundStyle(MeshTheme.textPrimary)
        }
        .font(.subheadline)
        .padding(.vertical, 4)
    }

    // MARK: - Navigation Controls

    private var navigationControls: some View {
        HStack(spacing: 20) {
            // Back arrow
            Button {
                withAnimation { currentPage = max(0, currentPage - 1) }
            } label: {
                Image(systemName: "chevron.left.circle.fill")
                    .font(.title2)
                    .foregroundStyle(currentPage > 0 ? MeshTheme.accent : MeshTheme.textSecondary.opacity(0.3))
            }
            .buttonStyle(.plain)
            .disabled(currentPage == 0)

            // Page dots
            HStack(spacing: 8) {
                ForEach(0...lastPage, id: \.self) { page in
                    Circle()
                        .fill(page == currentPage ? MeshTheme.accent : MeshTheme.textSecondary.opacity(0.3))
                        .frame(width: 8, height: 8)
                }
            }

            // Forward arrow
            Button {
                if currentPage < lastPage {
                    withAnimation { currentPage += 1 }
                } else {
                    withAnimation { hasCompletedOnboarding = true }
                }
            } label: {
                Image(systemName: "chevron.right.circle.fill")
                    .font(.title2)
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 20)
    }
}

// MARK: - Mesh Animation

/// A quiet particle mesh behind the welcome page: nodes drift on slow
/// elliptical orbits and link up whenever they come within range, the same
/// way the radios do. Deterministic seeds keep the scene calm and identical
/// on every launch; Reduce Motion freezes it to a still constellation.
struct MeshAnimationBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Node {
        let cx: CGFloat, cy: CGFloat   // orbit center, unit space
        let rx: CGFloat, ry: CGFloat   // orbit radii
        let speed: Double, phase: Double
    }

    private struct SeededGenerator: RandomNumberGenerator {
        var state: UInt64
        init(seed: UInt64) { state = seed }
        mutating func next() -> UInt64 {
            state ^= state << 13
            state ^= state >> 7
            state ^= state << 17
            return state
        }
    }

    private static let nodes: [Node] = {
        var generator = SeededGenerator(seed: 0x5EED)
        return (0..<14).map { _ in
            Node(
                cx: CGFloat.random(in: 0.08...0.92, using: &generator),
                cy: CGFloat.random(in: 0.10...0.90, using: &generator),
                rx: CGFloat.random(in: 0.02...0.07, using: &generator),
                ry: CGFloat.random(in: 0.02...0.07, using: &generator),
                speed: Double.random(in: 0.15...0.45, using: &generator),
                phase: Double.random(in: 0...(2 * .pi), using: &generator)
            )
        }
    }()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            Canvas { ctx, size in
                let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
                let points: [CGPoint] = Self.nodes.map { node in
                    CGPoint(
                        x: (node.cx + node.rx * CGFloat(cos(t * node.speed + node.phase))) * size.width,
                        y: (node.cy + node.ry * CGFloat(sin(t * node.speed * 0.8 + node.phase))) * size.height
                    )
                }
                let linkRange = min(size.width, size.height) * 0.42
                for i in points.indices {
                    for j in points.indices where j > i {
                        let dx = points[i].x - points[j].x
                        let dy = points[i].y - points[j].y
                        let dist = (dx * dx + dy * dy).squareRoot()
                        guard dist < linkRange else { continue }
                        var line = Path()
                        line.move(to: points[i])
                        line.addLine(to: points[j])
                        let fade = 1 - dist / linkRange
                        ctx.stroke(
                            line,
                            with: .color(MeshTheme.accent.opacity(0.10 + 0.25 * fade)),
                            lineWidth: 1
                        )
                    }
                }
                for p in points {
                    let dot = Path(ellipseIn: CGRect(x: p.x - 2.5, y: p.y - 2.5, width: 5, height: 5))
                    ctx.fill(dot, with: .color(MeshTheme.accent.opacity(0.8)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
