import ExpoModulesCore
import Foundation

enum EditorMediaCode: String {
  case unsupportedPlatform = "unsupported-platform", moduleMissing = "module-missing"
  case invalidInput = "invalid-input", unsupportedCodec = "unsupported-codec", corruptMedia = "corrupt-media"
  case cancelled, busy, diskFull = "disk-full", writeFailed = "write-failed"
}

enum EditorMediaFailure: Error {
  case result(EditorMediaCode, String? = nil)
  var dictionary: [String: Any] {
    switch self { case .result(let code, let reason):
      var value: [String: Any] = ["ok": false, "code": code.rawValue]
      if let reason { value["reason"] = reason }; return value
    }
  }
}

struct EditorMediaIdentity: Equatable {
  let account: String, project: String, owner: String, token: String
  init(_ account: String, _ project: String, _ owner: String, _ token: String) throws {
    guard [account, project, owner, token].allSatisfy(Self.valid) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-identity")
    }
    self.account = account; self.project = project; self.owner = owner; self.token = token
  }
  private static func valid(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 100 && value.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
    }
  }
}

struct SampleFramesRequest: Record {
  @Field var uri: String = ""
  @Field var fromSeconds: Double = 0
  @Field var toSeconds: Double = 0
  @Field var maxFrames: Int = 900
  @Field var resizeMode: String = "contain"
  @Field var samplingMode: String = "uniform"
  @Field var maximumFrameRate: Int? = nil
}

struct DecodePcmRequest: Record {
  @Field var uri: String = ""
  @Field var fromSeconds: Double = 0
  @Field var toSeconds: Double = 0
  @Field var sampleRate: Int = 48_000
  @Field var channels: Int = 2
  @Field var mixMode: String? = nil
}

struct BeginEncodeRequest: Record {
  @Field var width: Int = 0
  @Field var height: Int = 0
  @Field var fps: Int = 30
  @Field var videoBitRate: Int = 6_000_000
  @Field var audioBitRate: Int? = nil
  @Field var audioArtifactId: String? = nil
  @Field var codec: String? = nil
  @Field var alpha: Bool? = nil
}

struct MotionProcessRequest: Record {
  @Field var uri: String = ""
  @Field var fromSeconds: Double = 0
  @Field var durationSeconds: Double? = nil
  @Field var tool: String = ""
  @Field var frameRate: Int = 30
  @Field var height: Int = 720
  @Field var alpha: Bool? = nil
  @Field var smoothing: Int = 10
  @Field var strength: Double = 1
  @Field var aspect: Double? = nil
  @Field var regionX: Double? = nil
  @Field var regionY: Double? = nil
  @Field var regionWidth: Double? = nil
  @Field var regionHeight: Double? = nil
  @Field var fromX: Double? = nil
  @Field var fromY: Double? = nil
  @Field var fromZoom: Double? = nil
  @Field var toX: Double? = nil
  @Field var toY: Double? = nil
  @Field var toZoom: Double? = nil
}

struct FrameRecord: Record {
  @Field var version: Int = 1
  @Field var uri: String = ""
  @Field var index: Int = 0
  @Field var timestampUs: Int64 = 0
  @Field var byteLength: Int = 0
  @Field var width: Int = 0
  @Field var height: Int = 0
  @Field var stride: Int = 0
  @Field var pixelFormat: String = "rgba8"
  @Field var colorSpace: String = "srgb"
}

struct EditorFrameDescriptor {
  let url: URL, index: Int, timestampUs: Int64, width: Int, height: Int, stride: Int
  static func parse(_ raw: FrameRecord, paths: EditorMediaPaths, identity: EditorMediaIdentity) throws -> Self {
    guard raw.version == 1, raw.pixelFormat == "rgba8", raw.colorSpace == "srgb",
          (1...1280).contains(raw.width), (1...1280).contains(raw.height),
          raw.stride == raw.width * 4, (0..<1800).contains(raw.index),
          (0...30_000_000).contains(raw.timestampUs) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-frame-descriptor")
    }
    let url = try paths.inputURL(raw.uri, identity: identity, cacheOnly: true)
    let expected = raw.width * raw.height * 4
    let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard raw.byteLength == expected, values.isRegularFile == true, values.fileSize == expected,
          url.lastPathComponent.hasPrefix("vx-frame-") else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-frame-file")
    }
    return Self(url: url, index: raw.index, timestampUs: raw.timestampUs,
      width: raw.width, height: raw.height, stride: raw.stride)
  }
  static func discard(_ records: [FrameRecord], paths: EditorMediaPaths, identity: EditorMediaIdentity) {
    for raw in records {
      guard let url = try? paths.inputURL(raw.uri, identity: identity, cacheOnly: true),
            url.lastPathComponent.hasPrefix("vx-frame-"),
            (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
      try? FileManager.default.removeItem(at: url)
    }
  }
}

func mediaResult(_ work: () throws -> [String: Any]) -> [String: Any] {
  do { return try work() }
  catch let error as EditorMediaFailure { return error.dictionary }
  catch { return EditorMediaFailure.result(.writeFailed).dictionary }
}
