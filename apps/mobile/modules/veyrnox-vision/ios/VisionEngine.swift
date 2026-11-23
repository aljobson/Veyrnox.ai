import UIKit
import ImageIO
import MediaPipeTasksVision

enum VisionFailure: Error { case unavailable }
final class VisionEngine {
  private var face: FaceLandmarker?
  private var segmenter: ImageSegmenter?

  func initialize() throws {
    if face != nil && segmenter != nil { return }
    let owner = Bundle(for: VisionEngine.self)
    guard let url = owner.url(forResource: "VeyrnoxVisionModels", withExtension: "bundle")
      ?? Bundle.main.url(forResource: "VeyrnoxVisionModels", withExtension: "bundle"),
      let bundle = Bundle(url: url),
      let facePath = bundle.path(forResource: "face_landmarker", ofType: "task"),
      let hairPath = bundle.path(forResource: "selfie_multiclass_256x256", ofType: "tflite")
    else { throw VisionFailure.unavailable }
    let f = FaceLandmarkerOptions()
    f.baseOptions.modelAssetPath = facePath
    f.baseOptions.delegate = .CPU
    f.runningMode = .image
    f.numFaces = 2
    f.outputFaceBlendshapes = false
    f.outputFacialTransformationMatrixes = false
    let h = ImageSegmenterOptions()
    h.baseOptions.modelAssetPath = hairPath
    h.baseOptions.delegate = .CPU
    h.runningMode = .image
    h.shouldOutputConfidenceMasks = true
    h.shouldOutputCategoryMask = false
    let newFace = try FaceLandmarker(options: f)
    let newSegmenter = try ImageSegmenter(options: h)
    guard newSegmenter.labels == ["background", "hair", "body-skin", "face-skin", "clothes", "others"]
    else { throw VisionFailure.unavailable }
    face = newFace
    segmenter = newSegmenter
  }

  func detect(op: String, jpeg: String, width: Int, height: Int) throws -> [String: Any] {
    guard ["detect", "swapDetect", "semanticMask"].contains(op), (8...384).contains(width),
      (8...384).contains(height), jpeg.utf8.count <= 900_000,
      jpeg.hasPrefix("data:image/jpeg;base64,"),
      let data = Data(base64Encoded: String(jpeg.dropFirst(23))),
      data.starts(with: [0xff, 0xd8]),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      properties[kCGImagePropertyPixelWidth] as? Int == width,
      properties[kCGImagePropertyPixelHeight] as? Int == height,
      let image = UIImage(data: data),
      image.imageOrientation == .up, let cg = image.cgImage,
      cg.width == width, cg.height == height,
      let face = face, let segmenter = segmenter else { throw VisionFailure.unavailable }
    let input = try MPImage(uiImage: image)
    let faces = op == "semanticMask" ? nil : try face.detect(image: input).faceLandmarks
    let count = min(2, faces?.count ?? 0)
    var result: [String: Any] = ["count": count, "landmarks": [Float](), "width": width, "height": height]
    if op != "semanticMask" && count != 1 {
      if op == "detect" { result["hair"] = NSNull() }
      return result
    }
    if op != "semanticMask" {
      guard let faceLandmarks = faces?.first else { throw VisionFailure.unavailable }
      let landmarks = faceLandmarks.flatMap { [$0.x, $0.y, $0.z] }
      guard landmarks.count == 1434, landmarks.allSatisfy({ $0.isFinite && abs($0) <= 2 })
      else { throw VisionFailure.unavailable }
      result["landmarks"] = landmarks
    }
    // IMAGE results own copied masks; the per-call autoreleasepool releases all images and masks.
    let segmentation = try segmenter.segment(image: input)
    guard let masks = segmentation.confidenceMasks, masks.count == 6 else { throw VisionFailure.unavailable }
    if op == "semanticMask" {
      result["width"] = width; result["height"] = height
      var pngs: [String: String] = [:]
      for (index, key) in ["background", "hair", "bodySkin", "faceSkin", "clothes", "others"].enumerated() {
        let plane = try quantize(masks[index], width: width, height: height)
        result[key] = Data(plane).base64EncodedString(); pngs[key] = try maskPng(plane, width: width, height: height)
      }
      let person = try combine(masks: Array(masks[1...5]), width: width, height: height)
      result["person"] = Data(person).base64EncodedString(); pngs["person"] = try maskPng(person, width: width, height: height)
      result["maskPngs"] = pngs
    } else if op == "detect" {
      let mask = masks[1]
      result["width"] = mask.width
      result["height"] = mask.height
      result["hair"] = try quantize(mask, width: mask.width, height: mask.height).map { Int($0) }
    } else {
      for (key, index) in [("background", 0), ("body", 2), ("face", 3)] {
        result[key] = try Data(quantize(masks[index], width: width, height: height)).base64EncodedString()
      }
    }
    return result
  }

  func semanticPlane(image: CGImage, category: String, width: Int, height: Int) throws -> [UInt8] {
    guard (8...384).contains(width), (8...384).contains(height),
          ["background", "hair", "bodySkin", "faceSkin", "clothes", "others", "person"].contains(category),
          let segmenter else { throw VisionFailure.unavailable }
    let input = try MPImage(uiImage: UIImage(cgImage: image))
    let segmentation = try segmenter.segment(image: input)
    guard let masks = segmentation.confidenceMasks, masks.count == 6 else { throw VisionFailure.unavailable }
    if category == "person" { return try combine(masks: Array(masks[1...5]), width: width, height: height) }
    let indexes = ["background": 0, "hair": 1, "bodySkin": 2, "faceSkin": 3, "clothes": 4, "others": 5]
    guard let index = indexes[category] else { throw VisionFailure.unavailable }
    return try quantize(masks[index], width: width, height: height)
  }

  private func quantize(_ mask: Mask, width: Int, height: Int) throws -> [UInt8] {
    guard (8...512).contains(mask.width), (8...512).contains(mask.height) else { throw VisionFailure.unavailable }
    let values = mask.float32Data
    guard values.count == mask.width * mask.height else { throw VisionFailure.unavailable }
    for i in 0..<(mask.width * mask.height) {
      guard values[i].isFinite && values[i] >= 0 && values[i] <= 1 else { throw VisionFailure.unavailable }
    }
    return (0..<(width * height)).map { i in
      let x = min(mask.width - 1, Int((Double(i % width) + 0.5) * Double(mask.width) / Double(width)))
      let y = min(mask.height - 1, Int((Double(i / width) + 0.5) * Double(mask.height) / Double(height)))
      return UInt8(floor(Double(values[y * mask.width + x]) * 255 + 0.5))
    }
  }

  private func combine(masks: [Mask], width: Int, height: Int) throws -> [UInt8] {
    let values = try masks.map { try quantize($0, width: width, height: height) }
    return (0..<(width * height)).map { index in
      let probability = min(1, values.reduce(0.0) { $0 + Double($1[index]) / 255.0 })
      return UInt8(floor(probability * 255.0 + 0.5))
    }
  }

  private func maskPng(_ mask: [UInt8], width: Int, height: Int) throws -> String {
    var rgba = [UInt8](repeating: 255, count: width * height * 4)
    for index in mask.indices { rgba[index * 4 + 3] = mask[index] }
    guard let provider = CGDataProvider(data: Data(rgba) as CFData),
          let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent),
          let png = UIImage(cgImage: image).pngData(), png.count <= 1_048_576 else { throw VisionFailure.unavailable }
    return png.base64EncodedString()
  }
}
