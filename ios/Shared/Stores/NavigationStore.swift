//
//  NavigationStore.swift
//  PommeCore
//
//  Sidebar selection and navigation state for split view coordination.
//
//  Created by Michael P. Bedworth on 3/29/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

/// Sidebar navigation selection — used by NavigationSplitView detail routing.
/// On compact (iPhone), this drives the push navigation.
/// On regular width (iPad/Mac), this drives the detail pane.
enum SidebarSelection: Hashable {
    case publicChannel
    case channel(UInt8)
    case contact(Data) // publicKeyPrefix
    case settings
    case map
    case tools
    #if os(macOS) || targetEnvironment(macCatalyst)
    case usbTerminal
    case usbDevice
    #endif
}

/// Observable store for app-wide navigation state.
/// Injected via .environment() so all views can read/write sidebar selection
/// without going through the ViewModel.
@MainActor @Observable
final class NavigationStore {
    var sidebarSelection: SidebarSelection? = nil

    /// Convenience: the currently selected channel index (non-public).
    var selectedChannelIndex: UInt8? {
        if case .channel(let idx) = sidebarSelection { return idx }
        return nil
    }

    /// Convenience: whether the public channel is selected.
    var showPublicChannel: Bool {
        if case .publicChannel = sidebarSelection { return true }
        return false
    }

    /// Convenience: the currently selected contact key.
    var selectedContactKey: Data? {
        if case .contact(let key) = sidebarSelection { return key }
        return nil
    }
}
