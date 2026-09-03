//
//  MapPointPickerView.swift
//  PommeCore
//
//  Map for selecting LoS endpoints.
//  iOS: tap to drop pin. macOS: crosshair at center, pan map to position.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MapKit

struct MapPointPickerView: View {
    @Binding var selectedCoordinate: CLLocationCoordinate2D?
    @Environment(\.dismiss) private var dismiss
    @State private var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var pinLocation: CLLocationCoordinate2D?

    #if os(macOS)
    // macOS: track map center via onMapCameraChange
    @State private var mapCenter: CLLocationCoordinate2D?
    #endif

    var body: some View {
        NavigationStack {
            ZStack {
                #if os(macOS)
                macOSMapContent
                #else
                iOSMapContent
                #endif
            }
            .navigationTitle("Select Location")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    #if os(macOS)
                    Button("Place Pin Here") {
                        if let center = mapCenter {
                            selectedCoordinate = center
                        }
                        dismiss()
                    }
                    .disabled(mapCenter == nil)
                    #else
                    Button("Confirm") {
                        selectedCoordinate = pinLocation
                        dismiss()
                    }
                    .disabled(pinLocation == nil)
                    #endif
                }
            }
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        .frame(minWidth: 600, idealWidth: 800, minHeight: 500, idealHeight: 600)
        #endif
        .onAppear {
            if let existing = selectedCoordinate {
                pinLocation = existing
                cameraPosition = .region(MKCoordinateRegion(
                    center: existing,
                    span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                ))
            }
        }
    }

    // MARK: - iOS: Tap to place pin

    #if !os(macOS)
    private var iOSMapContent: some View {
        ZStack {
            MapReader { proxy in
                Map(position: $cameraPosition) {
                    if let pin = pinLocation {
                        Annotation("Selected", coordinate: pin) {
                            Image(systemName: "mappin.circle.fill")
                                .font(.title)
                                .foregroundStyle(.red)
                        }
                    }
                    UserAnnotation()
                }
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                    MapScaleView()
                }
                .onTapGesture { screenPoint in
                    if let coordinate = proxy.convert(screenPoint, from: .local) {
                        pinLocation = coordinate
                    }
                }
            }

            if pinLocation == nil {
                VStack {
                    Spacer()
                    Text("Tap the map to place a pin")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.6))
                        .clipShape(Capsule())
                        .padding(.bottom, 40)
                }
            }
        }
    }
    #endif

    // MARK: - macOS: Crosshair at center, pan to position

    #if os(macOS)
    private var macOSMapContent: some View {
        ZStack {
            Map(position: $cameraPosition) {
                UserAnnotation()
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
            }
            .onMapCameraChange(frequency: .continuous) { context in
                mapCenter = context.region.center
            }

            // Fixed crosshair overlay
            VStack(spacing: 0) {
                Image(systemName: "mappin")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(.red)
                    .shadow(color: .black.opacity(0.3), radius: 2, y: 1)

                // Pin shadow dot
                Circle()
                    .fill(.black.opacity(0.2))
                    .frame(width: 6, height: 6)
                    .offset(y: -2)
            }

            // Instruction
            VStack {
                Spacer()
                Text("Pan the map to position the pin, then click Place Pin Here")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.6))
                    .clipShape(Capsule())
                    .padding(.bottom, 20)
            }
        }
    }
    #endif
}
#endif
