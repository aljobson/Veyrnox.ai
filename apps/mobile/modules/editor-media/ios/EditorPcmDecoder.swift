import AVFoundation
import AudioToolbox
import Foundation

enum EditorPcmDecoder {
  private static let maximumSegments = 4096

  static func decode(identity: EditorMediaIdentity, projectGeneration: Int, request: DecodePcmRequest,
                     paths: EditorMediaPaths, cancelled: () -> Bool,
                     progress: (Double) -> Void) throws -> [String: Any] {
    let webAverage = request.mixMode == "web-average"
    guard request.fromSeconds.isFinite, request.toSeconds.isFinite, request.fromSeconds >= 0,
          request.toSeconds > request.fromSeconds, request.toSeconds - request.fromSeconds <= 30,
          request.sampleRate == 48_000, request.channels == 1 || request.channels == 2,
          request.mixMode == nil || webAverage, !webAverage || request.channels == 1 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-pcm-request")
    }
    let input = try paths.inputURL(request.uri, identity: identity)
    let values = try? input.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values?.isRegularFile == true, (values?.fileSize ?? 0) > 0 else {
      throw EditorMediaFailure.result(.corruptMedia, "empty-media")
    }
    let asset = AVURLAsset(url: input)
    let duration = CMTimeGetSeconds(asset.duration)
    guard asset.isReadable, duration.isFinite, duration > 0, !asset.tracks.isEmpty else {
      throw EditorMediaFailure.result(.corruptMedia, "unreadable-media")
    }
    guard let track = asset.tracks(withMediaType: .audio).first else {
      throw EditorMediaFailure.result(.unsupportedCodec, "audio-track-missing")
    }
    let decodedChannels: Int
    if webAverage {
      guard let sourceChannels = sourceChannelCount(track), (1...32).contains(sourceChannels) else {
        throw EditorMediaFailure.result(.unsupportedCodec, "unsupported-channel-layout")
      }
      decodedChannels = sourceChannels
    } else { decodedChannels = request.channels }
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) }
    catch { throw EditorMediaFailure.result(.corruptMedia) }
    var outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: request.sampleRate,
      AVNumberOfChannelsKey: decodedChannels, AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false
    ]
    if webAverage && decodedChannels > 2 {
      guard let channelLayout = discreteChannelLayoutData(decodedChannels) else {
        throw EditorMediaFailure.result(.unsupportedCodec, "unsupported-channel-layout")
      }
      outputSettings[AVChannelLayoutKey] = channelLayout
    }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw EditorMediaFailure.result(.unsupportedCodec) }
    reader.add(output)
    let span = request.toSeconds - request.fromSeconds
    reader.timeRange = CMTimeRange(start: CMTime(seconds: request.fromSeconds, preferredTimescale: 600_000),
      duration: CMTime(seconds: span, preferredTimescale: 600_000))
    let (artifactId, folder) = try paths.makeArtifact(identity, kind: "pcm",
      expected: EditorMediaPaths.pcmLimit, projectGeneration: projectGeneration)
    var published = false
    defer { if !published { try? FileManager.default.removeItem(at: folder) } }
    let rawURL = folder.appendingPathComponent("audio.f32le")
    FileManager.default.createFile(atPath: rawURL.path, contents: nil)
    guard let handle = try? FileHandle(forWritingTo: rawURL) else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed)
    }
    var bytes = 0, frames: Int64 = 0, segments: [[String: Any]] = []
    var previousTimestampUs: Int64?
    defer { try? handle.close() }
    guard reader.startReading() else { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia) }
    while let sample = output.copyNextSampleBuffer() {
      if cancelled() { reader.cancelReading(); try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.cancelled) }
      guard let description = CMSampleBufferGetFormatDescription(sample),
            let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
            basic.mFormatID == kAudioFormatLinearPCM, basic.mSampleRate == 48_000,
            basic.mChannelsPerFrame == UInt32(decodedChannels), basic.mBitsPerChannel == 32,
            basic.mBytesPerFrame == UInt32(4 * decodedChannels),
            basic.mFormatFlags & kAudioFormatFlagIsFloat != 0,
            basic.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0,
            basic.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
            let block = CMSampleBufferGetDataBuffer(sample) else {
        reader.cancelReading(); throw EditorMediaFailure.result(.unsupportedCodec, "unexpected-pcm-format")
      }
      let length = CMBlockBufferGetDataLength(block)
      guard length > 0 else {
        reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "invalid-pcm-buffer")
      }
      let sampleFrames: Int, outputLength: Int
      if webAverage {
        sampleFrames = CMSampleBufferGetNumSamples(sample)
        guard sampleFrames > 0, length == sampleFrames * MemoryLayout<Float>.size * decodedChannels else {
          reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "invalid-pcm-buffer")
        }
        outputLength = sampleFrames * MemoryLayout<Float>.size
      } else {
        sampleFrames = length / (MemoryLayout<Float>.size * request.channels)
        outputLength = length
      }
      guard bytes + outputLength <= EditorMediaPaths.pcmLimit else {
        reader.cancelReading(); try? FileManager.default.removeItem(at: folder)
        throw EditorMediaFailure.result(.invalidInput, "pcm-too-large")
      }
      var data = Data(count: length)
      let copied = data.withUnsafeMutableBytes { raw in
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      guard copied == noErr else { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia) }
      let outputData = webAverage ? averageChannels(data, frames: sampleFrames, channels: decodedChannels) : data
      let timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
      if webAverage {
        guard timestamp.isFinite, timestamp >= 0, timestamp <= 9_007_199_254.740_991 else {
          reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "invalid-pcm-timestamp")
        }
        let timestampUs = Int64((timestamp * 1_000_000).rounded())
        guard segments.count < maximumSegments else {
          reader.cancelReading(); throw EditorMediaFailure.result(.invalidInput, "pcm-segments-too-many")
        }
        guard previousTimestampUs.map({ timestampUs > $0 }) ?? true else {
          reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "invalid-pcm-timestamp")
        }
        segments.append(["offsetFrames": frames, "timestampUs": timestampUs, "frames": sampleFrames])
        previousTimestampUs = timestampUs
      }
      do { try handle.write(contentsOf: outputData) }
      catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
      bytes += outputLength; frames += Int64(sampleFrames)
      if timestamp.isFinite { progress(min(1, max(0, (timestamp - request.fromSeconds) / span))) }
    }
    guard reader.status == .completed, frames > 0 else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia)
    }
    var manifest: [String: Any] = ["version": 1, "format": "f32le-interleaved", "sampleRate": request.sampleRate,
      "channels": request.channels, "frames": frames, "bytes": bytes]
    if webAverage { manifest["mixMode"] = "web-average"; manifest["segments"] = segments }
    let manifestURL = folder.appendingPathComponent("pcm.json")
    do { let encoded = try JSONSerialization.data(withJSONObject: manifest); try encoded.write(to: manifestURL, options: .atomic) }
    catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
    try paths.markComplete(folder, bytes: bytes, limit: EditorMediaPaths.pcmLimit,
      kind: "pcm", projectGeneration: projectGeneration)
    published = true
    progress(1)
    var result: [String: Any] = ["ok": true, "artifactId": artifactId, "uri": rawURL.absoluteString, "kind": "pcm", "size": bytes,
      "encoding": "f32le-interleaved", "sampleRate": request.sampleRate, "channels": request.channels, "frames": frames]
    if webAverage { result["mixMode"] = "web-average"; result["segments"] = segments }
    return result
  }

  private static func sourceChannelCount(_ track: AVAssetTrack) -> Int? {
    for raw in track.formatDescriptions {
      if let description = raw as? CMAudioFormatDescription,
         let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
         basic.mChannelsPerFrame > 0 { return Int(basic.mChannelsPerFrame) }
    }
    return nil
  }

  // AVAssetReader requires an explicit layout for linear PCM with more than two channels. A discrete layout preserves
  // source channel order so web-average can apply the same arithmetic mean across every decoded channel as the web.
  private static func discreteChannelLayoutData(_ channels: Int) -> Data? {
    guard (3...32).contains(channels) else { return nil }
    let tag = kAudioChannelLayoutTag_DiscreteInOrder | UInt32(channels)
    guard let layout = AVAudioChannelLayout(layoutTag: tag), Int(layout.channelCount) == channels else { return nil }
    let headerBytes = MemoryLayout<AudioChannelLayout>.size - MemoryLayout<AudioChannelDescription>.size
    guard headerBytes > 0, layout.layout.pointee.mNumberChannelDescriptions == 0 else { return nil }
    return Data(bytes: layout.layout, count: headerBytes)
  }

  private static func averageChannels(_ data: Data, frames: Int, channels: Int) -> Data {
    var output = Data(count: frames * MemoryLayout<Float>.size)
    data.withUnsafeBytes { input in
      output.withUnsafeMutableBytes { destination in
        let source = input.bindMemory(to: Float.self)
        let mono = destination.bindMemory(to: Float.self)
        for frame in 0..<frames {
          var sum = 0.0
          for channel in 0..<channels { sum += Double(source[frame * channels + channel]) }
          mono[frame] = Float(sum / Double(channels))
        }
      }
    }
    return output
  }
}
