//
//  LoSResultsView.swift
//  PommeCore
//
//  Pass/fail badge, distance, clearance, and Fresnel zone summary.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct LoSResultsView: View {
    let result: LoSResult

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Pass/Fail header — three states: clear, Fresnel-partial, physically blocked
            HStack(spacing: 10) {
                Image(systemName: displayState.icon)
                    .font(.title2)
                    .foregroundStyle(displayState.color)
                VStack(alignment: .leading) {
                    Text(displayState.title)
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                    Text(summaryText)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }

            // Stats grid — show relay worst-case when relays are active
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 10) {
                statCard("Distance", value: GeoMath.formatDistance(result.profile.totalDistance), icon: "ruler")
                statCard("Frequency", value: String(format: "%.3f MHz", result.frequencyMHz), icon: "antenna.radiowaves.left.and.right")

                let (activeClearance, activeFresnel) = worstCaseStats
                statCard("Min Clearance", value: String(format: "%.1f m", activeClearance), icon: "arrow.up.and.down",
                         color: activeClearance >= 0 ? .green : .red)
                statCard("Fresnel Zone", value: String(format: "%.0f%%", activeFresnel), icon: "circle.dashed",
                         color: fresnelColor(activeFresnel))
            }

            // Note when relay is active but direct path is also blocked
            if !result.relaySegments.isEmpty && !result.directSegment.hasLineOfSight {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.circle")
                        .foregroundStyle(.red)
                        .font(.caption)
                    Text("Direct path blocked — relay required")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }

            // Endpoint elevations
            HStack(spacing: 16) {
                elevationLabel("Point A", elevation: result.profile.pointA.groundElevation, antenna: result.profile.pointA.antennaHeight)
                Spacer()
                elevationLabel("Point B", elevation: result.profile.pointB.groundElevation, antenna: result.profile.pointB.antennaHeight)
            }

            // Relay segment breakdown
            if !result.relaySegments.isEmpty {
                Divider()
                Text("Relay Analysis")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MeshTheme.accent)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(Array(zip(segmentLabels, result.relaySegments)), id: \.0) { label, seg in
                        segmentSummary(label, result: seg)
                    }
                }
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Display State

    private enum DisplayState {
        case clear
        case fresnelPartial   // physically clear but Fresnel < 60%
        case blocked          // terrain physically crosses the LoS line

        var title: String {
            switch self {
            case .clear:         return "Line of Sight Clear"
            case .fresnelPartial: return "Fresnel Zone Partially Obstructed"
            case .blocked:       return "Line of Sight Blocked"
            }
        }

        var icon: String {
            switch self {
            case .clear:         return "checkmark.circle.fill"
            case .fresnelPartial: return "exclamationmark.triangle.fill"
            case .blocked:       return "xmark.circle.fill"
            }
        }

        var color: Color {
            switch self {
            case .clear:         return .green
            case .fresnelPartial: return .orange
            case .blocked:       return .red
            }
        }
    }

    private var displayState: DisplayState {
        let (clearance, fresnel) = worstCaseStats
        if clearance < 0 { return .blocked }
        if fresnel < 60  { return .fresnelPartial }
        return .clear
    }

    // MARK: - Stats Helpers

    /// Worst-case clearance and Fresnel across the active segments (relay or direct).
    private var worstCaseStats: (clearance: Double, fresnel: Double) {
        if result.relaySegments.isEmpty {
            return (result.directSegment.minClearance, result.directSegment.fresnelClearancePercent)
        }
        let clearance = result.relaySegments.map(\.minClearance).min() ?? 0
        let fresnel   = result.relaySegments.map(\.fresnelClearancePercent).min() ?? 0
        return (clearance, fresnel)
    }

    private var summaryText: String {
        if !result.relaySegments.isEmpty {
            if result.overallPass {
                return "All relay segments clear — adequate Fresnel clearance"
            }
            let failedLabels = zip(segmentLabels, result.relaySegments)
                .filter { !$0.1.hasLineOfSight || $0.1.fresnelClearancePercent < 60 }
                .map(\.0)
            if failedLabels.count == 1 { return "\(failedLabels[0]) segment is obstructed" }
            return "\(failedLabels.count) relay segments are obstructed"
        }
        let direct = result.directSegment
        if direct.fresnelClearancePercent >= 60 {
            return "Full Fresnel zone clearance (\(String(format: "%.0f%%", direct.fresnelClearancePercent)))"
        } else if direct.hasLineOfSight {
            return "Partial Fresnel clearance — signal may be degraded"
        } else {
            return "Terrain blocks the direct path at \(GeoMath.formatDistance(direct.minClearanceDistance))"
        }
    }

    /// Labels for each relay segment: A→R, R→B (single), A→R1, R1→R2, R2→B (multi).
    private var segmentLabels: [String] {
        let n = result.relaySegments.count
        guard n > 0 else { return [] }
        if n == 2 { return ["A \u{2192} R", "R \u{2192} B"] }
        return (0..<n).map { i in
            let from = i == 0     ? "A"      : "R\(i)"
            let to   = i == n - 1 ? "B"      : "R\(i + 1)"
            return "\(from) \u{2192} \(to)"
        }
    }

    // MARK: - Sub-views

    private func statCard(_ label: LocalizedStringKey, value: String, icon: String, color: Color = MeshTheme.accent) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text(value)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
    }

    private func elevationLabel(_ label: LocalizedStringKey, elevation: Double, antenna: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
            Text("\(GeoMath.formatElevation(elevation)) + \(String(format: "%.0fm", antenna)) antenna")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    private func segmentSummary(_ label: String, result: LoSSegmentResult) -> some View {
        let segPass = result.hasLineOfSight && result.fresnelClearancePercent >= 60
        let segPartial = result.hasLineOfSight && result.fresnelClearancePercent < 60
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: segPass ? "checkmark.circle.fill" : segPartial ? "exclamationmark.triangle.fill" : "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(segPass ? Color.green : segPartial ? Color.orange : Color.red)
                Text(verbatim: label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(MeshTheme.accent)
            }
            Text("Clearance: \(String(format: "%.1fm", result.minClearance))")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
            Text("Fresnel: \(String(format: "%.0f%%", result.fresnelClearancePercent))")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .padding(8)
        .background(MeshTheme.surfaceLight.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func fresnelColor(_ percent: Double) -> Color {
        if percent >= 60 { return .green }
        if percent >= 0  { return .orange }
        return .red
    }
}
