import Foundation

/// Pixel contract shared by static alpha masks and opaque grayscale mask videos.
enum EditorSemanticMaskContract {
  static func confidence(red: UInt8, green: UInt8, blue: UInt8, alpha: UInt8,
                         hasAlpha: Bool) -> UInt8 {
    if hasAlpha { return alpha }
    return UInt8(max(0, min(255, Int((Double(red) * 0.2126 + Double(green) * 0.7152
      + Double(blue) * 0.0722).rounded()))))
  }
}
