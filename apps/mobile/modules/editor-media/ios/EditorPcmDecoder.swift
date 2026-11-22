import AVFoundation
import Foundation

enum EditorPcmDecoder {
  static func decode(identity: EditorMediaIdentity, projectGeneration: Int, request: DecodePcmRequest,
                     paths: EditorMediaPaths, cancelled: () -> Bool,
                     progress: (Double) -> Void) throws -> [String: Any] {
    guard request.fromSeconds.isFinite, request.toSeconds.isFinite, request.fromSeconds >= 0,
          request.toSeconds > request.fromSeconds, request.toSeconds - request.fromSeconds <= 30,
          request.sampleRate == 48_000, request.channels == 1 || request.channels == 2 else {
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
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) }
    catch { throw EditorMediaFailure.result(.corruptMedia) }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: request.sampleRate,
      AVNumberOfChannelsKey: request.channels, AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false
    ])
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
    var bytes = 0, frames: Int64 = 0
    defer { try? handle.close() }
    guard reader.startReading() else { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia) }
    while let sample = output.copyNextSampleBuffer() {
      if cancelled() { reader.cancelReading(); try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.cancelled) }
      guard let description = CMSampleBufferGetFormatDescription(sample),
            let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
            basic.mFormatID == kAudioFormatLinearPCM, basic.mSampleRate == 48_000,
            basic.mChannelsPerFrame == UInt32(request.channels), basic.mBitsPerChannel == 32,
            basic.mBytesPerFrame == UInt32(4 * request.channels),
            basic.mFormatFlags & kAudioFormatFlagIsFloat != 0,
            basic.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0,
            basic.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
            let block = CMSampleBufferGetDataBuffer(sample) else {
        reader.cancelReading(); throw EditorMediaFailure.result(.unsupportedCodec, "unexpected-pcm-format")
      }
      let length = CMBlockBufferGetDataLength(block)
      guard length > 0, bytes + length <= EditorMediaPaths.pcmLimit else {
        reader.cancelReading(); try? FileManager.default.removeItem(at: folder)
        throw EditorMediaFailure.result(.invalidInput, "pcm-too-large")
      }
      var data = Data(count: length)
      let copied = data.withUnsafeMutableBytes { raw in
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      guard copied == noErr else { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia) }
      do { try handle.write(contentsOf: data) }
      catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
      bytes += length; frames += Int64(length / (MemoryLayout<Float>.size * request.channels))
      let at = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
      if at.isFinite { progress(min(1, max(0, (at - request.fromSeconds) / span))) }
    }
    guard reader.status == .completed, frames > 0 else {
      try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.corruptMedia)
    }
    let manifest: [String: Any] = ["version": 1, "format": "f32le-interleaved", "sampleRate": request.sampleRate,
      "channels": request.channels, "frames": frames, "bytes": bytes]
    let manifestURL = folder.appendingPathComponent("pcm.json")
    do { let encoded = try JSONSerialization.data(withJSONObject: manifest); try encoded.write(to: manifestURL, options: .atomic) }
    catch { try? FileManager.default.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
    try paths.markComplete(folder, bytes: bytes, limit: EditorMediaPaths.pcmLimit,
      kind: "pcm", projectGeneration: projectGeneration)
    published = true
    progress(1)
    return ["ok": true, "artifactId": artifactId, "uri": rawURL.absoluteString, "kind": "pcm", "size": bytes,
      "encoding": "f32le-interleaved", "sampleRate": request.sampleRate, "channels": request.channels, "frames": frames]
  }
}
