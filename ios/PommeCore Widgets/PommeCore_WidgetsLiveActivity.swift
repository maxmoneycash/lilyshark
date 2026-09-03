//
//  PommeCore_WidgetsLiveActivity.swift
//  PommeCore Widgets
//
//  Created by Michael P. Bedworth on 4/27/26.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct PommeCore_WidgetsAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct PommeCore_WidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PommeCore_WidgetsAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension PommeCore_WidgetsAttributes {
    fileprivate static var preview: PommeCore_WidgetsAttributes {
        PommeCore_WidgetsAttributes(name: "World")
    }
}

extension PommeCore_WidgetsAttributes.ContentState {
    fileprivate static var smiley: PommeCore_WidgetsAttributes.ContentState {
        PommeCore_WidgetsAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: PommeCore_WidgetsAttributes.ContentState {
         PommeCore_WidgetsAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: PommeCore_WidgetsAttributes.preview) {
   PommeCore_WidgetsLiveActivity()
} contentStates: {
    PommeCore_WidgetsAttributes.ContentState.smiley
    PommeCore_WidgetsAttributes.ContentState.starEyes
}
