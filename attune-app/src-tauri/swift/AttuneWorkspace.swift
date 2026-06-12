import AppKit
import Foundation

@_cdecl("attune_get_frontmost_app")
public func attune_get_frontmost_app(
    _ nameBuffer: UnsafeMutablePointer<CChar>?,
    _ bundleBuffer: UnsafeMutablePointer<CChar>?,
    _ bufferLen: Int32
) -> Bool {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return false
    }

    let name = app.localizedName ?? "Unknown"
    let bundle = app.bundleIdentifier ?? "unknown"

    if let nameBuffer = nameBuffer, bufferLen > 0 {
        strncpy(nameBuffer, name, Int(bufferLen) - 1)
        nameBuffer[Int(bufferLen) - 1] = 0
    }

    if let bundleBuffer = bundleBuffer, bufferLen > 0 {
        strncpy(bundleBuffer, bundle, Int(bufferLen) - 1)
        bundleBuffer[Int(bufferLen) - 1] = 0
    }

    return true
}
