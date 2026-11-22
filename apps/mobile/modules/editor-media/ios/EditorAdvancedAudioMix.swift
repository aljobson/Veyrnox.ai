import AVFoundation
import AudioToolbox
import CoreFoundation
import Foundation

/// Bounded, deterministic 48 kHz stereo renderer for the editor's canonical web audio contract.
/// The Expo module intentionally remains a thin admission/ownership layer; this renderer owns no
/// global state and publishes only a generation-fenced PCM artifact.
enum EditorAdvancedAudioMix {
  static let sampleRate = 48_000
  private static let maximumPlanBytes = 256 * 1024
  private static let maximumClips = 80
  private static let maximumSources = 40
  private static let maximumWorkingBytes = 256 * 1024 * 1024
  private static let fftSize = 2_048
  private static let fftHop = 512

  static func mix(_ identity: EditorMediaIdentity, projectGeneration: Int, _ mixJSON: String,
                  _ sources: [String: String], _ frames: Int, _ fps: Int,
                  paths: EditorMediaPaths = .shared, cancelled: () -> Bool,
                  progress: (Double) -> Void = { _ in }) throws -> [String: Any] {
    guard mixJSON.utf8.count <= maximumPlanBytes, sources.count <= maximumSources,
          (1...1_800).contains(frames), (1...60).contains(fps),
          Double(frames) / Double(fps) <= 30,
          let data = mixJSON.data(using: .utf8),
          let raw = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
          raw.count <= maximumClips else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-audio-mix")
    }
    let outputFrames = Int((Double(frames) / Double(fps) * Double(sampleRate)).rounded(.up))
    let outputBytes = outputFrames * 2 * MemoryLayout<Float>.size
    guard outputFrames > 0, outputBytes <= EditorMediaPaths.pcmLimit else {
      throw EditorMediaFailure.result(.invalidInput, "audio-mix-too-large")
    }
    let clips = try raw.map { try Clip($0, fps: fps, sources: sources) }
    var mixed = [Float](repeating: 0, count: outputFrames * 2)
    progress(0.02)
    for (index, clip) in clips.enumerated() {
      try checkCancellation(cancelled)
      let decoded = try decode(clip, identity: identity, paths: paths, cancelled: cancelled)
      try render(clip, decoded: decoded, into: &mixed, outputFrames: outputFrames,
        cancelled: cancelled)
      progress(0.02 + 0.88 * Double(index + 1) / Double(max(1, clips.count)))
    }
    try checkCancellation(cancelled)
    EditorAudioOutputContract.peakNormalize(&mixed)
    try checkCancellation(cancelled)
    let expected = mixed.count * MemoryLayout<Float>.size
    guard expected == outputBytes else { throw EditorMediaFailure.result(.writeFailed, "invalid-pcm-size") }
    let (artifactId, folder) = try paths.makeArtifact(identity, kind: "pcm",
      expected: expected + 4_096, projectGeneration: projectGeneration)
    var published = false
    defer { if !published { try? FileManager.default.removeItem(at: folder) } }
    let rawURL = folder.appendingPathComponent("audio.f32le")
    let bytes = mixed.withUnsafeBytes { Data($0) }
    guard bytes.count == expected else { throw EditorMediaFailure.result(.writeFailed, "invalid-pcm-size") }
    do { try bytes.write(to: rawURL, options: .atomic) }
    catch { throw EditorMediaFailure.result(.writeFailed) }
    let manifest: [String: Any] = ["version": 1, "format": "f32le-interleaved",
      "sampleRate": sampleRate, "channels": 2, "frames": outputFrames, "bytes": expected]
    do {
      try JSONSerialization.data(withJSONObject: manifest)
        .write(to: folder.appendingPathComponent("pcm.json"), options: .atomic)
    } catch { throw EditorMediaFailure.result(.writeFailed) }
    try checkCancellation(cancelled)
    try paths.markComplete(folder, bytes: expected, limit: EditorMediaPaths.pcmLimit,
      kind: "pcm", projectGeneration: projectGeneration)
    published = true
    progress(1)
    return ["ok": true, "artifactId": artifactId, "uri": rawURL.absoluteString, "kind": "pcm",
      "size": expected, "encoding": "f32le-interleaved", "sampleRate": sampleRate,
      "channels": 2, "frames": outputFrames]
  }

  private struct SpeedPoint { let frame: Double, rate: Double }
  private struct GainPoint { let frame: Double, gain: Double }
  private struct Processing {
    let pitch: Double, voice: String, noiseReduction: Double, noiseStart: Double
    let noiseLength: Double, gateDb: Double
  }
  private struct Effects {
    let width: Double, tremoloRate: Double, tremoloDepth: Double
    let echoDelay: Double, echoDecay: Double, echoRepeats: Int, echoMix: Double
  }
  private struct Equalizer { let low: Double, mid: Double, high: Double }
  private struct Clip {
    let mediaId: String, sourceURL: URL
    let fps: Double
    let start: Double, sourceIn: Double, length: Double, transitionOut: Double, volume: Double
    let fadeIn: Double, fadeOut: Double, rate: Double, reverse: Bool, preservePitch: Bool
    let speedCurve: [SpeedPoint], processing: Processing, effects: Effects
    let pan: Double, equalizer: Equalizer, automation: [GainPoint]

    init(_ raw: [String: Any], fps: Int, sources: [String: String]) throws {
      guard let mediaId = raw["mediaId"] as? String, !mediaId.isEmpty, mediaId.utf8.count <= 100,
            let source = sources[mediaId], let sourceURL = URL(string: source),
            sourceURL.isFileURL, sourceURL.host == nil, sourceURL.query == nil, sourceURL.fragment == nil else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-clip")
      }
      func seconds(_ frameKey: String, _ secondsKey: String) -> Double? {
        if let value = number(raw[frameKey]) { return value / Double(fps) }
        return number(raw[secondsKey])
      }
      guard let start = seconds("start", "timelineStartSeconds"),
            let sourceIn = seconds("in", "sourceStartSeconds"),
            let length = seconds("len", "durationSeconds"),
            start.isFinite, sourceIn.isFinite, length.isFinite,
            start >= 0, sourceIn >= 0, length > 0, length <= 30 else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-clip")
      }
      let volume = number(raw["volume"]) ?? 1
      let fadeIn = seconds("fadeIn", "fadeInSeconds") ?? 0
      let fadeOut = seconds("fadeOut", "fadeOutSeconds") ?? 0
      let transitionOut = seconds("transitionOut", "transitionOutSeconds") ?? 0
      let rate = number(raw["rate"]) ?? 1
      let reverse = raw["reverse"] as? Bool ?? false
      let preservePitch = raw["preservePitch"] as? Bool ?? false
      guard volume.isFinite, (0...4).contains(volume), fadeIn.isFinite, fadeIn >= 0,
            fadeOut.isFinite, fadeOut >= 0, transitionOut.isFinite, transitionOut >= 0,
            length + transitionOut <= 30, rate.isFinite, (0.1...8).contains(rate),
            raw["reverse"] == nil || raw["reverse"] is Bool,
            raw["preservePitch"] == nil || raw["preservePitch"] is Bool else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-clip")
      }
      let speed = try Self.speed(raw["speedCurve"])
      let processing = try Self.processing(raw["audioProcessing"])
      let effects = try Self.effects(raw["audioEffects"])
      let pan = number(raw["pan"]) ?? 0
      let equalizer = try Self.equalizer(raw["eq"])
      let automation = try Self.automation(raw["mixAutomation"])
      guard pan.isFinite, (-1...1).contains(pan) else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-clip")
      }
      self.mediaId = mediaId; self.sourceURL = sourceURL; self.fps = Double(fps)
      self.start = start; self.sourceIn = sourceIn; self.length = length; self.transitionOut = transitionOut; self.volume = volume
      self.fadeIn = fadeIn; self.fadeOut = fadeOut; self.rate = rate; self.reverse = reverse
      self.preservePitch = preservePitch; self.speedCurve = speed; self.processing = processing
      self.effects = effects; self.pan = pan; self.equalizer = equalizer; self.automation = automation
    }

    private static func speed(_ value: Any?) throws -> [SpeedPoint] {
      guard let value else { return [] }
      guard let points = value as? [[String: Any]], points.count >= 2, points.count <= 12 else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-speed-curve")
      }
      var result: [SpeedPoint] = []
      for point in points {
        guard Set(point.keys) == ["frame", "rate"], let frame = number(point["frame"]),
              let rate = number(point["rate"]), frame.isFinite, (-18_000...18_000).contains(frame),
              rate.isFinite, (0.1...8).contains(rate), result.last.map({ frame > $0.frame }) ?? true else {
          throw EditorMediaFailure.result(.invalidInput, "invalid-speed-curve")
        }
        result.append(SpeedPoint(frame: frame, rate: rate))
      }
      return result
    }

    private static func processing(_ value: Any?) throws -> Processing {
      guard let value else { return Processing(pitch: 0, voice: "none", noiseReduction: 0,
        noiseStart: 0, noiseLength: 0.3, gateDb: -96) }
      guard let raw = value as? [String: Any], Set(raw.keys) ==
        ["pitch", "voice", "noiseReduction", "noiseStart", "noiseLength", "gateDb"],
        let pitch = number(raw["pitch"]), let voice = raw["voice"] as? String,
        let reduction = number(raw["noiseReduction"]), let start = number(raw["noiseStart"]),
        let length = number(raw["noiseLength"]), let gate = number(raw["gateDb"]),
        (-12...12).contains(pitch), ["none", "deep", "bright", "radio", "robot"].contains(voice),
        (0...1).contains(reduction), (0...333_333).contains(start), (0.05...2).contains(length),
        (-96 ... -6).contains(gate) else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-processing")
      }
      return Processing(pitch: pitch, voice: voice, noiseReduction: reduction,
        noiseStart: start, noiseLength: length, gateDb: gate)
    }

    private static func effects(_ value: Any?) throws -> Effects {
      guard let value else { return Effects(width: 1, tremoloRate: 4, tremoloDepth: 0,
        echoDelay: 0.2, echoDecay: 0.45, echoRepeats: 3, echoMix: 0) }
      guard let raw = value as? [String: Any], Set(raw.keys) ==
        ["width", "tremoloRate", "tremoloDepth", "echoDelay", "echoDecay", "echoRepeats", "echoMix"],
        let width = number(raw["width"]), let tremoloRate = number(raw["tremoloRate"]),
        let tremoloDepth = number(raw["tremoloDepth"]), let echoDelay = number(raw["echoDelay"]),
        let echoDecay = number(raw["echoDecay"]), let repeats = integer(raw["echoRepeats"]),
        let echoMix = number(raw["echoMix"]), (0...2).contains(width),
        (0.1...20).contains(tremoloRate), (0...1).contains(tremoloDepth),
        (0.01...1).contains(echoDelay), (0.05...0.9).contains(echoDecay),
        (1...8).contains(repeats), (0...1).contains(echoMix),
        echoDelay * Double(repeats) <= 4 else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-effects")
      }
      return Effects(width: width, tremoloRate: tremoloRate, tremoloDepth: tremoloDepth,
        echoDelay: echoDelay, echoDecay: echoDecay, echoRepeats: repeats, echoMix: echoMix)
    }

    private static func equalizer(_ value: Any?) throws -> Equalizer {
      guard let value else { return Equalizer(low: 0, mid: 0, high: 0) }
      guard let raw = value as? [String: Any], Set(raw.keys) == ["low", "mid", "high"],
            let low = number(raw["low"]), let mid = number(raw["mid"]), let high = number(raw["high"]),
            (-24...24).contains(low), (-24...24).contains(mid), (-24...24).contains(high) else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-audio-eq")
      }
      return Equalizer(low: low, mid: mid, high: high)
    }

    private static func automation(_ value: Any?) throws -> [GainPoint] {
      guard let value else { return [] }
      guard let raw = value as? [[String: Any]], raw.count <= 64 else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-mix-automation")
      }
      var result: [GainPoint] = []
      for point in raw {
        guard Set(point.keys) == ["frame", "gain"], let frame = number(point["frame"]),
              let gain = number(point["gain"]), frame.isFinite, frame >= 0,
              gain.isFinite, (0...4).contains(gain), result.last.map({ frame > $0.frame }) ?? true else {
          throw EditorMediaFailure.result(.invalidInput, "invalid-mix-automation")
        }
        result.append(GainPoint(frame: frame, gain: gain))
      }
      return result
    }
  }

  private struct Decoded { let start: Double, left: [Float], right: [Float] }

  private static func decode(_ clip: Clip, identity: EditorMediaIdentity, paths: EditorMediaPaths,
                             cancelled: () -> Bool) throws -> Decoded {
    let url = try paths.inputURL(clip.sourceURL.absoluteString, identity: identity)
    let endpoints = [sourceTime(clip, offsetFrames: 0),
      sourceTime(clip, offsetFrames: max(0, (clip.length + clip.transitionOut) * clip.fps - 1))]
    var from = max(0, (endpoints.min() ?? clip.sourceIn) - 2.0 / clip.fps)
    var to = (endpoints.max() ?? clip.sourceIn) + 3.0 / clip.fps
    if clip.processing.noiseReduction > 0 {
      from = min(from, clip.processing.noiseStart)
      to = max(to, clip.processing.noiseStart + clip.processing.noiseLength)
    }
    guard from.isFinite, to.isFinite, to > from, to - from <= 241 else {
      throw EditorMediaFailure.result(.invalidInput, "audio-source-range-too-large")
    }
    let reserved = Int((to - from) * Double(sampleRate) * 2 * 4)
    let sourceMultiplier = clip.processing.noiseReduction > 0 ? 3 : 1
    guard reserved * sourceMultiplier + Int((clip.length + clip.transitionOut) * Double(sampleRate) * 2 * 4 * 4) <= maximumWorkingBytes else {
      throw EditorMediaFailure.result(.invalidInput, "audio-working-set-too-large")
    }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .audio).first else {
      return Decoded(start: from, left: [], right: [])
    }
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) }
    catch { throw EditorMediaFailure.result(.corruptMedia) }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false, AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 2,
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw EditorMediaFailure.result(.unsupportedCodec) }
    reader.add(output)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: 600_000),
      duration: CMTime(seconds: to - from, preferredTimescale: 600_000))
    guard reader.startReading() else { throw EditorMediaFailure.result(.corruptMedia) }
    let decodedFrames = Int(ceil((to - from) * Double(sampleRate)))
    var left = [Float](repeating: 0, count: decodedFrames)
    var right = [Float](repeating: 0, count: decodedFrames)
    while let sample = output.copyNextSampleBuffer() {
      try checkCancellation(cancelled, reader: reader)
      guard let description = CMSampleBufferGetFormatDescription(sample),
            let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
            basic.mFormatID == kAudioFormatLinearPCM, basic.mSampleRate == Double(sampleRate),
            basic.mChannelsPerFrame == 2, basic.mBitsPerChannel == 32,
            basic.mBytesPerFrame == 8, basic.mFormatFlags & kAudioFormatFlagIsFloat != 0,
            basic.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0,
            basic.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
            let block = CMSampleBufferGetDataBuffer(sample) else {
        reader.cancelReading(); throw EditorMediaFailure.result(.unsupportedCodec, "unexpected-pcm-format")
      }
      let bytes = CMBlockBufferGetDataLength(block)
      guard bytes > 0, bytes % 8 == 0 else {
        reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia, "invalid-pcm-buffer")
      }
      var values = [Float](repeating: 0, count: bytes / 4)
      let status = values.withUnsafeMutableBytes {
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes, destination: $0.baseAddress!)
      }
      guard status == noErr else { reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia) }
      let timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
      guard timestamp.isFinite else { reader.cancelReading(); throw EditorMediaFailure.result(.corruptMedia) }
      let destination = Int(((timestamp - from) * Double(sampleRate)).rounded())
      for frame in 0..<(values.count / 2) {
        let index = destination + frame
        if index >= 0, index < decodedFrames {
          left[index] = values[frame * 2]; right[index] = values[frame * 2 + 1]
        }
      }
    }
    try checkCancellation(cancelled, reader: reader)
    guard reader.status == .completed else { throw EditorMediaFailure.result(.corruptMedia) }
    return Decoded(start: from, left: left, right: right)
  }

  private static func render(_ clip: Clip, decoded: Decoded, into mixed: inout [Float],
                             outputFrames: Int, cancelled: () -> Bool) throws {
    let count = max(1, Int(((clip.length + clip.transitionOut) * Double(sampleRate)).rounded(.up)))
    var source = decoded
    if clip.processing.noiseReduction > 0, !decoded.left.isEmpty {
      source = try suppressNoise(decoded, settings: clip.processing, cancelled: cancelled)
    }
    let semitones = max(-12, min(12, clip.processing.pitch
      + (clip.processing.voice == "deep" ? -5 : clip.processing.voice == "bright" ? 5 : 0)))
    var channels = clip.preservePitch || semitones != 0
      ? try stretch(source, clip: clip, count: count, semitones: semitones, cancelled: cancelled)
      : try remap(source, clip: clip, count: count, cancelled: cancelled)
    gateAndVoice(&channels, settings: clip.processing)
    applyGainEffects(&channels, clip: clip)
    applyFades(&channels, clip: clip)
    applyEqualizer(&channels, clip.equalizer)
    if clip.processing.voice == "radio" {
      applyBiquad(&channels, type: .highpass, frequency: 300, gainDb: 0)
      applyBiquad(&channels, type: .lowpass, frequency: 3_400, gainDb: 0)
    }
    applyPan(&channels, pan: clip.pan)
    let base = Int((clip.start * Double(sampleRate)).rounded())
    for frame in 0..<count where base + frame < outputFrames {
      if frame % sampleRate == 0 { try checkCancellation(cancelled) }
      guard base + frame >= 0 else { continue }
      mixed[(base + frame) * 2] += channels[0][frame]
      mixed[(base + frame) * 2 + 1] += channels[1][frame]
    }
  }

  private static func remap(_ source: Decoded, clip: Clip, count: Int,
                            cancelled: () -> Bool) throws -> [[Float]] {
    var out = [[Float](repeating: 0, count: count), [Float](repeating: 0, count: count)]
    for index in 0..<count {
      if index % sampleRate == 0 { try checkCancellation(cancelled) }
      let time = sourceTime(clip, offsetFrames: Double(index) / Double(sampleRate) * clip.fps)
      out[0][index] = sample(source, time: time, channel: 0)
      out[1][index] = sample(source, time: time, channel: 1)
    }
    return out
  }

  /// Similarity-aligned overlap-add, ported from editorTimeStretch.mjs (2048/512, ±5 ms search).
  private static func stretch(_ source: Decoded, clip: Clip, count: Int, semitones: Double,
                              cancelled: () -> Bool) throws -> [[Float]] {
    var out = [[Float](repeating: 0, count: count), [Float](repeating: 0, count: count)]
    var weight = [Double](repeating: 0, count: count)
    let size = 2_048, hop = 512, half = size / 2
    let window = (0..<size).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(size - 1)) }
    let direction = clip.reverse ? -1.0 : 1.0, pitch = pow(2, semitones / 12), search = Int(Double(sampleRate) * 0.005)
    let first = sourceTime(clip, offsetFrames: 0)
    let last = sourceTime(clip, offsetFrames: Double(count - 1) / Double(sampleRate) * clip.fps)
    let lower = min(first, last), upper = max(first, last) + 1 / Double(sampleRate)
    func bounded(_ time: Double, _ channel: Int) -> Float {
      time < lower || time > upper ? 0 : sample(source, time: time, channel: channel)
    }
    var center = 0, grain = 0
    while center < count + half {
      if grain % 32 == 0 { try checkCancellation(cancelled) }
      let offset = Double(min(count - 1, center)) / Double(sampleRate) * clip.fps
      let anchor = sourceTime(clip, offsetFrames: offset)
      let strideValue = direction * pitch * (clip.preservePitch ? 1 : speedAt(clip, frame: offset))
      let begin = center - half
      var best = 0, bestScore = -Double.infinity
      if center > 0, begin + size - hop < count {
        func correlation(_ delta: Int) -> Double {
          var cross = 0.0, energy = 0.0, reference = 0.0
          for j in stride(from: 0, to: size - hop, by: 8) {
            let destination = begin + j
            if destination < 0 || destination >= count || weight[destination] == 0 { continue }
            let time = anchor + Double(j - half) * strideValue / Double(sampleRate) + Double(delta) / Double(sampleRate)
            let al = Double(out[0][destination]) / weight[destination]
            let ar = Double(out[1][destination]) / weight[destination]
            let bl = Double(bounded(time, 0)), br = Double(bounded(time, 1))
            cross += al * bl + ar * br; energy += bl * bl + br * br; reference += al * al + ar * ar
          }
          return energy > 1e-12 && reference > 1e-12 ? cross / sqrt(energy * reference) : -Double.infinity
        }
        for delta in stride(from: -search, through: search, by: 8) {
          let score = correlation(delta)
          if score > bestScore + 1e-6 || (abs(score - bestScore) < 1e-6 && abs(delta) < abs(best)) {
            bestScore = score; best = delta
          }
        }
        let coarse = best
        for delta in max(-search, coarse - 7)...min(search, coarse + 7) {
          let score = correlation(delta)
          if score > bestScore + 1e-6 || (abs(score - bestScore) < 1e-6 && abs(delta) < abs(best)) {
            bestScore = score; best = delta
          }
        }
      }
      for j in 0..<size {
        let destination = begin + j
        if destination < 0 || destination >= count { continue }
        let w = window[j]
        let time = anchor + Double(j - half) * strideValue / Double(sampleRate) + Double(best) / Double(sampleRate)
        weight[destination] += w
        out[0][destination] += Float(Double(bounded(time, 0)) * w)
        out[1][destination] += Float(Double(bounded(time, 1)) * w)
      }
      center += hop; grain += 1
    }
    for index in 0..<count where weight[index] != 0 {
      out[0][index] /= Float(weight[index]); out[1][index] /= Float(weight[index])
    }
    return out
  }

  private static func suppressNoise(_ source: Decoded, settings: Processing,
                                    cancelled: () -> Bool) throws -> Decoded {
    let size = fftSize, hop = fftHop, bins = size / 2 + 1
    let window = (0..<size).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(size - 1)) }
    var profile = [Double](repeating: 0, count: bins), learned = 0
    var at = settings.noiseStart
    while at + Double(size) / Double(sampleRate) <= settings.noiseStart + settings.noiseLength {
      for channel in 0..<2 {
        var real = (0..<size).map { Double(sample(source, time: at + Double($0) / Double(sampleRate), channel: channel)) * window[$0] }
        var imaginary = [Double](repeating: 0, count: size); fft(&real, &imaginary)
        for bin in 0..<bins { profile[bin] += (real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) * 0.5 }
      }
      learned += 1; at += Double(hop) / Double(sampleRate)
    }
    guard learned > 0 else { throw EditorMediaFailure.result(.invalidInput, "noise-sample-too-short") }
    for bin in 0..<bins { profile[bin] /= Double(learned) }
    let count = source.left.count
    var out = [[Float](repeating: 0, count: count), [Float](repeating: 0, count: count)]
    var weights = [Double](repeating: 0, count: count), center = 0, batch = 0
    while center < count + size / 2 {
      if batch % 32 == 0 { try checkCancellation(cancelled) }
      let begin = center - size / 2
      for channel in 0..<2 {
        var real = [Double](repeating: 0, count: size), imaginary = [Double](repeating: 0, count: size)
        for index in 0..<size {
          let sourceIndex = begin + index
          let value = sourceIndex >= 0 && sourceIndex < count
            ? (channel == 0 ? source.left[sourceIndex] : source.right[sourceIndex]) : 0
          real[index] = Double(value) * window[index]
        }
        fft(&real, &imaginary)
        for index in 0..<size {
          let bin = index <= size / 2 ? index : size - index
          let power = real[index] * real[index] + imaginary[index] * imaginary[index]
          let gain = sqrt(max(0.025, 1 - settings.noiseReduction * 2 * profile[bin] / max(1e-16, power)))
          real[index] *= gain; imaginary[index] *= gain
        }
        fft(&real, &imaginary, inverse: true)
        for index in 0..<size {
          let destination = begin + index
          if destination < 0 || destination >= count { continue }
          out[channel][destination] += Float(real[index] * window[index])
          if channel == 0 { weights[destination] += window[index] * window[index] }
        }
      }
      center += hop; batch += 1
    }
    for index in 0..<count where weights[index] != 0 {
      out[0][index] /= Float(weights[index]); out[1][index] /= Float(weights[index])
    }
    return Decoded(start: source.start, left: out[0], right: out[1])
  }

  private static func fft(_ real: inout [Double], _ imaginary: inout [Double], inverse: Bool = false) {
    let count = real.count
    var j = 0
    for index in 1..<count {
      var bit = count >> 1
      while j & bit != 0 { j ^= bit; bit >>= 1 }
      j ^= bit
      if index < j { real.swapAt(index, j); imaginary.swapAt(index, j) }
    }
    var size = 2
    while size <= count {
      let angle = (inverse ? 2.0 : -2.0) * Double.pi / Double(size)
      let cosine = cos(angle), sine = sin(angle)
      for base in stride(from: 0, to: count, by: size) {
        var wr = 1.0, wi = 0.0
        for k in 0..<(size / 2) {
          let a = base + k, b = a + size / 2
          let tr = wr * real[b] - wi * imaginary[b], ti = wr * imaginary[b] + wi * real[b]
          real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti
          real[a] += tr; imaginary[a] += ti
          let next = wr * cosine - wi * sine; wi = wr * sine + wi * cosine; wr = next
        }
      }
      size *= 2
    }
    if inverse { for index in 0..<count { real[index] /= Double(count); imaginary[index] /= Double(count) } }
  }

  private static func gateAndVoice(_ channels: inout [[Float]], settings: Processing) {
    var envelope = 0.0, gain = 1.0
    let threshold = pow(10, settings.gateDb / 20)
    let attack = 1 - exp(-1 / (Double(sampleRate) * 0.005))
    let release = 1 - exp(-1 / (Double(sampleRate) * 0.08))
    for index in channels[0].indices {
      let l = Double(channels[0][index]), r = Double(channels[1][index])
      let level = sqrt((l * l + r * r) * 0.5)
      envelope += (level - envelope) * (level > envelope ? attack : release)
      let target = settings.gateDb <= -96 ? 1 : max(0, min(1, (envelope - threshold * 0.5) / (threshold * 0.5)))
      gain += (target - gain) * (target > gain ? attack : release)
      for channel in 0..<2 {
        var value = Double(channels[channel][index]) * gain
        if settings.voice == "robot" { value *= 0.5 + 0.5 * sin(Double(index) / Double(sampleRate) * 2 * Double.pi * 50) }
        if settings.voice == "radio" { value = tanh(value * 2) / tanh(2) }
        channels[channel][index] = Float(value)
      }
    }
  }

  private static func applyGainEffects(_ channels: inout [[Float]], clip: Clip) {
    let count = channels[0].count, effects = clip.effects
    var echoWeights: [Double] = []
    if effects.echoMix > 0 {
      echoWeights = (1...effects.echoRepeats).map { pow(effects.echoDecay, Double($0)) }
      let total = echoWeights.reduce(0, +); echoWeights = echoWeights.map { $0 / total }
    }
    let dry = channels
    for index in 0..<count {
      let localFrame = Double(index) / Double(sampleRate) * clip.fps
      let gain = clip.volume * automationGain(clip.automation, frame: localFrame)
      var left = Double(dry[0][index]) * gain, right = Double(dry[1][index]) * gain
      if effects.width != 1 {
        let originalLeft = left, originalRight = right
        left = originalLeft * (1 + effects.width) / 2 + originalRight * (1 - effects.width) / 2
        right = originalLeft * (1 - effects.width) / 2 + originalRight * (1 + effects.width) / 2
      }
      if effects.tremoloDepth > 0 {
        let time = Double(index) / Double(sampleRate)
        let tremolo = 1 - effects.tremoloDepth / 2 + effects.tremoloDepth / 2 * sin(2 * Double.pi * effects.tremoloRate * time)
        left *= tremolo; right *= tremolo
      }
      if effects.echoMix > 0 {
        var wetLeft = 0.0, wetRight = 0.0
        for tap in 0..<effects.echoRepeats {
          let sourceIndex = index - Int((effects.echoDelay * Double(tap + 1) * Double(sampleRate)).rounded())
          if sourceIndex >= 0 {
            // Every finite tap branches from the pre-echo tail, exactly like the web graph.
            var tapLeft = Double(dry[0][sourceIndex]) * clip.volume * automationGain(clip.automation,
              frame: Double(sourceIndex) / Double(sampleRate) * clip.fps)
            var tapRight = Double(dry[1][sourceIndex]) * clip.volume * automationGain(clip.automation,
              frame: Double(sourceIndex) / Double(sampleRate) * clip.fps)
            if effects.width != 1 {
              let originalLeft = tapLeft, originalRight = tapRight
              tapLeft = originalLeft * (1 + effects.width) / 2 + originalRight * (1 - effects.width) / 2
              tapRight = originalLeft * (1 - effects.width) / 2 + originalRight * (1 + effects.width) / 2
            }
            if effects.tremoloDepth > 0 {
              let time = Double(sourceIndex) / Double(sampleRate)
              let tremolo = 1 - effects.tremoloDepth / 2 + effects.tremoloDepth / 2 * sin(2 * Double.pi * effects.tremoloRate * time)
              tapLeft *= tremolo; tapRight *= tremolo
            }
            wetLeft += tapLeft * echoWeights[tap]; wetRight += tapRight * echoWeights[tap]
          }
        }
        left = left * (1 - effects.echoMix) + wetLeft * effects.echoMix
        right = right * (1 - effects.echoMix) + wetRight * effects.echoMix
      }
      channels[0][index] = Float(left); channels[1][index] = Float(right)
    }
  }

  private static func applyFades(_ channels: inout [[Float]], clip: Clip) {
    for index in channels[0].indices {
      let time = Double(index) / Double(sampleRate)
      let entering = clip.fadeIn > 0 ? min(1, time / clip.fadeIn) : 1
      let leaving = clip.fadeOut > 0 ? min(1, max(0, clip.length - time) / clip.fadeOut) : 1
      let transition = clip.transitionOut > 0 && time >= clip.length
        ? min(1, max(0, clip.length + clip.transitionOut - time) / clip.transitionOut) : 1
      let gain = Float(entering * leaving * transition)
      channels[0][index] *= gain; channels[1][index] *= gain
    }
  }

  private enum BiquadType { case lowshelf, peaking, highshelf, highpass, lowpass }
  private static func applyEqualizer(_ channels: inout [[Float]], _ equalizer: Equalizer) {
    applyBiquad(&channels, type: .lowshelf, frequency: 200, gainDb: equalizer.low)
    applyBiquad(&channels, type: .peaking, frequency: 1_000, gainDb: equalizer.mid)
    applyBiquad(&channels, type: .highshelf, frequency: 5_000, gainDb: equalizer.high)
  }

  /// RBJ cookbook coefficients at Web Audio's default Q=1. This preserves the browser graph's
  /// frequencies, gains and stateful order without depending on device audio-unit implementations.
  private static func applyBiquad(_ channels: inout [[Float]], type: BiquadType,
                                  frequency: Double, gainDb: Double) {
    if gainDb == 0 && (type == .lowshelf || type == .peaking || type == .highshelf) { return }
    let omega = 2 * Double.pi * frequency / Double(sampleRate), cosine = cos(omega), sine = sin(omega)
    let a = pow(10, gainDb / 40), alpha = sine / 2
    var b0 = 0.0, b1 = 0.0, b2 = 0.0, a0 = 1.0, a1 = 0.0, a2 = 0.0
    switch type {
    case .peaking:
      b0 = 1 + alpha * a; b1 = -2 * cosine; b2 = 1 - alpha * a
      a0 = 1 + alpha / a; a1 = -2 * cosine; a2 = 1 - alpha / a
    case .lowshelf:
      let root = sine * sqrt(2 * a)
      b0 = a * ((a + 1) - (a - 1) * cosine + root); b1 = 2 * a * ((a - 1) - (a + 1) * cosine)
      b2 = a * ((a + 1) - (a - 1) * cosine - root); a0 = (a + 1) + (a - 1) * cosine + root
      a1 = -2 * ((a - 1) + (a + 1) * cosine); a2 = (a + 1) + (a - 1) * cosine - root
    case .highshelf:
      let root = sine * sqrt(2 * a)
      b0 = a * ((a + 1) + (a - 1) * cosine + root); b1 = -2 * a * ((a - 1) + (a + 1) * cosine)
      b2 = a * ((a + 1) + (a - 1) * cosine - root); a0 = (a + 1) - (a - 1) * cosine + root
      a1 = 2 * ((a - 1) - (a + 1) * cosine); a2 = (a + 1) - (a - 1) * cosine - root
    case .highpass:
      b0 = (1 + cosine) / 2; b1 = -(1 + cosine); b2 = (1 + cosine) / 2
      a0 = 1 + alpha; a1 = -2 * cosine; a2 = 1 - alpha
    case .lowpass:
      b0 = (1 - cosine) / 2; b1 = 1 - cosine; b2 = (1 - cosine) / 2
      a0 = 1 + alpha; a1 = -2 * cosine; a2 = 1 - alpha
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
    for channel in 0..<2 {
      var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
      for index in channels[channel].indices {
        let x = Double(channels[channel][index])
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        channels[channel][index] = Float(y); x2 = x1; x1 = x; y2 = y1; y1 = y
      }
    }
  }

  private static func applyPan(_ channels: inout [[Float]], pan: Double) {
    guard pan != 0 else { return }
    for index in channels[0].indices {
      let left = Double(channels[0][index]), right = Double(channels[1][index])
      if pan <= 0 {
        let angle = (pan + 1) * Double.pi / 2
        channels[0][index] = Float(left + right * cos(angle))
        channels[1][index] = Float(right * sin(angle))
      } else {
        let angle = pan * Double.pi / 2
        channels[0][index] = Float(left * cos(angle))
        channels[1][index] = Float(right + left * sin(angle))
      }
    }
  }

  private static func sample(_ source: Decoded, time: Double, channel: Int) -> Float {
    let samples = channel == 0 ? source.left : source.right
    let position = (time - source.start) * Double(sampleRate), index = Int(floor(position)), fraction = position - floor(position)
    guard index >= 0, index < samples.count else { return 0 }
    let next = index + 1 < samples.count ? samples[index + 1] : samples[index]
    return samples[index] + (next - samples[index]) * Float(fraction)
  }

  private static func sourceTime(_ clip: Clip, offsetFrames: Double) -> Double {
    clip.sourceIn + (clip.reverse ? -1 : 1) * sourceAdvance(clip, frame: offsetFrames) / clip.fps
  }
  private static func sourceAdvance(_ clip: Clip, frame: Double) -> Double {
    let points = clip.speedCurve
    guard !points.isEmpty else { return frame * clip.rate }
    func primitive(_ value: Double) -> Double {
      var sum = (min(value, points[0].frame) - points[0].frame) * points[0].rate
      if value <= points[0].frame { return sum }
      for index in 1..<points.count {
        let left = points[index - 1], right = points[index], delta = min(value, right.frame) - left.frame
        sum += left.rate * delta + (right.rate - left.rate) * delta * delta / (2 * (right.frame - left.frame))
        if value <= right.frame { return sum }
      }
      return sum + (value - points.last!.frame) * points.last!.rate
    }
    return primitive(frame) - primitive(0)
  }
  private static func speedAt(_ clip: Clip, frame: Double) -> Double {
    let points = clip.speedCurve
    guard !points.isEmpty else { return clip.rate }
    let left = points.last(where: { $0.frame <= frame }) ?? points[0]
    let right = points.first(where: { $0.frame >= frame }) ?? points.last!
    return left.frame == right.frame ? left.rate
      : left.rate + (right.rate - left.rate) * (frame - left.frame) / (right.frame - left.frame)
  }
  private static func automationGain(_ points: [GainPoint], frame: Double) -> Double {
    guard !points.isEmpty else { return 1 }
    let left = points.last(where: { $0.frame <= frame }) ?? points[0]
    let right = points.first(where: { $0.frame >= frame }) ?? points.last!
    return left.frame == right.frame ? left.gain
      : left.gain + (right.gain - left.gain) * (frame - left.frame) / (right.frame - left.frame)
  }
  private static func number(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let result = number.doubleValue; return result.isFinite ? result : nil
  }
  private static func integer(_ value: Any?) -> Int? {
    guard let number = number(value), number.rounded() == number,
          number >= Double(Int.min), number <= Double(Int.max) else { return nil }
    return Int(number)
  }
  private static func checkCancellation(_ cancelled: () -> Bool, reader: AVAssetReader? = nil) throws {
    if cancelled() { reader?.cancelReading(); throw EditorMediaFailure.result(.cancelled) }
  }
}
