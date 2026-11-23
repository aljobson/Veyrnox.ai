import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import Vision

/// Bounded native implementations for the two editor motion tools that need
/// spatially local analysis. The Expo module owns admission, artifact lifetime,
/// batching and generation fencing; callers pass that fence through `cancelled`.
enum EditorAdvancedMotion {
  static let minimumIOS = "16.4"
  static let batchSize = 8
  static let maximumFrames = 1_800
  static let maximumOpticalHeight = 480
  private static let maximumOpticalPixels = 1280 * maximumOpticalHeight
  private static let maximumLostFrames = 8
  private static let ci = CIContext(options: [.cacheIntermediates: false])

  enum Failure: Error {
    case invalidInput
    case cancelled
    case opticalFlowUnavailable
    case corruptFrame
  }

  struct Region: Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    var centreX: Double { x + width / 2 }
    var centreY: Double { y + height / 2 }

    init(x: Double, y: Double, width: Double, height: Double) throws {
      guard [x, y, width, height].allSatisfy(\.isFinite), width >= 0.05, height >= 0.05,
            x >= 0, y >= 0, x + width <= 1, y + height <= 1 else {
        throw Failure.invalidInput
      }
      self.x = x
      self.y = y
      self.width = width
      self.height = height
    }
  }

  struct TrackSample: Equatable {
    let x: Double
    let y: Double
    let confidence: Double
    let tracked: Bool
    let lostFrames: Int
  }

  /// Uses full-resolution, bidirectional Vision flow. Each output pixel is
  /// warped independently, with forward/backward consistency deciding whether
  /// either source is trustworthy. Untextured or inconsistent areas use the
  /// nearest source frame instead of dissolving two unaligned pictures.
  static func interpolate(_ from: CGImage, _ to: CGImage, fraction: Double,
                          width: Int, height: Int, cancelled: () -> Bool) throws -> Data {
    guard fraction.isFinite, (0...1).contains(fraction), width >= 8, height >= 8,
          height <= maximumOpticalHeight, width <= 1280, width * height <= maximumOpticalPixels else {
      throw Failure.invalidInput
    }
    try check(cancelled)
    let firstBuffer = try pixelBuffer(from, width: width, height: height)
    let secondBuffer = try pixelBuffer(to, width: width, height: height)
    let first = try PixelFrame(firstBuffer)
    let second = try PixelFrame(secondBuffer)
    if fraction == 0 { return first.rgbaData }
    if fraction == 1 { return second.rgbaData }

    let forward = try opticalFlow(from: firstBuffer, to: secondBuffer, cancelled: cancelled)
    let backward = try opticalFlow(from: secondBuffer, to: firstBuffer, cancelled: cancelled)
    try check(cancelled)

    // Reject scene cuts and flat frames before the per-pixel pass. A local
    // foreground is sufficient because reliable coverage is measured across
    // the full image, while every accepted pixel still has its own vector.
    let reliable = try reliableCoverage(first: first, second: second, forward: forward,
      backward: backward, cancelled: cancelled) >= 0.12
    if !reliable { return fraction < 0.5 ? first.rgbaData : second.rgbaData }

    var output = Data(count: width * height * 4)
    try output.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
        throw Failure.corruptFrame
      }
      for y in 0..<height {
        if y.isMultiple(of: 8) { try check(cancelled) }
        for x in 0..<width {
          let pointX = Double(x), pointY = Double(y)
          let f = forward.sample(x: pointX, y: pointY)
          let b = backward.sample(x: pointX, y: pointY)
          let safeF = f.finite ? f : Vector(x: 0, y: 0)
          let safeB = b.finite ? b : Vector(x: 0, y: 0)
          let ax = pointX - fraction * safeF.x, ay = pointY - fraction * safeF.y
          let bx = pointX - (1 - fraction) * safeB.x, by = pointY - (1 - fraction) * safeB.y
          let reverseAtForward = backward.sample(x: pointX + safeF.x, y: pointY + safeF.y)
          let forwardAtBackward = forward.sample(x: pointX + safeB.x, y: pointY + safeB.y)
          let trustFirst = first.textured(x: ax, y: ay)
            && consistent(f, reverseAtForward)
          let trustSecond = second.textured(x: bx, y: by)
            && consistent(b, forwardAtBackward)
          let offset = (y * width + x) * 4
          for rgba in 0..<4 {
            let channel = rgba == 0 ? 2 : rgba == 2 ? 0 : rgba // BGRA -> RGBA
            let a = first.sample(x: ax, y: ay, channel: channel)
            let bValue = second.sample(x: bx, y: by, channel: channel)
            let value: Double
            if trustFirst && trustSecond { value = a * (1 - fraction) + bValue * fraction }
            else if trustFirst { value = a }
            else if trustSecond { value = bValue }
            else { value = fraction < 0.5 ? first.value(x: x, y: y, channel: channel) : second.value(x: x, y: y, channel: channel) }
            base[offset + rgba] = UInt8(max(0, min(255, Int(value.rounded()))))
          }
        }
      }
    }
    try check(cancelled)
    return output
  }

  /// Tracks the selected region with Vision and returns a crop centre per
  /// source frame. Confidence and geometry must both verify a step. If the
  /// subject is lost, framing deterministically holds the last verified centre;
  /// after eight misses tracking is latched off for the remainder of the clip.
  static func trackReframe(frameCount: Int, frameRate: Int, region: Region, smoothing: Int,
                           frame: (Int) throws -> CGImage, cancelled: () -> Bool,
                           progress: (Double) -> Void = { _ in }) throws -> [TrackSample] {
    guard (1...maximumFrames).contains(frameCount), [24, 25, 30, 50, 60].contains(frameRate),
          (1...30).contains(smoothing), Double(frameCount) / Double(frameRate) <= 30 else {
      throw Failure.invalidInput
    }
    try check(cancelled)
    var observation = VNDetectedObjectObservation(boundingBox: visionBox(region))
    let handler = VNSequenceRequestHandler()
    var raw = [TrackSample(x: region.centreX, y: region.centreY, confidence: 1,
      tracked: true, lostFrames: 0)]
    var lastVerified = observation
    var lostFrames = 0
    var latchedLost = false

    if frameCount > 1 {
      for index in 1..<frameCount {
        try check(cancelled)
        let image = try frame(index)
        var next: VNDetectedObjectObservation?
        if !latchedLost {
          let request = VNTrackObjectRequest(detectedObjectObservation: lastVerified)
          request.trackingLevel = .accurate
          do {
            try handler.perform([request], on: image, orientation: .up)
            let observations = request.results as? [VNDetectedObjectObservation]
            next = observations?.first
          } catch {
            next = nil
          }
        }
        if let next, verified(next, after: lastVerified) {
          observation = next
          lastVerified = next
          lostFrames = 0
          let box = topLeftBox(next.boundingBox)
          raw.append(TrackSample(x: box.midX, y: box.midY,
            confidence: Double(next.confidence), tracked: true, lostFrames: 0))
        } else {
          lostFrames += 1
          if lostFrames >= maximumLostFrames { latchedLost = true }
          let held = topLeftBox(observation.boundingBox)
          raw.append(TrackSample(x: held.midX, y: held.midY,
            confidence: 0, tracked: false, lostFrames: lostFrames))
        }
        if index.isMultiple(of: 3) || index == frameCount - 1 {
          progress(Double(index + 1) / Double(frameCount))
        }
      }
    } else { progress(1) }
    try check(cancelled)
    return smooth(raw, radius: smoothing, frameRate: frameRate)
  }

  /// Pure deterministic smoothing seam used by fixture tests and by tracking.
  /// The path is zero-phase averaged, then limited to 1.5 picture widths/second.
  static func smooth(_ samples: [TrackSample], radius: Int, frameRate: Int) -> [TrackSample] {
    guard !samples.isEmpty, samples.count <= maximumFrames, (1...30).contains(radius), frameRate > 0 else { return samples }
    let maxStep = 1.5 / Double(frameRate)
    var averaged = samples
    for index in samples.indices {
      let low = max(0, index - radius), high = min(samples.count - 1, index + radius)
      let window = samples[low...high]
      averaged[index] = TrackSample(x: window.reduce(0) { $0 + $1.x } / Double(window.count),
        y: window.reduce(0) { $0 + $1.y } / Double(window.count),
        confidence: samples[index].confidence, tracked: samples[index].tracked,
        lostFrames: samples[index].lostFrames)
    }
    var result = averaged
    for index in 1..<averaged.count {
      let dx = averaged[index].x - result[index - 1].x
      let dy = averaged[index].y - result[index - 1].y
      let distance = hypot(dx, dy)
      let scale = distance > maxStep ? maxStep / distance : 1
      result[index] = TrackSample(x: clamp(result[index - 1].x + dx * scale),
        y: clamp(result[index - 1].y + dy * scale), confidence: averaged[index].confidence,
        tracked: averaged[index].tracked, lostFrames: averaged[index].lostFrames)
    }
    return result
  }

  private struct Vector {
    let x: Double
    let y: Double
    var finite: Bool { x.isFinite && y.isFinite }
  }

  private struct FlowField {
    let width: Int
    let height: Int
    let values: [Float]

    init(_ buffer: CVPixelBuffer) throws {
      guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_TwoComponent32Float else {
        throw Failure.opticalFlowUnavailable
      }
      width = CVPixelBufferGetWidth(buffer)
      height = CVPixelBufferGetHeight(buffer)
      guard width >= 8, height >= 8 else { throw Failure.opticalFlowUnavailable }
      CVPixelBufferLockBaseAddress(buffer, .readOnly)
      defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
      guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw Failure.opticalFlowUnavailable }
      let rowFloats = CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float>.size
      var result = [Float](repeating: 0, count: width * height * 2)
      let source = base.assumingMemoryBound(to: Float.self)
      for y in 0..<height {
        for x in 0..<width * 2 { result[y * width * 2 + x] = source[y * rowFloats + x] }
      }
      values = result
    }

    func sample(x: Double, y: Double) -> Vector {
      let px = min(Double(width - 1), max(0, x)), py = min(Double(height - 1), max(0, y))
      let x0 = Int(px), y0 = Int(py), x1 = min(width - 1, x0 + 1), y1 = min(height - 1, y0 + 1)
      let fx = px - Double(x0), fy = py - Double(y0)
      func component(_ x: Int, _ y: Int, _ c: Int) -> Double { Double(values[(y * width + x) * 2 + c]) }
      func blend(_ c: Int) -> Double {
        component(x0, y0, c) * (1 - fx) * (1 - fy) + component(x1, y0, c) * fx * (1 - fy)
          + component(x0, y1, c) * (1 - fx) * fy + component(x1, y1, c) * fx * fy
      }
      return Vector(x: blend(0), y: blend(1))
    }
  }

  private struct PixelFrame {
    let width: Int
    let height: Int
    let bytes: [UInt8]

    init(_ buffer: CVPixelBuffer) throws {
      guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA else { throw Failure.corruptFrame }
      let pixelWidth = CVPixelBufferGetWidth(buffer), pixelHeight = CVPixelBufferGetHeight(buffer)
      width = pixelWidth
      height = pixelHeight
      CVPixelBufferLockBaseAddress(buffer, .readOnly)
      defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
      guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw Failure.corruptFrame }
      let rowBytes = CVPixelBufferGetBytesPerRow(buffer)
      var result = [UInt8](repeating: 0, count: pixelWidth * pixelHeight * 4)
      let source = base.assumingMemoryBound(to: UInt8.self)
      for y in 0..<pixelHeight {
        result.withUnsafeMutableBytes { target in
          target.baseAddress!.advanced(by: y * pixelWidth * 4)
            .copyMemory(from: source.advanced(by: y * rowBytes), byteCount: pixelWidth * 4)
        }
      }
      bytes = result
    }

    var rgbaData: Data {
      var result = Data(count: bytes.count)
      result.withUnsafeMutableBytes { raw in
        let target = raw.baseAddress!.assumingMemoryBound(to: UInt8.self)
        for offset in stride(from: 0, to: bytes.count, by: 4) {
          target[offset] = bytes[offset + 2]
          target[offset + 1] = bytes[offset + 1]
          target[offset + 2] = bytes[offset]
          target[offset + 3] = bytes[offset + 3]
        }
      }
      return result
    }

    func value(x: Int, y: Int, channel: Int) -> Double {
      Double(bytes[(min(height - 1, max(0, y)) * width + min(width - 1, max(0, x))) * 4 + channel])
    }

    func sample(x: Double, y: Double, channel: Int) -> Double {
      let px = min(Double(width - 1), max(0, x)), py = min(Double(height - 1), max(0, y))
      let x0 = Int(px), y0 = Int(py), x1 = min(width - 1, x0 + 1), y1 = min(height - 1, y0 + 1)
      let fx = px - Double(x0), fy = py - Double(y0)
      return value(x: x0, y: y0, channel: channel) * (1 - fx) * (1 - fy)
        + value(x: x1, y: y0, channel: channel) * fx * (1 - fy)
        + value(x: x0, y: y1, channel: channel) * (1 - fx) * fy
        + value(x: x1, y: y1, channel: channel) * fx * fy
    }

    func textured(x: Double, y: Double) -> Bool {
      let left = luminance(x: x - 1, y: y), right = luminance(x: x + 1, y: y)
      let top = luminance(x: x, y: y - 1), bottom = luminance(x: x, y: y + 1)
      return abs(right - left) + abs(bottom - top) >= 6
    }

    private func luminance(x: Double, y: Double) -> Double {
      sample(x: x, y: y, channel: 2) * 0.2126 + sample(x: x, y: y, channel: 1) * 0.7152
        + sample(x: x, y: y, channel: 0) * 0.0722
    }
  }

  private static func opticalFlow(from: CVPixelBuffer, to: CVPixelBuffer,
                                  cancelled: () -> Bool) throws -> FlowField {
    try check(cancelled)
    let request = VNGenerateOpticalFlowRequest(targetedCVPixelBuffer: to, options: [:]) { _, _ in }
    request.computationAccuracy = .high
    request.outputPixelFormat = kCVPixelFormatType_TwoComponent32Float
    request.revision = VNGenerateOpticalFlowRequestRevision2
    let handler = VNImageRequestHandler(cvPixelBuffer: from, orientation: .up, options: [:])
    do { try handler.perform([request]) }
    catch { throw Failure.opticalFlowUnavailable }
    try check(cancelled)
    guard let observation = request.results?.first else { throw Failure.opticalFlowUnavailable }
    let field = try FlowField(observation.pixelBuffer)
    guard field.width == CVPixelBufferGetWidth(from), field.height == CVPixelBufferGetHeight(from) else {
      throw Failure.opticalFlowUnavailable
    }
    return field
  }

  private static func pixelBuffer(_ image: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {
    var output: CVPixelBuffer?
    let attributes: [CFString: Any] = [kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true]
    guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
      attributes as CFDictionary, &output) == kCVReturnSuccess, let output else {
      throw Failure.corruptFrame
    }
    var value = CIImage(cgImage: image)
    value = value.transformed(by: CGAffineTransform(translationX: -value.extent.minX, y: -value.extent.minY))
    let scale = max(CGFloat(width) / value.extent.width, CGFloat(height) / value.extent.height)
    value = value.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let x = (value.extent.width - CGFloat(width)) / 2, y = (value.extent.height - CGFloat(height)) / 2
    value = value.transformed(by: CGAffineTransform(translationX: -x, y: -y))
      .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
    ci.render(value, to: output, bounds: CGRect(x: 0, y: 0, width: width, height: height),
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return output
  }

  private static func reliableCoverage(first: PixelFrame, second: PixelFrame, forward: FlowField,
                                       backward: FlowField, cancelled: () -> Bool) throws -> Double {
    var reliable = 0, total = 0
    for y in stride(from: 4, to: first.height - 4, by: 8) {
      try check(cancelled)
      for x in stride(from: 4, to: first.width - 4, by: 8) {
        total += 1
        let f = forward.sample(x: Double(x), y: Double(y)), b = backward.sample(x: Double(x), y: Double(y))
        guard f.finite || b.finite else { continue }
        let safeF = f.finite ? f : Vector(x: 0, y: 0)
        let safeB = b.finite ? b : Vector(x: 0, y: 0)
        let rb = backward.sample(x: Double(x) + safeF.x, y: Double(y) + safeF.y)
        let ff = forward.sample(x: Double(x) + safeB.x, y: Double(y) + safeB.y)
        if (first.textured(x: Double(x), y: Double(y)) && consistent(f, rb))
          || (second.textured(x: Double(x), y: Double(y)) && consistent(b, ff)) { reliable += 1 }
      }
    }
    return total > 0 ? Double(reliable) / Double(total) : 0
  }

  private static func consistent(_ vector: Vector, _ reverse: Vector) -> Bool {
    vector.finite && reverse.finite && abs(vector.x) <= 128 && abs(vector.y) <= 128
      && hypot(vector.x + reverse.x, vector.y + reverse.y) <= 2.5
  }

  private static func verified(_ candidate: VNDetectedObjectObservation,
                               after previous: VNDetectedObjectObservation) -> Bool {
    let box = candidate.boundingBox, old = previous.boundingBox
    guard candidate.confidence >= 0.25, [box.minX, box.minY, box.width, box.height].allSatisfy(\.isFinite),
          box.width >= 0.05, box.height >= 0.05, box.minX >= 0, box.minY >= 0,
          box.maxX <= 1, box.maxY <= 1 else { return false }
    let sizeRatio = max(box.width / old.width, old.width / box.width,
      box.height / old.height, old.height / box.height)
    let maximumJump = max(0.15, max(old.width, old.height) * 1.5)
    return sizeRatio <= 2 && hypot(box.midX - old.midX, box.midY - old.midY) <= maximumJump
  }

  private static func visionBox(_ region: Region) -> CGRect {
    CGRect(x: region.x, y: 1 - region.y - region.height, width: region.width, height: region.height)
  }

  private static func topLeftBox(_ box: CGRect) -> CGRect {
    CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
  }

  private static func check(_ cancelled: () -> Bool) throws {
    if cancelled() { throw Failure.cancelled }
  }

  private static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
}
