import Foundation

/// Match the web editor's schema-v3 output stage: preserve channel balance by normalizing one
/// shared peak only when the mixed signal exceeds full scale.
enum EditorAudioOutputContract {
  static func peakNormalize(_ samples: inout [Float]) {
    var peak: Float = 1
    for sample in samples { peak = max(peak, abs(sample)) }
    if peak > 1 { for index in samples.indices { samples[index] /= peak } }
  }
}
