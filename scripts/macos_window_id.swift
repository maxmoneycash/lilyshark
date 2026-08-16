import AppKit
import CoreGraphics
import Foundation

struct WindowMatch {
    let id: CGWindowID
    let width: Int
    let height: Int
    let title: String
}

func fail(_ message: String, code: Int32 = EXIT_FAILURE) -> Never {
    if let data = (message + "\n").data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(code)
}

guard CommandLine.arguments.count == 5,
      let processID = Int32(CommandLine.arguments[1]),
      let minimumWidth = Int(CommandLine.arguments[3]),
      let minimumHeight = Int(CommandLine.arguments[4]),
      processID > 0, minimumWidth > 0, minimumHeight > 0 else {
    fail("Usage: macos_window_id.swift PID TITLE_PREFIX MIN_WIDTH MIN_HEIGHT")
}

let titlePrefix = CommandLine.arguments[2]
if #available(macOS 10.15, *), !CGPreflightScreenCaptureAccess() {
    fail("Screen Recording permission is not available for this terminal session", code: 3)
}

guard let application = NSRunningApplication(processIdentifier: processID),
      !application.isTerminated else {
    fail("No running application has PID \(processID)")
}

let activationOptions: NSApplication.ActivationOptions
if #available(macOS 14.0, *) {
    activationOptions = [.activateAllWindows]
} else {
    activationOptions = [.activateAllWindows, .activateIgnoringOtherApps]
}
if application.isHidden {
    _ = application.unhide()
}
guard application.activate(options: activationOptions) else {
    fail("macOS refused to activate the application for PID \(processID)")
}

func eligibleWindows() -> [WindowMatch] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID)
            as? [[String: Any]] else {
        fail("macOS did not return an on-screen window list")
    }

    var candidates: [WindowMatch] = []
    for window in windowList {
        guard let ownerPID = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
              ownerPID == processID,
              let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue,
              layer >= 0,
              let windowNumber = (window[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
              let bounds = window[kCGWindowBounds as String] as? [String: NSNumber],
              let widthNumber = bounds["Width"],
              let heightNumber = bounds["Height"] else {
            continue
        }

        let width = Int(widthNumber.doubleValue.rounded())
        let height = Int(heightNumber.doubleValue.rounded())
        guard width >= minimumWidth, height >= minimumHeight else {
            continue
        }

        candidates.append(WindowMatch(
            id: CGWindowID(windowNumber),
            width: width,
            height: height,
            title: window[kCGWindowName as String] as? String ?? ""
        ))
    }
    return candidates
}

let activationDeadline = Date().addingTimeInterval(2.0)
var candidates = eligibleWindows()
while (candidates.isEmpty || !application.isActive) && Date() < activationDeadline {
    Thread.sleep(forTimeInterval: 0.05)
    candidates = eligibleWindows()
}
guard application.isActive else {
    fail("The application for PID \(processID) did not become active")
}

let titledMatches = candidates.filter { $0.title.hasPrefix(titlePrefix) }
let selected: WindowMatch
if titledMatches.count == 1 {
    selected = titledMatches[0]
} else if titledMatches.isEmpty && candidates.count == 1 {
    // macOS can hide window titles until Screen Recording permission is granted.
    // The simulator PID plus its minimum dimensions still identify its sole window.
    selected = candidates[0]
} else if candidates.isEmpty {
    fail("No on-screen window for PID \(processID) is at least \(minimumWidth)x\(minimumHeight)")
} else {
    fail("More than one eligible window belongs to PID \(processID); refusing an ambiguous capture")
}

print("\(selected.id) \(selected.width) \(selected.height)")
