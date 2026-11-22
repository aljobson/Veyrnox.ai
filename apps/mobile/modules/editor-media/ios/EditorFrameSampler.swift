import AVFoundation
import CoreImage
import Foundation
import ImageIO

enum EditorFrameSampler {
  private static let context = CIContext(options: [.cacheIntermediates: false])

  static func inspect(url: URL) throws -> [String: Any] {
    let (asset, duration) = try readableAsset(url)
    let video = asset.tracks(withMediaType: .video).first, audio = asset.tracks(withMediaType: .audio).first
    var result: [String: Any] = ["ok": true, "duration": duration, "hasVideo": video != nil, "hasAudio": audio != nil]
    if let track = video {
      let oriented = try orientedSize(track)
      result["width"] = Int(oriented.width.rounded()); result["height"] = Int(oriented.height.rounded())
      result["transform"] = transformArray(track.preferredTransform)
      result["nominalFrameRate"] = Double(track.nominalFrameRate)
      addVerification(track, prefix: "video", to: &result)
    }
    if let track = audio { addVerification(track, prefix: "audio", to: &result) }
    return result
  }

  static func sample(identity: EditorMediaIdentity, projectGeneration: Int, request: SampleFramesRequest,
                     paths: EditorMediaPaths, cancelled: () -> Bool,
                     progress: (Double) -> Void) throws -> [String: Any] {
    guard request.fromSeconds.isFinite, request.toSeconds.isFinite, request.fromSeconds >= 0,
          request.toSeconds > request.fromSeconds, request.toSeconds - request.fromSeconds <= 30,
          (1...900).contains(request.maxFrames) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-sample-range")
    }
    let input = try paths.inputURL(request.uri, identity: identity)
    let (asset, _) = try readableAsset(input)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw EditorMediaFailure.result(.unsupportedCodec, "video-track-missing")
    }
    let orientation = try imageOrientation(track.preferredTransform)
    let oriented = try orientedSize(track)
    guard max(oriented.width, oriented.height) <= 1280, min(oriented.width, oriented.height) <= 720 else {
      throw EditorMediaFailure.result(.invalidInput, "source-too-large")
    }
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) }
    catch { throw EditorMediaFailure.result(.corruptMedia) }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw EditorMediaFailure.result(.unsupportedCodec) }
    reader.add(output)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: request.fromSeconds, preferredTimescale: 600_000),
      duration: CMTime(seconds: request.toSeconds - request.fromSeconds, preferredTimescale: 600_000))
    let (artifactId, folder) = try paths.makeArtifact(identity, kind: "frames",
      expected: EditorMediaPaths.frameLimit, projectGeneration: projectGeneration)
    var published = false
    defer { if !published { try? FileManager.default.removeItem(at: folder) } }
    var records: [[String: Any]] = [], bytes = 0
    let range = request.toSeconds - request.fromSeconds
    var nextTarget = request.fromSeconds, previousTimestamp: Int64?
    guard reader.startReading() else { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia) }
    var reachedLimit = false
    while let sample = output.copyNextSampleBuffer() {
      if cancelled() { reader.cancelReading(); try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.cancelled) }
      let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
      guard seconds.isFinite else { continue }
      if seconds + 0.000_001 < nextTarget { continue }
      guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
      let data = try rgba(buffer, orientation: orientation, width: 128, height: 72)
      let timestamp = Int64((seconds * 1_000_000).rounded())
      guard previousTimestamp.map({ timestamp > $0 }) ?? true else {
        reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "duplicate-timestamp")
      }
      let name = String(format: "frame-%06d.rgba", records.count), target = folder.appendingPathComponent(name)
      do { try data.write(to: target, options: .atomic) }
      catch { reader.cancelReading(); try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
      bytes += data.count
      records.append(["file": name, "timestampUs": timestamp]); previousTimestamp = timestamp
      progress(min(1, max(0, (seconds - request.fromSeconds) / range)))
      if records.count >= request.maxFrames { reachedLimit = true; reader.cancelReading(); break }
      nextTarget = request.fromSeconds + range * Double(records.count) / Double(request.maxFrames)
    }
    guard reachedLimit || reader.status == .completed, !records.isEmpty else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia)
    }
    let manifest: [String: Any] = ["version": 1, "format": "rgba8", "width": 128, "height": 72,
      "rowStride": 512, "colorSpace": "srgb", "orientedWidth": Int(oriented.width.rounded()),
      "orientedHeight": Int(oriented.height.rounded()), "transform": transformArray(track.preferredTransform), "frames": records]
    let manifestURL = folder.appendingPathComponent("frames.json")
    do { let encoded = try JSONSerialization.data(withJSONObject: manifest); try encoded.write(to: manifestURL, options: .atomic); bytes += encoded.count }
    catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
    try paths.markComplete(folder, bytes: bytes, limit: EditorMediaPaths.frameLimit,
      kind: "frames", projectGeneration: projectGeneration)
    published = true
    progress(1)
    return ["ok": true, "artifactId": artifactId, "uri": manifestURL.absoluteString, "kind": "frames",
      "size": bytes, "count": records.count, "width": 128, "height": 72, "stride": 512,
      "pixelFormat": "rgba8", "colorSpace": "srgb", "timestampsUs": records.compactMap { $0["timestampUs"] },
      "preferredTransform": transformArray(track.preferredTransform)]
  }

  private static func rgba(_ buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation,
                           width: Int, height: Int) throws -> Data {
    var image = CIImage(cvPixelBuffer: buffer).oriented(orientation)
    let source = image.extent.standardized
    guard source.width > 0, source.height > 0 else { throw EditorMediaFailure.result(.corruptMedia) }
    image = image.transformed(by: CGAffineTransform(translationX: -source.minX, y: -source.minY))
    let scale = min(CGFloat(width) / source.width, CGFloat(height) / source.height)
    image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let scaled = image.extent
    image = image.transformed(by: CGAffineTransform(translationX: (CGFloat(width) - scaled.width) / 2,
      y: (CGFloat(height) - scaled.height) / 2)).composited(over: CIImage(color: .black))
    var data = Data(count: width * height * 4)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    data.withUnsafeMutableBytes { bytes in
      if let base = bytes.baseAddress {
        context.render(image, toBitmap: base, rowBytes: width * 4,
          bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .RGBA8, colorSpace: colorSpace)
      }
    }
    return data
  }
  private static func orientedSize(_ track: AVAssetTrack) throws -> CGSize {
    let orientation = try imageOrientation(track.preferredTransform), size = track.naturalSize
    switch orientation {
    case .leftMirrored, .right, .rightMirrored, .left:
      return CGSize(width: abs(size.height), height: abs(size.width))
    default: return CGSize(width: abs(size.width), height: abs(size.height))
    }
  }
  private static func transformArray(_ t: CGAffineTransform) -> [Double] {
    [t.a, t.b, t.c, t.d, t.tx, t.ty].map(Double.init)
  }
  private static func addVerification(_ track: AVAssetTrack, prefix: String, to result: inout [String: Any]) {
    if let rawDescription = track.formatDescriptions.first {
      let description = rawDescription as! CMFormatDescription
      let subtype = CMFormatDescriptionGetMediaSubType(description)
      let aacTypes: Set<FourCharCode> = [kAudioFormatMPEG4AAC, kAudioFormatMPEG4AAC_HE,
        kAudioFormatMPEG4AAC_HE_V2]
      result["\(prefix)Codec"] = aacTypes.contains(subtype) ? "mp4a" : fourCC(subtype)
    }
    result["\(prefix)StartUs"] = microseconds(track.timeRange.start)
    result["\(prefix)DurationUs"] = microseconds(track.timeRange.duration)
  }
  private static func microseconds(_ value: CMTime) -> Int64 {
    let seconds = CMTimeGetSeconds(value)
    return seconds.isFinite ? Int64((seconds * 1_000_000).rounded()) : 0
  }
  private static func fourCC(_ value: FourCharCode) -> String {
    let bytes = [UInt8((value >> 24) & 0xff), UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff), UInt8(value & 0xff)]
    return String(bytes: bytes, encoding: .ascii) ?? "unknown"
  }
  private static func readableAsset(_ url: URL) throws -> (AVURLAsset, Double) {
    let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values?.isRegularFile == true, (values?.fileSize ?? 0) > 0 else {
      throw EditorMediaFailure.result(.corruptMedia, "empty-media")
    }
    let asset = AVURLAsset(url: url)
    let duration = CMTimeGetSeconds(asset.duration)
    guard asset.isReadable, duration.isFinite, duration > 0, !asset.tracks.isEmpty else {
      throw EditorMediaFailure.result(.corruptMedia, "unreadable-media")
    }
    return (asset, duration)
  }
  private static func imageOrientation(_ transform: CGAffineTransform) throws -> CGImagePropertyOrientation {
    let values = (Double(transform.a), Double(transform.b), Double(transform.c), Double(transform.d))
    let candidates: [(Double, Double, Double, Double, CGImagePropertyOrientation)] = [
      (1, 0, 0, 1, .up), (-1, 0, 0, 1, .upMirrored), (-1, 0, 0, -1, .down),
      (1, 0, 0, -1, .downMirrored), (0, -1, -1, 0, .leftMirrored),
      (0, 1, -1, 0, .right), (0, 1, 1, 0, .rightMirrored), (0, -1, 1, 0, .left)
    ]
    if let match = candidates.first(where: {
      abs(values.0 - $0.0) < 0.01 && abs(values.1 - $0.1) < 0.01
        && abs(values.2 - $0.2) < 0.01 && abs(values.3 - $0.3) < 0.01
    }) { return match.4 }
    throw EditorMediaFailure.result(.corruptMedia, "invalid-transform")
  }
}
