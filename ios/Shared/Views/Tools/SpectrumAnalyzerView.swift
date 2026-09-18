//
//  SpectrumAnalyzerView.swift
//  PommeCore
//
//  Spectrum waterfall and peak hold analyzer.
//

#if !os(watchOS)
import SwiftUI
#if os(macOS)
import MeshtasticKit
#endif

struct SpectrumAnalyzerView: View {
    @State private var history = SpectrumHistory()
    @State private var preview = false
    #if os(macOS)
    @StateObject private var link = LSKSerialLink()
    @State private var port = ""
    @State private var scanPhase = ScanPhase.idle
    @State private var scanError: String?
    @State private var acceptSweeps = false
    private enum ScanPhase { case idle, starting, scanning, stopping }
    #endif
    private var sweeps: [SpectrumSweep] { history.sweeps }
    private var peakDb: [Double] { history.peakDb }
    @State private var isRunning = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    
    // Bounds for demo
    private let f0Hz = 902_000_000.0
    private let f1Hz = 928_000_000.0
    private let bins = 120
    private let maxHistory = SpectrumHistory.limit
    
    var body: some View {
        ScrollView {
        VStack(spacing: Design.Space.tight) {
            #if os(macOS)
            usbControls
            #endif
            Label(preview ? "Simulated spectrum · no live radio readings" : "Radio spectrum", systemImage: preview ? "flask" : "waveform.path")
                .font(.callout).foregroundStyle(MeshTheme.textSecondary)
                .padding(.horizontal)
            Text("Power in dBm · peak hold until clear or band change")
                .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            if let latest = sweeps.last, let strongest = latest.db.enumerated().max(by: { $0.element < $1.element }) {
                let hz = latest.f0Hz + (Double(strongest.offset) + 0.5) * (latest.f1Hz - latest.f0Hz) / Double(latest.db.count)
                Text(String(format: "Strongest bin: %.1f dBm at %.3f MHz", strongest.element, hz / 1_000_000))
                    .font(.callout.monospacedDigit())
            }
            // Top graph: Peak hold and current slice
            if !sweeps.isEmpty {
                HStack(alignment: .top, spacing: Design.Space.tight) {
                    VStack {
                        Text("−30")
                        Spacer()
                        Text("−80")
                        Spacer()
                        Text("−130")
                    }.font(.caption.monospacedDigit())
                    Canvas { ctx, size in
                        drawPeakGraph(in: ctx, size: size, sweeps: sweeps, peakDb: peakDb)
                    }
                }
                .frame(height: 120)
                .accessibilityLabel("Spectrum trace. Pink shows the current sample; gray shows peak hold. Scale minus 130 to minus 30 dBm.")
                .background(MeshTheme.surface)
                .border(MeshTheme.textSecondary.opacity(0.25), width: 1)
                
                HStack {
                    Text("dBm")
                    Spacer()
                    Label("Current", systemImage: "minus").foregroundStyle(MeshTheme.accent)
                    Label("Peak hold", systemImage: "minus").foregroundStyle(MeshTheme.textSecondary)
                }.font(.caption).padding(.horizontal)
                HStack {
                    Text(frequencyLabel(sweeps.last?.f0Hz ?? f0Hz))
                    Spacer()
                    Text(frequencyLabel(sweeps.last?.f1Hz ?? f1Hz))
                }.font(.caption.monospacedDigit()).padding(.horizontal)
                Text(preview ? "Simulated sweeps · newest at top" : "Completed scans · newest at top")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                Text("Rows show successive sweeps; elapsed time between rows varies.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                // Waterfall
                Group {
                    Canvas { ctx, size in
                        drawWaterfall(in: ctx, size: size, sweeps: sweeps)
                    }
                }
                .frame(height: 240)
                .background(MeshTheme.background)
                .accessibilityLabel("Waterfall. Blue is weaker power; yellow and red are stronger. Oldest samples are at the bottom.")
            } else {
                ContentUnavailableView {
                    Label("RF Spectrum", systemImage: "waveform.path")
                } description: {
                    #if os(macOS)
                    Text("Connect a T-Deck over USB to scan its selected band, or explore a simulated spectrum.")
                    #else
                    Text("Explore a simulated band scan. Live analyzer sweeps need a T-Deck connected over USB to the Mac app. The current firmware’s Bluetooth service does not provide spectrum sweeps.")
                    #endif
                } actions: {
                    Button("Preview spectrum") {
                        startDemo()
                    }
                    .buttonStyle(.meshPrimary)
                }
            }
        }
        .padding(.bottom, Design.Space.regular)
        }
        .navigationTitle("Spectrum Analyzer")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if !sweeps.isEmpty {
                ToolbarItemGroup(placement: .primaryAction) {
                    if preview { Button(isRunning ? "Pause" : "Next sweep") {
                        if isRunning { isRunning = false } else { appendSweep() }
                    } }
                    Button("Clear") {
                        #if os(macOS)
                        stopScan()
                        #endif
                        history.clear()
                        isRunning = false
                    }
                }
            }
        }
        .task(id: isRunning) {
            guard isRunning else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(100)) }
                catch { return }
                guard isRunning else { return }
                appendSweep()
            }
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { isRunning = false }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                isRunning = false
                #if os(macOS)
                stopScan()
                #endif
            }
        }
        .onDisappear {
            isRunning = false
            #if os(macOS)
            stopScan()
            link.disconnect()
            #endif
        }
        #if os(macOS)
        .onReceive(link.lines) { receive($0) }
        .onReceive(link.malformedKinds) { kind in
            if kind == "S", scanPhase == .starting || scanPhase == .scanning {
                scanError = "An incomplete spectrum reading was discarded. Stopping this scan; try again once it stops."
                stopScan()
            }
        }
        .onChange(of: link.state) { _, state in
            if !state.isLinked {
                scanPhase = .idle
                acceptSweeps = false
            }
        }
        .task(id: scanPhase) {
            guard scanPhase != .idle else { return }
            do { try await Task.sleep(for: .seconds(scanPhase == .scanning ? 60 : 8)) }
            catch { return }
            scanError = "The deck did not finish the scan command. Check its screen and reconnect before trying again."
            acceptSweeps = false
            try? link.send(.sweepStop)
            link.disconnect()
            scanPhase = .idle
        }
        #endif
    }
    
    private func frequencyLabel(_ hz: Double) -> String {
        String(format: "%.3f MHz", hz / 1_000_000)
    }

    #if os(macOS)
    private var usbControls: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            switch link.state {
            case .linked(_, let identity):
                Text("USB · \(identity.board) · \(identity.firmwareVersion)").font(.headline)
                Text("Scan uses the band selected on the deck and temporarily pauses packet reception.")
                    .font(.caption)
                HStack {
                    Button(scanPhase == .idle ? "Scan band" : "Scanning…") { startScan() }
                        .buttonStyle(.meshPrimary)
                        .disabled(scanPhase != .idle)
                    Button("Stop") { stopScan() }.disabled(scanPhase == .idle || scanPhase == .stopping)
                    Button("Disconnect") { stopScan(); link.disconnect() }
                }
            case .connecting:
                HStack {
                    ProgressView("Connecting to USB radio…")
                    Button("Cancel") { link.disconnect() }
                }
            case .off, .failed:
                Picker("USB radio", selection: $port) {
                    Text("Select a port").tag("")
                    ForEach(link.availablePorts, id: \.path) { Text($0.name).tag($0.path) }
                }
                HStack {
                    Button("Refresh ports") { link.refreshPorts() }
                    Button("Connect USB") {
                        isRunning = false
                        preview = false
                        history.clear()
                        scanError = nil
                        link.connect(to: port)
                    }.disabled(port.isEmpty)
                }
                if case .failed(let reason) = link.state { Text(reason).font(.callout) }
            }
            if let scanError {
                Label(scanError, systemImage: "exclamationmark.triangle").font(.callout)
            }
        }
        .padding()
        .task { link.refreshPorts() }
    }

    private func startScan() {
        guard link.state.isLinked, scanPhase == .idle else { return }
        scanError = nil
        acceptSweeps = true
        scanPhase = .starting
        do { try link.send(.sweepStart) }
        catch { scanError = error.localizedDescription; scanPhase = .idle; acceptSweeps = false }
    }

    private func stopScan() {
        acceptSweeps = false
        guard link.state.isLinked, scanPhase == .starting || scanPhase == .scanning else { return }
        scanPhase = .stopping
        do { try link.send(.sweepStop) }
        catch { scanError = error.localizedDescription; scanPhase = .idle }
    }

    private func receive(_ line: LSKLine) {
        guard !preview, link.state.isLinked else { return }
        switch line {
        case .sweep(let reading):
            guard acceptSweeps else { return }
            history.append(SpectrumSweep(f0Hz: Double(reading.startHz), f1Hz: Double(reading.endHz),
                                         db: reading.powerDBm.map(Double.init), atMs: Date().timeIntervalSince1970 * 1000))
            scanPhase = .idle
            acceptSweeps = false
        case .ok(let ack) where ack.kind == "sweep":
            if ack.state == "started", scanPhase == .starting { scanPhase = .scanning }
            if ack.state == "stopped" { scanPhase = .idle; acceptSweeps = false }
        case .error(let fault) where scanPhase != .idle:
            scanError = fault.reason ?? "The deck refused the sweep command."
            scanPhase = .idle
            acceptSweeps = false
        default: break
        }
    }
    #endif

    private func startDemo() {
        #if os(macOS)
        stopScan()
        link.disconnect()
        #endif
        preview = true
        history.clear()
        
        appendSweep()
        isRunning = !reduceMotion
    }

    private func appendSweep() {
            let nowMs = Date().timeIntervalSince1970 * 1000
            var newDb = [Double]()
            
            // Generate some noise floor
            for i in 0..<bins {
                var v = -130.0 + Double.random(in: -5...5)
                
                // Add some "signals"
                if i > 20 && i < 25 {
                    v = -80.0 + Double.random(in: -10...10) // Meshtastic burst
                } else if i > 80 && i < 83 {
                    v = -60.0 + Double.random(in: -5...5)   // Strong carrier
                }
                newDb.append(v)
            }
            
            let sweep = SpectrumSweep(f0Hz: f0Hz, f1Hz: f1Hz, db: newDb, atMs: nowMs)
            history.append(sweep)
    }
    
    private func drawPeakGraph(in ctx: GraphicsContext, size: CGSize, sweeps: [SpectrumSweep], peakDb: [Double]) {
        guard let latest = sweeps.last else { return }
        let w = size.width / Double(latest.db.count)
        
        // Draw Peak
        var peakPath = Path()
        for (i, v) in peakDb.enumerated() {
            let x = (Double(i) + 0.5) * w
            let y = mapDbToY(v, height: size.height)
            if i == 0 { peakPath.move(to: CGPoint(x: x, y: y)) }
            else { peakPath.addLine(to: CGPoint(x: x, y: y)) }
        }
        ctx.stroke(peakPath, with: .color(MeshTheme.textSecondary.opacity(0.5)), lineWidth: 1.5)
        
        // Draw Current
        var curPath = Path()
        for (i, v) in latest.db.enumerated() {
            let x = (Double(i) + 0.5) * w
            let y = mapDbToY(v, height: size.height)
            if i == 0 { curPath.move(to: CGPoint(x: x, y: y)) }
            else { curPath.addLine(to: CGPoint(x: x, y: y)) }
        }
        ctx.stroke(curPath, with: .color(MeshTheme.accent), lineWidth: 2)
    }
    
    private func drawWaterfall(in ctx: GraphicsContext, size: CGSize, sweeps: [SpectrumSweep]) {
        let rowH = size.height / Double(maxHistory)
        
        // Most recent at the top
        for (rowIndex, sweep) in sweeps.reversed().enumerated() {
            let y = Double(rowIndex) * rowH
            let binW = size.width / Double(sweep.db.count)
            
            for (colIndex, db) in sweep.db.enumerated() {
                let x = Double(colIndex) * binW
                let rect = CGRect(x: x, y: y, width: binW + 1, height: rowH + 1) // +1 avoids gaps
                let color = colorForDb(db)
                ctx.fill(Path(rect), with: .color(color))
            }
        }
    }
    
    private func mapDbToY(_ db: Double, height: Double) -> Double {
        let minDb = -130.0
        let maxDb = -30.0
        let clamped = max(minDb, min(maxDb, db))
        let fraction = 1.0 - ((clamped - minDb) / (maxDb - minDb))
        return fraction * height
    }
    
    private func colorForDb(_ db: Double) -> Color {
        // Simple jet/viridis style color map
        let minDb = -130.0
        let maxDb = -50.0
        let fraction = max(0, min(1, (db - minDb) / (maxDb - minDb)))
        
        if fraction < 0.25 {
            return Color(red: 0, green: 0, blue: fraction * 4) // Black to Blue
        } else if fraction < 0.5 {
            return Color(red: 0, green: (fraction - 0.25) * 4, blue: 1.0 - (fraction - 0.25) * 4) // Blue to Green
        } else if fraction < 0.75 {
            return Color(red: (fraction - 0.5) * 4, green: 1.0, blue: 0) // Green to Yellow
        } else {
            return Color(red: 1.0, green: 1.0 - (fraction - 0.75) * 4, blue: 0) // Yellow to Red
        }
    }
}

#endif
