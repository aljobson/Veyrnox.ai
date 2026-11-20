import UIKit
import ImageIO
import MediaPipeTasksVision

private enum VisionFailure: Error { case unavailable }
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
    guard ["detect", "swapDetect"].contains(op), (8...384).contains(width),
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
    let faces = try face.detect(image: input).faceLandmarks
    let count = min(2, faces.count)
    var result: [String: Any] = ["count": count, "landmarks": [Float](), "width": width, "height": height]
    if count != 1 {
      if op == "detect" { result["hair"] = NSNull() }
      return result
    }
    let landmarks = faces[0].flatMap { [$0.x, $0.y, $0.z] }
    guard landmarks.count == 1434, landmarks.allSatisfy({ $0.isFinite && abs($0) <= 2 })
    else { throw VisionFailure.unavailable }
    result["landmarks"] = landmarks
    // IMAGE results own copied masks; the per-call autoreleasepool releases all images and masks.
    let segmentation = try segmenter.segment(image: input)
    guard let masks = segmentation.confidenceMasks, masks.count == 6 else { throw VisionFailure.unavailable }
    if op == "detect" {
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

  private func quantize(_ mask: Mask, width: Int, height: Int) throws -> [UInt8] {
    guard (8...512).contains(mask.width), (8...512).contains(mask.height) else { throw VisionFailure.unavailable }
    let values = mask.float32Data
    for i in 0..<(mask.width * mask.height) {
      guard values[i].isFinite && values[i] >= 0 && values[i] <= 1 else { throw VisionFailure.unavailable }
    }
    return (0..<(width * height)).map { i in
      let x = min(mask.width - 1, Int((Double(i % width) + 0.5) * Double(mask.width) / Double(width)))
      let y = min(mask.height - 1, Int((Double(i / width) + 0.5) * Double(mask.height) / Double(height)))
      return UInt8(floor(Double(values[y * mask.width + x]) * 255 + 0.5))
    }
  }
}
