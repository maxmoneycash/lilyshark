//
//  PommeCore_WidgetsBundle.swift
//  PommeCore Widgets
//

import WidgetKit
import SwiftUI

@main
struct PommeCore_WidgetsBundle: WidgetBundle {
    var body: some Widget {
        PommeCoreStatusWidget()
        PommeCoreLockWidget()
        PommeCoreSplitWidget()
    }
}
