import Foundation

struct SpectrumSweep: Sendable {
    let f0Hz: Double
    let f1Hz: Double
    let db: [Double]
    let atMs: Double
}

struct SpectrumHistory: Sendable {
    static let limit = 150
    private(set) var sweeps: [SpectrumSweep] = []
    private(set) var peakDb: [Double] = []

    mutating func append(_ sweep: SpectrumSweep) {
        guard sweep.f0Hz.isFinite, sweep.f1Hz.isFinite, sweep.f0Hz >= 0,
              sweep.f1Hz > sweep.f0Hz, !sweep.db.isEmpty, sweep.db.count <= 4096,
              sweep.db.allSatisfy(\.isFinite) else { return }
        if let last = sweeps.last,
           last.f0Hz != sweep.f0Hz || last.f1Hz != sweep.f1Hz || last.db.count != sweep.db.count {
            clear()
        }
        if peakDb.isEmpty { peakDb = sweep.db }
        else { peakDb = zip(peakDb, sweep.db).map { max($0, $1) } }
        sweeps.append(sweep)
        if sweeps.count > Self.limit { sweeps.removeFirst(sweeps.count - Self.limit) }
    }

    mutating func clear() {
        sweeps = []
        peakDb = []
    }
}
