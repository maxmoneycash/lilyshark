#if !os(watchOS)
import SwiftUI
import MapKit
import MeshCoreKit

struct NativeCoverageView: View {
    @Bindable var store: CommunityCoverageStore
    let area: String
    let openSources: () -> Void
    @Environment(LineOfSightStore.self) private var terrain
    @Environment(ConnectionManager.self) private var connection
    @Environment(DeviceConfig.self) private var config
    @Environment(ContactStore.self) private var contacts
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Namespace private var mapScope
    @State private var highlightedRepeaterID: String?
    @State private var selectionCamera: MapCameraPosition?
    @State private var pendingSearchSelection: CoverageRepeaterPoint?
    @State private var showRadio = false
    @State private var directory: [InternetMapNode] = []
    @State private var directoryError: String?
    @State private var loadingDirectory = true
    @State private var selectedGroup: CoverageRepeaterGroup?
    @State private var showCells = false
    @State private var selectedDirectory: InternetMapNode?
    @State private var measuring = false
    @State private var measurement: [CLLocationCoordinate2D] = []
    @State private var showTerrain = false
    @State private var satellite = false
    @State private var camera: MapCameraPosition = .automatic
    @State private var region: MKCoordinateRegion?
    @State private var selectedCell: MeshMapperCell?
    @State private var selectedRepeater: MeshMapperRepeater?
    @State private var showFilters = false
    @State private var showRepeaters = false
    @State private var search = ""
    @State private var days = 0
    @State private var minimumSNR = -100.0
    @State private var showRepeaterPins = true
    private let cellLimit = 800

    private var radioCoordinate: CLLocationCoordinate2D? {
        RadioMapPosition.reportedCoordinate(connection: connection, config: config, contacts: contacts)
    }

    private var cellsInView: [MeshMapperCell] {
        let cells = store.filteredCells
        guard let region else { return cells }
        let south = region.center.latitude - region.span.latitudeDelta / 2
        let north = region.center.latitude + region.span.latitudeDelta / 2
        let west = region.center.longitude - region.span.longitudeDelta / 2
        let east = region.center.longitude + region.span.longitudeDelta / 2
        return cells.filter { $0.bounds.north >= south && $0.bounds.south <= north && $0.bounds.east >= west && $0.bounds.west <= east }
    }
    private var repeaters: [MeshMapperRepeater] {
        (store.report?.repeaters ?? []).filter {
            search.isEmpty || ($0.name ?? "").localizedCaseInsensitiveContains(search) || $0.hex.localizedCaseInsensitiveContains(search)
        }
    }
    private var areaName: String { area == "baus" ? "Bay Area" : area == "sfo" ? "San Francisco" : "Oakland" }
    private var directoryRepeaters: [InternetMapNode] {
        directory.filter { $0.type == 2 || $0.type == 3 }
    }
    private var searchableDirectory: [InternetMapNode] {
        let origin = region?.center ?? CLLocationCoordinate2D(latitude: 37.8044, longitude: -122.2712)
        return directoryRepeaters.filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.publicKey.localizedCaseInsensitiveContains(search)
        }.sorted {
            let a = MKMapPoint(CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude))
            let b = MKMapPoint(CLLocationCoordinate2D(latitude: $1.latitude, longitude: $1.longitude))
            return a.distance(to: MKMapPoint(origin)) < b.distance(to: MKMapPoint(origin))
        }
    }
    /// Every visible repeater is represented. Dense areas collapse into tappable groups;
    /// there is no arbitrary first-150 cut-off that makes radios disappear.
    private func repeaterGroups(_ points: [CoverageRepeaterPoint], in proxy: MapProxy) -> [CoverageRepeaterGroup] {
        guard showRepeaterPins, let region else { return [] }
        let cellSize = max(max(region.span.latitudeDelta, region.span.longitudeDelta) * 0.13, 0.00001)
        let visible = points.filter {
            abs($0.coordinate.latitude - region.center.latitude) <= region.span.latitudeDelta / 2 &&
            abs($0.coordinate.longitude - region.center.longitude) <= region.span.longitudeDelta / 2
        }
        let grouped = Dictionary(grouping: visible) {
            "\(Int(floor($0.coordinate.latitude / cellSize))):\(Int(floor($0.coordinate.longitude / cellSize)))"
        }
        var clusters = grouped.values.map { points in
            let sorted = points.sorted { $0.id < $1.id }
            return CoverageRepeaterGroup(id: sorted[0].id, points: sorted)
        }.sorted { $0.id < $1.id }

        // Bucket boundaries can leave neighboring centroids almost coincident.
        // Merge in the map's actual screen projection, including camera rotation,
        // until every marker has a full touch target and a little breathing room.
        let spacing = Design.minimumTouchTarget + Design.Space.tight
        var changed = true
        while changed {
            changed = false
            var merged: [CoverageRepeaterGroup] = []
            for cluster in clusters {
                guard let center = proxy.convert(cluster.coordinate, to: .local) else {
                    merged.append(cluster)
                    continue
                }
                if let index = merged.firstIndex(where: { other in
                    guard let point = proxy.convert(other.coordinate, to: .local) else { return false }
                    return hypot(point.x - center.x, point.y - center.y) < spacing
                }) {
                    let members = (merged[index].points + cluster.points).sorted { $0.id < $1.id }
                    // The first member anchors identity across camera movements;
                    // array order and dictionary iteration never become identity.
                    merged[index] = CoverageRepeaterGroup(id: members[0].id, points: members)
                    changed = true
                } else { merged.append(cluster) }
            }
            clusters = merged
        }
        return clusters
    }
    private var filtersActive: Bool {
        store.filter.types.count != MeshMapperCoverageType.allCases.count || store.filter.minimumSNR != nil || store.filter.since != nil
    }
    private var distance: Double? {
        guard measurement.count == 2 else { return nil }
        return CLLocation(latitude: measurement[0].latitude, longitude: measurement[0].longitude)
            .distance(from: CLLocation(latitude: measurement[1].latitude, longitude: measurement[1].longitude))
    }

    var body: some View {
        // Snapshot inputs at the owning view boundary. MapKit retains its content
        // builder; reading only inside that builder can leave newly received pins
        // or the second measurement point waiting for a later camera update.
        let lineCoordinates = measurement
        let measuredPoints = measurementPoints
        let highlightedID = highlightedRepeaterID
        let pins = (store.report?.repeaters).map { $0.compactMap(CoverageRepeaterPoint.init) }
            ?? directoryRepeaters.map(CoverageRepeaterPoint.init)
        ZStack {
            Group {
                MapReader { proxy in
                    Map(position: $camera, scope: mapScope) {
                        ForEach(Array(cellsInView.prefix(cellLimit))) { cell in
                            MapPolygon(coordinates: corners(cell.bounds))
                                .foregroundStyle(color(cell.fillColor).opacity(0.5))
                                .stroke(color(cell.borderColor), lineWidth: 0.5)
                        }
                        ForEach(repeaterGroups(pins, in: proxy)) { group in
                            Annotation(group.points.count == 1 ? group.points[0].name : "", coordinate: group.coordinate) {
                                Button {
                                    if measuring { addMeasurementPoint(group.coordinate) }
                                    else {
                                        highlightedRepeaterID = group.points[0].id
                                        focusSelection(group.coordinate)
                                        if group.points.count == 1 { select(group.points[0]) }
                                        else { selectedGroup = group }
                                    }
                                } label: {
                                    CoverageRepeaterMarker(count: group.points.count, ambiguous: group.points.contains { $0.ambiguous }, selected: group.points.contains { $0.id == highlightedID })
                                }
                                .buttonStyle(.meshPlain)
                                .accessibilityLabel(group.points.count == 1 ? "Repeater \(group.points[0].name)" : "\(group.points.count) repeaters in this area")
                                .accessibilityHint(measuring ? "Adds this location to the measurement" : "Opens repeater details")
                            }.annotationTitles(.hidden)
                        }
                        if lineCoordinates.count == 2 {
                            MapPolyline(coordinates: lineCoordinates).stroke(MeshTheme.accent, style: StrokeStyle(lineWidth: 3, dash: [6, 4]))
                        }
                        ForEach(measuredPoints) { point in
                            Annotation(point.id, coordinate: point.coordinate) {
                                Text(point.id).font(.headline)
                                    .padding(Design.Space.tight).background(MeshTheme.accent, in: Circle())
                                    .foregroundStyle(colorScheme == .dark ? .black : .white)
                            }
                        }
                        if let radioCoordinate {
                            Annotation("My radio · last reported position", coordinate: radioCoordinate) {
                                Button { showRadio = true } label: {
                                    Label("My radio", systemImage: "sensor.tag.radiowaves.forward.fill")
                                        .font(.caption.weight(.semibold))
                                        .padding(Design.Space.tight)
                                        .background(MeshTheme.surface, in: Capsule())
                                        .overlay(Capsule().strokeBorder(MeshTheme.accent, lineWidth: 2))
                                        .frame(minHeight: Design.minimumTouchTarget).contentShape(.rect)
                                }
                                .buttonStyle(.meshPlain)
                                .accessibilityLabel("My radio, last reported position")
                                .accessibilityHint("Opens your radio's connection and position details")
                                .accessibilityIdentifier("coverage-own-radio")
                            }
                        }
                        UserAnnotation()
                    }
                    // MapKit can retain removed or newly added annotation branches.
                    // Reconcile the map when the measurement structure changes; the
                    // camera binding preserves the user’s chosen view.
                    .id(measurement.count)
                    .onMapCameraChange(frequency: .onEnd) { region = $0.region }
                    .accessibilityIdentifier("coverage-native-map")
                    .onTapGesture { point in
                        guard let coordinate = proxy.convert(point, from: .local) else { return }
                        if measuring {
                            addMeasurementPoint(coordinate)
                            return
                        }
                        highlightedRepeaterID = nil
                        selectedCell = cellsInView.prefix(cellLimit).first { $0.bounds.contains(latitude: coordinate.latitude, longitude: coordinate.longitude) }
                    }
                    .mapStyle(satellite ? .hybrid(elevation: .realistic) : .standard(elevation: .realistic, pointsOfInterest: .excludingAll))
                    .mapControls { MapScaleView() }
                    .overlay(alignment: .bottomTrailing) {
                        VStack(spacing: Design.Space.tight) {
                            MapCompass(scope: mapScope)
                            MapUserLocationButton(scope: mapScope)
                                .tint(MeshTheme.textPrimary)
                            if let radioCoordinate {
                                Button {
                                    camera = .region(.init(center: radioCoordinate, span: .init(latitudeDelta: 0.05, longitudeDelta: 0.05)))
                                } label: {
                                    Image(systemName: "sensor.tag.radiowaves.forward.fill")
                                        .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                                        .background(.regularMaterial, in: Circle())
                                }
                                .buttonStyle(.meshPlain)
                                .accessibilityLabel("Center on my radio")
                                .accessibilityIdentifier("coverage-center-radio")
                            }
                        }
                        .padding(.trailing, Design.Space.snug)
                        .padding(.bottom, Design.minimumTouchTarget + Design.Space.loose)
                    }
                    .overlay(alignment: .bottom) {
                        if cellsInView.count > cellLimit {
                            Text("Zoom in to show all \(cellsInView.count) cells in this area.")
                                .font(.caption).padding(Design.Space.snug)
                                .background(.regularMaterial, in: Capsule()).padding()
                        }
                    }
                }
                .ignoresSafeArea(.container, edges: .top)
            }
        }
        .overlay(alignment: .topLeading) {
            mapHeader
                .padding(.horizontal, Design.Space.snug)
                .padding(.top, Design.minimumTouchTarget + Design.Space.regular)
        }
        .overlay(alignment: .bottom) {
            mapTools.padding(.horizontal, Design.Space.snug).padding(.bottom, Design.Space.snug)
        }
        .task {
            if region == nil {
                if store.report != nil { fitReport() } else { centerOnArea() }
            }
            loadingDirectory = true
            async let refresh: Void = store.refresh()
            await MeshMapService.shared.fetchIfNeeded()
            directory = MeshMapService.shared.nodes
            directoryError = MeshMapService.shared.lastFetchError
            loadingDirectory = false
            await refresh
        }
        .onChange(of: area) { centerOnArea() }
        .onChange(of: store.report?.generatedAt) { if store.report != nil { fitReport() } }
        .sheet(item: $selectedGroup, onDismiss: restoreSelectionCamera) { group in
            NavigationStack {
                List {
                    Section {
                        ForEach(group.points) { point in
                            NavigationLink {
                                repeaterSummary(point)
                            } label: { repeaterRow(point) }
                        }
                    } header: { Text("\(group.points.count) repeaters in this area") }
                    Button("Zoom to this area", systemImage: "plus.magnifyingglass") {
                        selectionCamera = nil
                        zoom(to: group)
                        selectedGroup = nil
                    }
                }
                .navigationTitle("Repeaters")
                .lilysharkSheet { selectedGroup = nil }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(isPresented: $showCells) {
            NavigationStack {
                List {
                    if cellsInView.isEmpty {
                        ContentUnavailableView("No observations here", systemImage: "square.dashed", description: Text("Move the map or adjust coverage filters to find measured cells."))
                    }
                    ForEach(Array(cellsInView.prefix(cellLimit))) { cell in
                        NavigationLink {
                            coverageCellDetails(cell)
                        } label: {
                            HStack {
                                Image(systemName: "square.fill").foregroundStyle(color(cell.fillColor))
                                VStack(alignment: .leading) {
                                    Text(cell.type?.title ?? cell.coverageType)
                                    Text(cell.gridID).font(.caption).foregroundStyle(MeshTheme.textSecondary)
                                }
                                Spacer()
                                Text(metric(cell.snr, unit: "dB")).font(.caption.monospacedDigit())
                            }
                        }
                    }
                }
                .navigationTitle("Coverage in view")
                .lilysharkSheet { showCells = false }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(isPresented: $showTerrain) { LineOfSightView().meshTheme() }
        .sheet(isPresented: $showRadio) {
            NavigationStack { RadioVisibilityView().lilysharkSheet { showRadio = false } }.meshTheme()
        }
        .sheet(item: $selectedDirectory, onDismiss: restoreSelectionCamera) { node in
            NavigationStack {
                repeaterSummary(CoverageRepeaterPoint(node))
                    .lilysharkSheet { selectedDirectory = nil }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(item: $selectedCell) { cell in
            NavigationStack {
                coverageCellDetails(cell).lilysharkSheet { selectedCell = nil }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(item: $selectedRepeater, onDismiss: restoreSelectionCamera) { node in
            NavigationStack {
                if let point = CoverageRepeaterPoint(node) {
                    repeaterSummary(point).lilysharkSheet { selectedRepeater = nil }
                }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(isPresented: $showRepeaters, onDismiss: openPendingSearchSelection) {
            NavigationStack {
                List {
                  ForEach(repeaters) { node in
                    Button {
                        guard let point = CoverageRepeaterPoint(node) else { return }
                        chooseSearchResult(point)
                    } label: {
                        VStack(alignment: .leading) {
                            Text(node.name ?? "Unnamed repeater").foregroundStyle(MeshTheme.textPrimary)
                            Text("\(node.hex)\(node.isAmbiguous ? " · Ambiguous ID" : "")\(node.hasPosition ? "" : " · No position")")
                                .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                        }
                    }.disabled(!node.hasPosition)
                  }
                  if store.report?.repeaters != nil && repeaters.isEmpty {
                    ContentUnavailableView.search(text: search)
                  }
                  if store.report?.repeaters == nil {
                    Section("Public directory") {
                      ForEach(Array(searchableDirectory.prefix(100))) { node in
                        Button { chooseSearchResult(CoverageRepeaterPoint(node)) } label: {
                            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                                Text(node.name).foregroundStyle(MeshTheme.textPrimary)
                                if let center = region?.center {
                                    let distance = MKMapPoint(center).distance(to: MKMapPoint(.init(latitude: node.latitude, longitude: node.longitude)))
                                    Text(String(format: "%.1f km from map center", distance / 1000))
                                        .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                                }
                            }
                        }
                      }
                      if searchableDirectory.isEmpty { Text(search.isEmpty ? "No repeater records are available." : "No repeaters match this search.").foregroundStyle(MeshTheme.textSecondary) }
                      Text("Nearest to the map center first. Search to narrow the first 100 results.").font(.caption)
                    }
                  }
                }
                .searchable(text: $search, prompt: "Name or ID prefix")
                .navigationTitle("Find repeater")
                .lilysharkSheet { showRepeaters = false }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
        .sheet(isPresented: $showFilters) {
            NavigationStack {
                Form {
                    if store.report == nil {
                        Section { Text("Measured coverage is currently unavailable. Filters apply when coverage data is loaded.").foregroundStyle(MeshTheme.textSecondary) }
                    }
                    Section("Coverage type") {
                        ForEach(MeshMapperCoverageType.allCases) { type in
                            Toggle(isOn: Binding(get: { store.filter.types.contains(type) }, set: { on in
                                if on { store.filter.types.insert(type) } else { store.filter.types.remove(type) }
                            })) {
                                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                                    Text(type.title)
                                    Text(type.explanation).font(.caption).foregroundStyle(MeshTheme.textSecondary)
                                }
                            }
                        }
                    }
                    Section("Observations") {
                        Picker("Time", selection: $days) {
                            Text("All time").tag(0); Text("24 hours").tag(1); Text("7 days").tag(7); Text("30 days").tag(30)
                        }.onChange(of: days) { store.filter.since = days == 0 ? nil : Date().addingTimeInterval(-Double(days) * 86400) }
                        Picker("Minimum SNR", selection: $minimumSNR) {
                            Text("Any, including unknown").tag(-100.0)
                            Text("−10 dB").tag(-10.0); Text("0 dB").tag(0.0); Text("10 dB").tag(10.0)
                        }.onChange(of: minimumSNR) { store.filter.minimumSNR = minimumSNR == -100 ? nil : minimumSNR }
                        Toggle("Show repeaters", isOn: $showRepeaterPins)
                        Button("Reset filters") { resetFilters() }
                    }
                }
                .navigationTitle("Coverage filters")
                .lilysharkSheet { showFilters = false }
            }.meshTheme().coverageSheetSizing(accessibility: dynamicTypeSize.isAccessibilitySize)
        }
    }

    private var measurementPoints: [CoverageMeasurementPoint] {
        measurement.enumerated().map { CoverageMeasurementPoint(id: $0.offset == 0 ? "A" : "B", coordinate: $0.element) }
    }

    private var mapHeader: some View {
        HStack(spacing: Design.Space.tight) {
            Button { showRepeaters = true } label: {
                Label("Find repeater", systemImage: "magnifyingglass")
                    .font(.subheadline)
                    .padding(.horizontal, Design.Space.snug)
                    .frame(minHeight: Design.minimumTouchTarget)
                    .background(.regularMaterial, in: Capsule())
                    .contentShape(.capsule)
            }
            .accessibilityLabel("Search repeaters")
            .accessibilityIdentifier("coverage-search")
            Button { showFilters = true } label: {
                Image(systemName: filtersActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                    .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                    .background(.regularMaterial, in: Circle())
            }
            .foregroundStyle(filtersActive ? MeshTheme.accent : MeshTheme.textPrimary)
            .accessibilityLabel("Coverage filters")
            .accessibilityValue(filtersActive ? "Filters active" : "All observations")
            .accessibilityIdentifier("coverage-filters")
            Spacer(minLength: 0)
        }
        .foregroundStyle(MeshTheme.textPrimary)
        .buttonStyle(.meshPlain)
    }

    private var mapTools: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            if measuring || distance != nil {
                HStack(spacing: Design.Space.tight) {
                    Image(systemName: "ruler").foregroundStyle(MeshTheme.accent)
                    Text(distance.map { String(format: "%.2f km · straight line", $0 / 1000) }
                         ?? (measurement.isEmpty ? "Choose point A" : "Choose point B"))
                        .font(.subheadline.weight(.medium).monospacedDigit())
                    Spacer(minLength: 0)
                    Button { measurement = []; measuring = false } label: {
                        Image(systemName: "xmark")
                            .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget).contentShape(.rect)
                    }
                    .accessibilityLabel(measuring ? "Cancel measurement" : "Clear measurement")
                }
                .padding(.leading, Design.Space.snug)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
            }
            HStack(spacing: Design.Space.tight) {
                mapStatus
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    Menu {
                        Toggle("Satellite", isOn: $satellite)
                        Toggle("Show repeaters", isOn: $showRepeaterPins)
                        Button("Fit coverage", systemImage: "arrow.up.left.and.arrow.down.right") { store.report == nil ? centerOnArea() : fitReport() }
                        if store.report != nil { Button("Browse cells in view", systemImage: "list.bullet.rectangle") { showCells = true } }
                    } label: {
                        Image(systemName: "square.3.layers.3d")
                            .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                    }
                    .accessibilityLabel("Layers")
                    .accessibilityIdentifier("coverage-layers")
                    Button { measurement = []; measuring.toggle() } label: {
                        Image(systemName: "ruler")
                            .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget).contentShape(.rect)
                    }
                    .foregroundStyle(measuring ? MeshTheme.accent : MeshTheme.textPrimary)
                    .accessibilityLabel(measuring ? "Cancel measurement" : "Measure distance")
                    .accessibilityIdentifier("coverage-measure")
                    Button {
                        if measurement.count == 2 {
                            terrain.configureForMapPins(measurement[0], measurement[1])
                            terrain.relays = []
                            terrain.clearCache()
                        }
                        showTerrain = true
                    } label: {
                        Image(systemName: "mountain.2")
                            .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget).contentShape(.rect)
                    }
                    .accessibilityLabel("Analyze terrain")
                    .accessibilityHint("Analyze terrain between map points, or enter coordinates")
                    .accessibilityIdentifier("coverage-terrain")
                }
                .font(.subheadline.weight(.medium))
                .background(.regularMaterial, in: Capsule())
            }
        }
        .foregroundStyle(MeshTheme.textPrimary)
        .buttonStyle(.meshPlain)
    }

    private var mapStatus: some View {
        Button {
            if directoryError != nil && store.report == nil { Task { await refreshDirectory() } }
            else if store.report != nil && store.filteredCells.isEmpty { resetFilters() }
            else { openSources() }
        } label: {
            HStack(spacing: Design.Space.hairline) {
                if loadingDirectory || store.isLoading { ProgressView().controlSize(.mini) }
                else { Image(systemName: directoryError == nil ? "info.circle" : "arrow.clockwise") }
                if !dynamicTypeSize.isAccessibilitySize {
                    Text(directoryError != nil && store.report == nil ? "Retry directory" : store.report == nil ? "Coverage unmeasured" : store.filteredCells.isEmpty ? "Reset filters" : "\(store.filteredCells.count) cells")
                        .font(.caption).lineLimit(1)
                }
            }
            .padding(.horizontal, Design.Space.snug)
            .frame(minWidth: Design.minimumTouchTarget, minHeight: Design.minimumTouchTarget)
            .background(.regularMaterial, in: Capsule())
        }
        .accessibilityLabel(store.report == nil ? "Coverage data, coverage unmeasured" : "Coverage data, \(store.filteredCells.count) cells")
        .accessibilityHint(directoryError ?? store.errorMessage ?? "View data source, freshness and connection status")
        .accessibilityIdentifier("coverage-connect-data")
    }

    private func addMeasurementPoint(_ coordinate: CLLocationCoordinate2D) {
        if measurement.count == 2 { measurement = [] }
        measurement.append(coordinate)
        if measurement.count == 2 { measuring = false }
    }

    private func focusSelection(_ coordinate: CLLocationCoordinate2D) {
        if selectionCamera == nil { selectionCamera = camera }
        let span = region?.span ?? .init(latitudeDelta: 0.05, longitudeDelta: 0.05)
        camera = .region(.init(center: .init(latitude: max(-85, min(85, coordinate.latitude - span.latitudeDelta * 0.2)), longitude: coordinate.longitude), span: span))
    }

    private func restoreSelectionCamera() {
        if let saved = selectionCamera { camera = saved; selectionCamera = nil }
    }

    private func chooseSearchResult(_ point: CoverageRepeaterPoint) {
        let target = MKCoordinateRegion(center: point.coordinate, span: .init(latitudeDelta: 0.025, longitudeDelta: 0.025))
        region = target
        camera = .region(target)
        pendingSearchSelection = point
        showRepeaters = false
    }

    private func openPendingSearchSelection() {
        guard let point = pendingSearchSelection else { return }
        pendingSearchSelection = nil
        highlightedRepeaterID = point.id
        focusSelection(point.coordinate)
        select(point)
    }

    private func resetFilters() {
        store.filter = MeshMapperFilter(); days = 0; minimumSNR = -100; showRepeaterPins = true
    }
    private func refreshDirectory() async {
        loadingDirectory = true
        await MeshMapService.shared.fetch()
        directory = MeshMapService.shared.nodes
        directoryError = MeshMapService.shared.lastFetchError
        loadingDirectory = false
    }
    private func select(_ point: CoverageRepeaterPoint) {
        selectedDirectory = point.directory
        selectedRepeater = point.repeater
    }
    private func zoom(to group: CoverageRepeaterGroup) {
        let span = max((region?.span.latitudeDelta ?? 0.24) / 3, 0.004)
        camera = .region(MKCoordinateRegion(center: group.coordinate, span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)))
    }
    private func repeaterRow(_ point: CoverageRepeaterPoint) -> some View {
        HStack(spacing: Design.Space.snug) {
            Image(systemName: point.ambiguous ? "questionmark.diamond" : "antenna.radiowaves.left.and.right").foregroundStyle(MeshTheme.accent)
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(point.name)
                Text(point.ambiguous ? "Ambiguous ID" : coordinateText(point.coordinate)).font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
        }
    }
    private func repeaterSummary(_ point: CoverageRepeaterPoint) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Design.Space.tight) {
                    Text(point.name).font(.headline).textSelection(.enabled)
                    HStack(spacing: Design.Space.tight) {
                        Text(point.directory?.typeName ?? "Repeater")
                        if let node = point.directory, node.radioFreq > 0 {
                            Text("·")
                            Text(String(format: "%.3f MHz", node.radioFreq)).monospacedDigit()
                        }
                    }.font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
                }
                if point.ambiguous { Label("Ambiguous ID", systemImage: "questionmark.diamond").font(.subheadline) }
                Button("Measure from this repeater", systemImage: "ruler") {
                    measurement = [point.coordinate]; measuring = true
                    selectedGroup = nil; selectedDirectory = nil; selectedRepeater = nil
                }
            } footer: {
                Text("Community record. Reception by your radio is unverified.")
            }
            DisclosureGroup("Record details") {
                LabeledContent("Position", value: coordinateText(point.coordinate))
                if let node = point.directory {
                    Text(node.publicKey).font(.caption.monospaced()).textSelection(.enabled)
                }
                if let node = point.repeater {
                    LabeledContent("ID prefix", value: node.hex)
                    if let bytes = node.advertBytes { LabeledContent("Path ID width", value: "\(bytes) \(bytes == 1 ? "byte" : "bytes")") }
                    if let heard = node.lastHeard { LabeledContent("Last heard", value: Date(timeIntervalSince1970: heard).formatted()) }
                }
            }
        }.navigationTitle("Repeater")
    }
    private func coverageCellDetails(_ cell: MeshMapperCell) -> some View {
        List {
            Section {
                Label(cell.type?.title ?? cell.coverageType, systemImage: "square.fill").foregroundStyle(color(cell.fillColor)).font(.headline)
                Text(cell.type?.explanation ?? "An additional coverage type reported by the data feed.")
            }
            Section("Observations") {
                if let mask = cell.statusMask { LabeledContent("Observed types", value: observedTypes(mask)) }
                LabeledContent("Samples", value: cell.count.map { String($0) } ?? "Not reported")
                LabeledContent("Average SNR", value: metric(cell.snr, unit: "dB"))
                LabeledContent("Minimum SNR", value: metric(cell.snrMin, unit: "dB"))
                LabeledContent("Maximum SNR", value: metric(cell.snrMax, unit: "dB"))
                LabeledContent("Noise above floor", value: metric(cell.noise, unit: "dB"))
                LabeledContent("Quality (0–3)", value: metric(cell.effective, unit: ""))
                if let timestamp = cell.timestamp { LabeledContent("Last observation", value: Date(timeIntervalSince1970: timestamp).formatted()) }
                if let first = cell.firstSeen { LabeledContent("First observation", value: Date(timeIntervalSince1970: first).formatted()) }
            }
            Section {
                LabeledContent("Grid", value: cell.gridID)
                Text("This cell summarizes observations. Individual packet paths are not included in the feed.").font(.caption).foregroundStyle(MeshTheme.textSecondary)
                Button("Measure from this cell", systemImage: "ruler") {
                    measurement = [.init(latitude: cell.bounds.latitude, longitude: cell.bounds.longitude)]
                    measuring = true; selectedCell = nil; showCells = false
                }
            }
        }.navigationTitle("Coverage cell")
    }
    private func observedTypes(_ mask: Int) -> String {
        let types: [(Int, MeshMapperCoverageType)] = [(1, .bidirectional), (2, .transmit), (4, .receive), (8, .discovery), (16, .dead), (32, .drop)]
        var labels = types.filter { mask & $0.0 != 0 }.map { $0.1.title }
        if mask & ~63 != 0 { labels.append("Additional types") }
        return labels.isEmpty ? "Not reported" : labels.joined(separator: ", ")
    }
    private func coordinateText(_ coordinate: CLLocationCoordinate2D) -> String {
        String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
    }
    private func centerOnArea() {
        let center = CLLocationCoordinate2D(latitude: area == "sfo" ? 37.7749 : area == "baus" ? 37.65 : 37.8044, longitude: area == "sfo" ? -122.4194 : area == "baus" ? -122.2 : -122.2712)
        let span = area == "baus" ? 0.9 : 0.24
        let newRegion = MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span))
        region = newRegion; camera = .region(newRegion)
    }

    private func fitReport() {
        let cells = store.report?.validCells ?? []
        guard let first = cells.first else { return }
        var bounds = MKMapRect.null
        for cell in cells {
            for coordinate in corners(cell.bounds) {
                let point = MKMapPoint(coordinate)
                bounds = bounds.union(MKMapRect(x: point.x, y: point.y, width: 1, height: 1))
            }
        }
        camera = bounds.isNull ? .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: first.bounds.latitude, longitude: first.bounds.longitude), span: MKCoordinateSpan(latitudeDelta: 0.3, longitudeDelta: 0.3))) : .rect(bounds)
    }
    private func corners(_ b: MeshMapperBounds) -> [CLLocationCoordinate2D] {
        [.init(latitude: b.south, longitude: b.west), .init(latitude: b.north, longitude: b.west), .init(latitude: b.north, longitude: b.east), .init(latitude: b.south, longitude: b.east)]
    }
    private func color(_ hex: String) -> Color {
        guard hex.count == 7, hex.first == "#", let rgb = UInt32(hex.dropFirst(), radix: 16) else { return .gray }
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
    private func metric(_ value: Double?, unit: String) -> String { value.map { String(format: "%.1f %@", $0, unit) } ?? "Not reported" }
}
private struct CoverageMeasurementPoint: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
}

private struct CoverageRepeaterPoint: Identifiable {
    let id: String
    let name: String
    let coordinate: CLLocationCoordinate2D
    let ambiguous: Bool
    let directory: InternetMapNode?
    let repeater: MeshMapperRepeater?

    init(_ node: InternetMapNode) {
        id = "directory:" + node.id
        name = node.name
        coordinate = .init(latitude: node.latitude, longitude: node.longitude)
        ambiguous = false; directory = node; repeater = nil
    }
    init?(_ node: MeshMapperRepeater) {
        guard node.hasPosition, let lat = node.lat, let lon = node.lon else { return nil }
        id = "coverage:" + node.id
        name = node.name ?? node.hex
        coordinate = .init(latitude: lat, longitude: lon)
        ambiguous = node.isAmbiguous; directory = nil; repeater = node
    }
}

private struct CoverageRepeaterGroup: Identifiable {
    let id: String
    let points: [CoverageRepeaterPoint]
    var coordinate: CLLocationCoordinate2D {
        .init(latitude: points.reduce(0) { $0 + $1.coordinate.latitude } / Double(points.count),
              longitude: points.reduce(0) { $0 + $1.coordinate.longitude } / Double(points.count))
    }
}

struct CoverageRepeaterMarker: View {
    let count: Int
    let ambiguous: Bool
    let selected: Bool
    @ScaledMetric(relativeTo: .caption2) private var diameter = 24.0
    var body: some View {
        Group {
            if count > 1 || ambiguous {
                Group {
                    if count > 1 { Text(count.formatted(.number.notation(.compactName))).font(.caption2.weight(.semibold).monospacedDigit()) }
                    else { Image(systemName: "questionmark").font(.caption2.weight(.semibold)) }
                }
                .foregroundStyle(MeshTheme.textPrimary)
                .frame(width: diameter, height: diameter)
                .background(MeshTheme.surface, in: Circle())
                .overlay(Circle().strokeBorder(MeshTheme.accent.opacity(selected ? 1 : 0.6), lineWidth: selected ? 2.5 : 1.5))
            } else {
                Circle().fill(MeshTheme.accent)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().strokeBorder(MeshTheme.surface, lineWidth: 2))
            }
        }
        .frame(minWidth: Design.minimumTouchTarget, minHeight: Design.minimumTouchTarget)
        .background {
            if selected { Circle().strokeBorder(MeshTheme.accent, lineWidth: 2).frame(width: 36, height: 36) }
        }
        .contentShape(Circle())
    }
}

private extension View {
    @ViewBuilder func coverageSheetSizing(accessibility: Bool) -> some View {
        #if os(iOS)
        self.presentationDetents(accessibility ? [.large] : [.medium, .large])
            .presentationDragIndicator(.visible)
        #else
        self
        #endif
    }
}

#endif
