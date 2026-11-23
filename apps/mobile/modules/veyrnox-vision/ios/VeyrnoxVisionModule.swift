import ExpoModulesCore
import AVFoundation
import UIKit

// Shared across module owners/remounts. MediaPipe IMAGE calls cannot be interrupted.
private final class VisionWorker {
  static let shared = VisionWorker()
  private let lock = NSLock()
  private let executor = DispatchQueue(label: "ai.veyrnox.vision")
  private let engine = VisionEngine()
  private var initializing = false
  private var initialized = false
  private var waiters: [Promise] = []
  private var running: Job?
  private var videoOwner: String?
  private var videoToken: String?
  private var cancelledVideos = Set<String>()
  // One slot per owner, in arrival order; replacement retains the owner's position.
  private var queued: [Job] = []
  private final class Job {
    let owner: String, token: String, op: String, jpeg: String
    let width: Int, height: Int, promise: Promise
    let admitted: () -> Void
    var cancelled = false
    init(_ owner: String, _ token: String, _ op: String, _ jpeg: String, _ width: Int, _ height: Int,
         _ promise: Promise, _ admitted: @escaping () -> Void) {
      self.owner = owner; self.token = token; self.op = op; self.jpeg = jpeg; self.width = width
      self.height = height; self.promise = promise; self.admitted = admitted
    }
  }
  func initialize(_ promise: Promise) {
    lock.lock()
    if initialized { lock.unlock(); promise.resolve(nil); return }
    waiters.append(promise)
    if initializing { lock.unlock(); return }
    initializing = true
    lock.unlock()
    executor.async {
      let success: Bool = autoreleasepool {
        do { self.sweepSemanticMasks(); try self.engine.initialize(); return true } catch { return false }
      }
      self.lock.lock()
      self.initialized = success; self.initializing = false
      let waiting = self.waiters; self.waiters = []
      self.lock.unlock()
      for p in waiting {
        if success { p.resolve(nil) } else { p.reject("inference-unavailable", "inference-unavailable") }
      }
    }
  }
  func submit(_ owner: String, _ token: String, _ op: String, _ jpeg: String, _ width: Int, _ height: Int,
              _ promise: Promise, _ admitted: @escaping () -> Void) {
    lock.lock()
    guard initialized, !owner.isEmpty, owner.count <= 100, token.count <= 100, jpeg.utf8.count <= 900_000 else {
      lock.unlock(); promise.resolve(["error": "inference-unavailable"]); return
    }
    let job = Job(owner, token, op, jpeg, width, height, promise, admitted)
    if running != nil {
      if let index = queued.firstIndex(where: { $0.owner == owner }) {
        let old = queued[index]; queued[index] = job
        lock.unlock(); old.promise.resolve(["cancelled": true]); return
      }
      let overflow = queued.count == 4 ? queued.removeFirst() : nil
      queued.append(job)
      lock.unlock(); overflow?.promise.resolve(["error": "inference-busy"]); return
    }
    running = job
    lock.unlock()
    execute(job)
  }
  func cancel(_ owner: String, _ token: String) {
    lock.lock()
    if running?.owner == owner && running?.token == token { running?.cancelled = true }
    let index = queued.firstIndex(where: { $0.owner == owner && $0.token == token })
    let dropped = index.map { queued.remove(at: $0) }
    lock.unlock()
    dropped?.promise.resolve(["cancelled": true])
  }
  func submitVideo(_ account: String, _ project: String, _ generation: Int, _ owner: String, _ token: String, _ uri: String, _ sourceTimes: [Double], _ fps: Int,
                   _ category: String, _ promise: Promise, _ admitted: @escaping () -> Void) {
    lock.lock()
    guard initialized, videoToken == nil else {
      lock.unlock(); promise.resolve(["error": "inference-busy"]); return
    }
    guard validId(account), validId(project), generation >= 0, !owner.isEmpty, owner.count <= 100, token.count <= 100, uri.utf8.count <= 2_000,
          [24, 25, 30, 50, 60].contains(fps), !sourceTimes.isEmpty, sourceTimes.count <= 1_800,
          sourceTimes.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 10_000_000.0 / 30.0 }),
          ["background", "hair", "bodySkin", "faceSkin", "clothes", "others", "person"].contains(category) else {
      lock.unlock(); promise.resolve(["error": "inference-unavailable"]); return
    }
    let key = videoKey(owner, token); videoOwner = owner; videoToken = token; cancelledVideos.remove(key); lock.unlock()
    executor.async {
      admitted()
      let result: [String: Any] = autoreleasepool {
        do { return try self.segmentVideo(account, project: project, generation: generation, owner: owner, token: token,
          uri: uri, sourceTimes: sourceTimes, fps: fps, category: category) }
        catch { return self.videoCancelled(owner, token) ? ["cancelled": true] : ["error": "inference-unavailable"] }
      }
      self.lock.lock(); let cancelled = self.cancelledVideos.remove(key) != nil
      if self.videoOwner == owner && self.videoToken == token { self.videoOwner = nil; self.videoToken = nil }; self.lock.unlock()
      if cancelled, let uri = result["uri"] as? String, let file = URL(string: uri), file.isFileURL { try? FileManager.default.removeItem(at: file) }
      promise.resolve(cancelled ? ["cancelled": true] : result)
    }
  }
  func cancelVideo(_ owner: String, _ token: String) {
    lock.lock(); if videoOwner == owner && videoToken == token { cancelledVideos.insert(videoKey(owner, token)) }; lock.unlock()
  }
  private func videoKey(_ owner: String, _ token: String) -> String { "\(owner)\u{1f}\(token)" }
  private func videoCancelled(_ owner: String, _ token: String) -> Bool {
    lock.lock(); defer { lock.unlock() }; return cancelledVideos.contains(videoKey(owner, token))
  }
  private func validId(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 100 && value.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-"
    }
  }
  private func contains(_ root: URL, _ child: URL) -> Bool {
    child.path.hasPrefix(root.path.hasSuffix("/") ? root.path : root.path + "/")
  }
  private func semanticRoot(_ account: String, _ project: String) -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("veyrnox-editor-media", isDirectory: true)
      .appendingPathComponent(account, isDirectory: true).appendingPathComponent(project, isDirectory: true)
  }
  private func ownedInput(_ uri: String, account: String, project: String) throws -> URL {
    guard let parts = URLComponents(string: uri), parts.scheme == "file", parts.host == nil || parts.host?.isEmpty == true,
          parts.query == nil, parts.fragment == nil, let raw = parts.url else { throw VisionFailure.unavailable }
    let candidate = raw.standardizedFileURL.resolvingSymlinksInPath()
    let cache = semanticRoot(account, project).standardizedFileURL.resolvingSymlinksInPath()
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("veyrnox-editor-media", isDirectory: true).appendingPathComponent(account, isDirectory: true)
      .appendingPathComponent(project, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    guard contains(cache, candidate) || contains(documents, candidate) else { throw VisionFailure.unavailable }
    return candidate
  }
  private func sweepSemanticMasks() {
    let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("veyrnox-editor-media", isDirectory: true)
    guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else { return }
    for case let file as URL in enumerator where file.lastPathComponent.hasPrefix("vx-semantic-mask-") && file.pathExtension == "mp4" {
      try? FileManager.default.removeItem(at: file)
    }
  }
  private func segmentVideo(_ account: String, project: String, generation: Int, owner: String, token: String,
                            uri: String, sourceTimes: [Double], fps: Int, category: String) throws -> [String: Any] {
    let input = try ownedInput(uri, account: account, project: project)
    let asset = AVURLAsset(url: input)
    guard asset.isReadable, let track = asset.tracks(withMediaType: .video).first else { throw VisionFailure.unavailable }
    let duration = CMTimeGetSeconds(asset.duration)
    guard duration.isFinite, duration > 0, sourceTimes.allSatisfy({ $0 <= duration + 1 / Double(fps) }) else { throw VisionFailure.unavailable }
    let transformed = track.naturalSize.applying(track.preferredTransform), aspect = abs(transformed.width / transformed.height)
    guard aspect.isFinite, aspect >= 0.1, aspect <= 10 else { throw VisionFailure.unavailable }
    let width = aspect >= 1 ? 256 : max(8, Int((256 * aspect / 2).rounded()) * 2)
    let height = aspect >= 1 ? max(8, Int((256 / aspect / 2).rounded()) * 2) : 256
    let outputRoot = semanticRoot(account, project)
    try FileManager.default.createDirectory(at: outputRoot, withIntermediateDirectories: true)
    let output = outputRoot.appendingPathComponent("vx-semantic-mask-\(generation)-\(UUID().uuidString.lowercased()).mp4")
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    let inputWriter = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 600_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel]
    ])
    inputWriter.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: inputWriter, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
    ])
    guard writer.canAdd(inputWriter) else { throw VisionFailure.unavailable }
    writer.add(inputWriter); guard writer.startWriting() else { throw VisionFailure.unavailable }
    writer.startSession(atSourceTime: .zero)
    let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 600)
    var finished = false
    defer { if !finished { writer.cancelWriting(); try? FileManager.default.removeItem(at: output) } }
    for (index, seconds) in sourceTimes.enumerated() {
      if videoCancelled(owner, token) { throw VisionFailure.unavailable }
      let picture = try generator.copyCGImage(at: CMTime(seconds: min(duration - 0.000_001, seconds), preferredTimescale: 600_000), actualTime: nil)
      let plane = try engine.semanticPlane(image: picture, category: category, width: width, height: height)
      var buffer: CVPixelBuffer?
      guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &buffer) == kCVReturnSuccess,
        let pixel = buffer else { throw VisionFailure.unavailable }
      CVPixelBufferLockBaseAddress(pixel, []); defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
      guard let base = CVPixelBufferGetBaseAddress(pixel) else { throw VisionFailure.unavailable }
      let stride = CVPixelBufferGetBytesPerRow(pixel)
      for y in 0..<height { let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
        for x in 0..<width { let value = plane[y * width + x], offset = x * 4
          row[offset] = value; row[offset + 1] = value; row[offset + 2] = value; row[offset + 3] = 255
        }
      }
      while !inputWriter.isReadyForMoreMediaData { if videoCancelled(owner, token) { throw VisionFailure.unavailable }; Thread.sleep(forTimeInterval: 0.002) }
      guard adaptor.append(pixel, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: CMTimeScale(fps))) else { throw VisionFailure.unavailable }
    }
    inputWriter.markAsFinished(); let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }; semaphore.wait()
    guard writer.status == .completed else { throw VisionFailure.unavailable }
    finished = true
    let bytes = try output.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard bytes > 0, bytes <= 25 * 1024 * 1024 else { try? FileManager.default.removeItem(at: output); throw VisionFailure.unavailable }
    return ["ok": true, "uri": output.absoluteString, "bytes": bytes, "width": width, "height": height,
      "frames": sourceTimes.count, "fps": fps, "durationSeconds": Double(sourceTimes.count) / Double(fps), "videoCodec": "avc1", "generation": generation]
  }
  private func execute(_ job: Job) {
    executor.async {
      self.lock.lock(); let cancelled = job.cancelled; self.lock.unlock()
      var result: [String: Any] = ["cancelled": true]
      if !cancelled {
        job.admitted()
        result = autoreleasepool {
          do { return try self.engine.detect(op: job.op, jpeg: job.jpeg, width: job.width, height: job.height) }
          catch { return ["error": "inference-unavailable"] }
        }
      }
      self.lock.lock()
      if job.cancelled { result = ["cancelled": true] }
      let next = self.queued.isEmpty ? nil : self.queued.removeFirst(); self.running = next
      self.lock.unlock()
      job.promise.resolve(result)
      if let next = next { self.execute(next) }
    }
  }
}
public final class VeyrnoxVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeyrnoxVision")
    Events("admitted")
    AsyncFunction("capabilities") { (promise: Promise) in
      promise.resolve([
        "ok": true, "platform": "ios", "architecture": "expo-modules-new-architecture",
        "personMask": true, "semanticMask": true, "minimumIos": "16.4",
        "semanticMaskVideo": true,
        "categories": ["background", "hair", "body-skin", "face-skin", "clothes", "others"]
      ])
    }
    AsyncFunction("init") { (promise: Promise) in VisionWorker.shared.initialize(promise) }
    AsyncFunction("detect") { (owner: String, token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise) in
      VisionWorker.shared.submit(owner, token, op, jpeg, width, height, promise) { [weak self] in
        self?.sendEvent("admitted", ["token": token])
      }
    }
    AsyncFunction("segmentVideo") { (account: String, project: String, generation: Int, owner: String, token: String, uri: String, sourceTimes: [Double], fps: Int,
                                      category: String, promise: Promise) in
      VisionWorker.shared.submitVideo(account, project, generation, owner, token, uri, sourceTimes, fps, category, promise) { [weak self] in
        self?.sendEvent("admitted", ["token": token])
      }
    }
    Function("cancel") { (owner: String, token: String) in
      VisionWorker.shared.cancel(owner, token); VisionWorker.shared.cancelVideo(owner, token)
    }
  }
}
