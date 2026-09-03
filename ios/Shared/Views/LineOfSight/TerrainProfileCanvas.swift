//
//  TerrainProfileCanvas.swift
//  PommeCore
//
//  SwiftUI Canvas wrapper for terrain profile visualization.
//  Delegates drawing to TerrainProfileRenderer. Supports drag-to-scrub.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct TerrainProfileCanvas: View {
    let result: LoSResult
    @State private var scrubPosition: CGFloat?
    @GestureState private var isDragging = false

    var body: some View {
        Canvas { context, size in
            TerrainProfileRenderer.draw(
                result: result,
                in: size,
                context: &context,
                scrubX: scrubPosition
            )
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .updating($isDragging) { _, state, _ in state = true }
                .onChanged { value in scrubPosition = value.location.x }
                .onEnded { _ in scrubPosition = nil }
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.primary.opacity(0.1), lineWidth: 0.5)
        )
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
