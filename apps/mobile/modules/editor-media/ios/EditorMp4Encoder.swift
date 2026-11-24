import AVFoundation
import Accelerate
import Foundation

final class EditorMp4Encoder {
  let identity: EditorMediaIdentity, sessionId: String, artifactId: String, folder: URL
  private let paths: EditorMediaPaths, writer: AVAssetWriter, video: AVAssetWriterInput
  private let audio: AVAssetWriterInput?, audioData: Data?, audioFormat: CMAudioFormatDescription?
  private let audioArtifactId: String?, audioFolder: URL?
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private let width: Int, height: Int, fps: Int
  private let preservesAlpha: Bool, codec: String
  let projectGeneration: Int
  private let partial: URL, output: URL
  private(set) var lastActivity = Date(), framesWritten = 0, cancelled = false
  var progress: Double { min(0.99, Double(framesWritten) / Double(min(1800, fps * 30))) }
  private var lastTimestamp: Int64 = -1, audioOffset = 0
  private var audioFramesWritten: Int64 = 0, audioMarkedFinished = false

  init(identity: EditorMediaIdentity, projectGeneration: Int,
       request: BeginEncodeRequest, paths: EditorMediaPaths) throws {
    let hasAudio = request.audioArtifactId != nil
    let audioBitRate = hasAudio ? request.audioBitRate ?? 192_000 : 0
    guard (100_000...50_000_000).contains(request.videoBitRate),
          request.audioBitRate == nil || hasAudio,
          !hasAudio || (64_000...512_000).contains(audioBitRate) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-encode-settings")
    }
    let projectedMaximum = (request.videoBitRate + audioBitRate) * 30 / 8 + 1_048_576
    guard (1...1280).contains(request.width), (1...1280).contains(request.height),
          request.width * request.height <= 1280 * 720, (1...60).contains(request.fps),
          projectedMaximum <= EditorMediaPaths.mp4Limit else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-encode-settings")
    }
    let alpha = request.alpha == true
    let codec = request.codec ?? "h264"
    guard ["h264", "hevc"].contains(codec), !(alpha && request.codec != nil) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-encode-codec")
    }
    self.identity = identity; self.paths = paths; self.projectGeneration = projectGeneration
    width = request.width; height = request.height; fps = request.fps; preservesAlpha = alpha; self.codec = codec
    sessionId = "vx-session-\(UUID().uuidString.lowercased())"
    let configuredAudio = try request.audioArtifactId.map {
      try Self.configureAudio(identity: identity, projectGeneration: projectGeneration,
        artifactId: $0, bitRate: audioBitRate, paths: paths)
    }
    let reservedBytes = EditorMediaPaths.mp4Limit + EditorMediaPaths.batchLimit
      + EditorMediaPaths.artifactOverhead
    let artifact = try paths.makeArtifact(identity, kind: "mp4", expected: reservedBytes,
      projectGeneration: projectGeneration,
      excluding: Set(configuredAudio.map { [$0.folder.path] } ?? []))
    artifactId = artifact.0; folder = artifact.1
    partial = folder.appendingPathComponent(alpha ? "render.mov.partial" : "render.mp4.partial")
    output = folder.appendingPathComponent(alpha ? "render.mov" : "render.mp4")
    do { writer = try AVAssetWriter(outputURL: partial, fileType: alpha ? .mov : .mp4) }
    catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
    var compression: [String: Any] = [AVVideoAverageBitRateKey: request.videoBitRate,
      AVVideoExpectedSourceFrameRateKey: request.fps, AVVideoMaxKeyFrameIntervalKey: request.fps * 2]
    if !alpha && codec == "h264" { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
    let color: [String: Any] = [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2]
    let videoCodec: AVVideoCodecType = alpha ? .hevcWithAlpha : codec == "hevc" ? .hevc : .h264
    video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: videoCodec,
      AVVideoWidthKey: request.width, AVVideoHeightKey: request.height,
      AVVideoCompressionPropertiesKey: compression, AVVideoColorPropertiesKey: color])
    video.expectsMediaDataInRealTime = false
    audio = configuredAudio?.input; audioData = configuredAudio?.data
    audioFormat = configuredAudio?.format; audioArtifactId = request.audioArtifactId
    audioFolder = configuredAudio?.folder
    adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: request.width, kCVPixelBufferHeightKey as String: request.height,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]])
    guard writer.canAdd(video), audio.map(writer.canAdd) ?? true else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.unsupportedCodec)
    }
    writer.add(video); if let audio { writer.add(audio) }
    guard writer.startWriting() else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed)
    }
    writer.startSession(atSourceTime: .zero)
  }

  func append(_ records: [FrameRecord], cancelledExternally: () -> Bool) throws -> [String: Any] {
    defer { EditorFrameDescriptor.discard(records, paths: paths, identity: identity) }
    guard !records.isEmpty, records.count <= 8 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-frame-batch")
    }
    guard !cancelled, !cancelledExternally() else { throw EditorMediaFailure.result(.cancelled) }
    let frames = try records.map { try EditorFrameDescriptor.parse($0, paths: paths, identity: identity) }
    guard frames.reduce(0, { $0 + $1.width * $1.height * 4 }) <= 32 * 1024 * 1024 else {
      throw EditorMediaFailure.result(.invalidInput, "frame-batch-too-large")
    }
    try paths.ensureHardQuota()
    for frame in frames {
      if cancelledExternally() { throw EditorMediaFailure.result(.cancelled) }
      guard frame.width == width, frame.height == height, frame.index == framesWritten,
            frame.index < min(1800, fps * 30),
            abs(frame.timestampUs - Int64((Double(frame.index) * 1_000_000 / Double(fps)).rounded())) <= 1,
            frame.timestampUs > lastTimestamp else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-frame-sequence")
      }
      try waitUntilReady(video, stage: "video", cancelledExternally: cancelledExternally)
      guard let pool = adaptor.pixelBufferPool else { throw EditorMediaFailure.result(.writeFailed) }
      var buffer: CVPixelBuffer?
      guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buffer) == kCVReturnSuccess,
            let buffer else { throw EditorMediaFailure.result(.writeFailed) }
      let data: Data
      do { data = try Data(contentsOf: frame.url, options: .mappedIfSafe) }
      catch { throw EditorMediaFailure.result(.writeFailed) }
      try fill(buffer, rgba: data)
      let time = CMTime(value: frame.timestampUs, timescale: 1_000_000)
      guard adaptor.append(buffer, withPresentationTime: time) else {
        throw EditorMediaFailure.result(.writeFailed, "video-append-failed")
      }
      framesWritten += 1; lastTimestamp = frame.timestampUs; lastActivity = Date()
      // AVAssetWriter needs bounded look-ahead on the other track before it drains its video
      // queue. Keep PCM one second ahead, then end the writer session at the exact video
      // duration in finish so an early finish cannot lengthen the published artifact.
      let acceptedAudioFrames = Int64((Double(framesWritten) * 48_000 / Double(fps)).rounded())
      let watermark = acceptedAudioFrames + 48_000
      try appendAudio(upToFrame: watermark, cancelledExternally: cancelledExternally)
    }
    try paths.ensureHardQuota()
    return ["ok": true, "sessionId": sessionId, "framesWritten": framesWritten]
  }

  func finish(audioArtifactId: String?, cancelledExternally: () -> Bool,
              validBeforePublish: () -> Bool) throws -> [String: Any] {
    guard !cancelled, !cancelledExternally() else { throw EditorMediaFailure.result(.cancelled) }
    guard audioArtifactId == nil else {
      throw EditorMediaFailure.result(.invalidInput, "audio-bound-at-begin")
    }
    guard framesWritten > 0 else { throw EditorMediaFailure.result(.invalidInput, "frame-count-mismatch") }
    let finalAudioFrame = Int64((Double(framesWritten) * 48_000 / Double(fps)).rounded())
    if audio != nil {
      let availableAudioFrames = Int64((audioData?.count ?? 0) / 8)
      let oneVideoFrame = Int64(ceil(48_000 / Double(fps)))
      guard availableAudioFrames + oneVideoFrame >= finalAudioFrame else {
        throw EditorMediaFailure.result(.invalidInput, "audio-too-short")
      }
    }
    lastActivity = Date()
    if audio != nil {
      try appendAudio(upToFrame: finalAudioFrame, cancelledExternally: cancelledExternally)
    }
    writer.endSession(atSourceTime: CMTime(value: Int64(framesWritten), timescale: CMTimeScale(fps)))
    video.markAsFinished()
    if let audio, !audioMarkedFinished { audio.markAsFinished(); audioMarkedFinished = true }
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    let deadline = Date().addingTimeInterval(90)
    while done.wait(timeout: .now() + 0.1) != .success {
      if cancelledExternally() { cancel(); throw EditorMediaFailure.result(.cancelled) }
      if Date() >= deadline { cancel(); throw EditorMediaFailure.result(.writeFailed) }
    }
    guard writer.status == .completed else { cancel(); throw EditorMediaFailure.result(.writeFailed) }
    guard validBeforePublish(), !cancelledExternally() else {
      cancel(); throw EditorMediaFailure.result(.cancelled)
    }
    do { try FileManager.default.moveItem(at: partial, to: output) }
    catch { cancel(); throw EditorMediaFailure.result(.writeFailed) }
    let actualCodec: String
    do { actualCodec = try inspectVideoCodec() }
    catch { cancel(); throw error }
    let expectedCodec = preservesAlpha ? "hvc1-alpha" : codec == "hevc" ? "hvc1" : "avc1"
    guard actualCodec == expectedCodec else {
      cancel(); throw EditorMediaFailure.result(.unsupportedCodec, "encoded-codec-mismatch")
    }
    guard validBeforePublish(), !cancelledExternally() else {
      cancel(); throw EditorMediaFailure.result(.cancelled)
    }
    do { try paths.ensureHardQuota() }
    catch { cancel(); throw error }
    let size = ((try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    try paths.markComplete(folder, bytes: size, limit: EditorMediaPaths.mp4Limit,
      kind: "mp4", projectGeneration: projectGeneration)
    guard validBeforePublish(), !cancelledExternally() else {
      cancel(); throw EditorMediaFailure.result(.cancelled)
    }
    let durationUs = Int64((Double(framesWritten) * 1_000_000 / Double(fps)).rounded())
    var result: [String: Any] = ["ok": true, "artifactId": artifactId, "uri": output.absoluteString,
      "kind": "mp4", "size": size, "frames": framesWritten, "width": width, "height": height,
      "fps": fps, "durationUs": durationUs, "videoCodec": actualCodec]
    if self.audioArtifactId != nil {
      result["audioCodec"] = "mp4a"; result["audioSampleRate"] = 48_000; result["audioChannels"] = 2
    }
    return result
  }

  func cancel() {
    guard !cancelled else { return }
    cancelled = true; writer.cancelWriting(); try? FileManager.default.removeItem(at: folder)
  }
  func isIdle(at now: Date = Date()) -> Bool { now.timeIntervalSince(lastActivity) >= 30 }
  func ownsAudioArtifact(account: String, project: String, artifactId: String) -> Bool {
    identity.account == account && identity.project == project && audioArtifactId == artifactId
  }
  func cleanupExclusions() -> Set<String> {
    Set([folder.path] + (audioFolder.map { [$0.path] } ?? []))
  }

  private func inspectVideoCodec() throws -> String {
    let asset = AVURLAsset(url: output)
    guard let track = asset.tracks(withMediaType: .video).first,
          let rawDescription = track.formatDescriptions.first else {
      throw EditorMediaFailure.result(.writeFailed, "missing-video-format")
    }
    let description = rawDescription as! CMFormatDescription
    let subtype = CMFormatDescriptionGetMediaSubType(description)
    if subtype == kCMVideoCodecType_H264 { return "avc1" }
    if subtype == kCMVideoCodecType_HEVC { return preservesAlpha ? "hvc1-alpha" : "hvc1" }
    throw EditorMediaFailure.result(.unsupportedCodec, "unexpected-video-codec")
  }

  private func fill(_ pixel: CVPixelBuffer, rgba: Data) throws {
    CVPixelBufferLockBaseAddress(pixel, [])
    defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
    guard let base = CVPixelBufferGetBaseAddress(pixel) else { throw EditorMediaFailure.result(.writeFailed) }
    let destinationStride = CVPixelBufferGetBytesPerRow(pixel)
    let error: vImage_Error = rgba.withUnsafeBytes { raw in
      guard let source = raw.baseAddress else { return kvImageNullPointerArgument }
      var sourceBuffer = vImage_Buffer(data: UnsafeMutableRawPointer(mutating: source),
        height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width * 4)
      var destinationBuffer = vImage_Buffer(data: base, height: vImagePixelCount(height),
        width: vImagePixelCount(width), rowBytes: destinationStride)
      let map: [UInt8] = [2, 1, 0, 3]
      return map.withUnsafeBufferPointer {
        vImagePermuteChannels_ARGB8888(&sourceBuffer, &destinationBuffer, $0.baseAddress!,
          vImage_Flags(kvImageNoFlags))
      }
    }
    guard error == kvImageNoError else { throw EditorMediaFailure.result(.writeFailed) }
  }

  private func waitUntilReady(_ input: AVAssetWriterInput, stage: String,
                              cancelledExternally: () -> Bool) throws {
    let deadline = Date().addingTimeInterval(10)
    while !input.isReadyForMoreMediaData {
      if cancelled || cancelledExternally() { throw EditorMediaFailure.result(.cancelled) }
      if writer.status == .failed || writer.status == .cancelled {
        throw EditorMediaFailure.result(.writeFailed, "writer-failed-\(stage)")
      }
      if Date() >= deadline {
        throw EditorMediaFailure.result(.writeFailed, "\(stage)-backpressure-timeout")
      }
      Thread.sleep(forTimeInterval: 0.002)
    }
  }

  private static func configureAudio(identity: EditorMediaIdentity, projectGeneration: Int,
                                     artifactId: String, bitRate: Int, paths: EditorMediaPaths) throws
    -> (input: AVAssetWriterInput, data: Data, format: CMAudioFormatDescription, folder: URL) {
    let folder = try paths.artifactFolder(identity.account, project: identity.project, artifactId: artifactId)
    let url = try paths.artifactFile(folder, name: "audio.f32le")
    let manifestURL = try paths.artifactFile(folder, name: "pcm.json")
    let artifactURL = try paths.artifactFile(folder, name: "artifact.json")
    guard let manifestData = try? Data(contentsOf: manifestURL),
          let manifest = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          let artifactData = try? Data(contentsOf: artifactURL),
          let artifact = try? JSONSerialization.jsonObject(with: artifactData) as? [String: Any],
          artifact["projectGeneration"] as? Int == projectGeneration, artifact["kind"] as? String == "pcm",
          manifest["version"] as? Int == 1, manifest["format"] as? String == "f32le-interleaved",
          manifest["sampleRate"] as? Int == 48_000, manifest["channels"] as? Int == 2,
          let manifestBytes = manifest["bytes"] as? Int, let manifestFrames = manifest["frames"] as? Int,
          artifact["bytes"] as? Int == manifestBytes else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-pcm-artifact")
    }
    guard let data = try? Data(contentsOf: url, options: .mappedIfSafe), !data.isEmpty,
          data.count == manifestBytes, data.count <= EditorMediaPaths.pcmLimit, data.count % 8 == 0,
          manifestFrames == data.count / 8 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-pcm-artifact")
    }
    var asbd = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 8,
      mFramesPerPacket: 1, mBytesPerFrame: 8, mChannelsPerFrame: 2, mBitsPerChannel: 32, mReserved: 0)
    var format: CMAudioFormatDescription?
    guard CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd,
      layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil,
      extensions: nil, formatDescriptionOut: &format) == noErr, let format else {
      throw EditorMediaFailure.result(.writeFailed)
    }
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: bitRate], sourceFormatHint: format)
    input.expectsMediaDataInRealTime = false
    return (input, data, format, folder)
  }

  private func appendAudio(upToFrame requestedFrame: Int64,
                           cancelledExternally: () -> Bool) throws {
    guard let audio, let data = audioData, let format = audioFormat, !audioMarkedFinished else { return }
    let totalFrames = Int64(data.count / 8), targetFrame = min(totalFrames, max(0, requestedFrame))
    let chunkFrames = 4096
    while audioFramesWritten < targetFrame {
      if cancelledExternally() { throw EditorMediaFailure.result(.cancelled) }
      try waitUntilReady(audio, stage: "audio", cancelledExternally: cancelledExternally)
      let sampleCount = Int(min(Int64(chunkFrames), targetFrame - audioFramesWritten))
      let length = sampleCount * 8
      var block: CMBlockBuffer?
      guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
        blockLength: length, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
        offsetToData: 0, dataLength: length, flags: 0, blockBufferOut: &block) == noErr, let block else {
        throw EditorMediaFailure.result(.writeFailed, "audio-append-failed")
      }
      let copied = data.withUnsafeBytes { raw in
        CMBlockBufferReplaceDataBytes(with: raw.baseAddress!.advanced(by: audioOffset), blockBuffer: block,
          offsetIntoDestination: 0, dataLength: length)
      }
      guard copied == noErr else { throw EditorMediaFailure.result(.writeFailed) }
      var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48_000),
        presentationTimeStamp: CMTime(value: audioFramesWritten, timescale: 48_000), decodeTimeStamp: .invalid)
      var sampleSize = 8, sample: CMSampleBuffer?
      guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block,
        formatDescription: format, sampleCount: sampleCount, sampleTimingEntryCount: 1,
        sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &sampleSize,
        sampleBufferOut: &sample) == noErr, let sample, audio.append(sample) else {
        throw EditorMediaFailure.result(.writeFailed)
      }
      audioOffset += length; audioFramesWritten += Int64(sampleCount)
    }
    if audioFramesWritten == totalFrames {
      audio.markAsFinished(); audioMarkedFinished = true
    }
  }
}
