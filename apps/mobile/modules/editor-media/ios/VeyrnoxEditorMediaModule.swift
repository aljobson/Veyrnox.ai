import ExpoModulesCore
import AVFoundation
import CoreImage
import CoreText
import Foundation
import ImageIO
import Speech
import Translation
import UIKit

public final class VeyrnoxEditorMediaModule: Module {
  private var colorPickerSession: EditorColorPickerSession?

  public func definition() -> ModuleDefinition {
    Name("VeyrnoxEditorMedia")
    Events("progress")

    AsyncFunction("capabilities") { (promise: Promise) in
      EditorMediaWorker.shared.capabilities(promise)
    }
    AsyncFunction("setOwner") { (account: String?, clientOwner: String, clientEpoch: Int, promise: Promise) in
      EditorMediaWorker.shared.setOwner(account, clientOwner: clientOwner, clientEpoch: clientEpoch,
        promise: promise)
    }
    AsyncFunction("setProjectGeneration") { (account: String, project: String, generation: Int, promise: Promise) in
      EditorMediaWorker.shared.setProjectGeneration(account, project: project, generation: generation, promise: promise)
    }
    AsyncFunction("inspect") { (account: String, project: String, owner: String, token: String,
                                 uri: String, promise: Promise) in
      EditorMediaWorker.shared.inspect(account, project, owner, token, uri: uri, promise: promise,
        progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("sampleFrames") { (account: String, project: String, owner: String, token: String,
                                      request: SampleFramesRequest, promise: Promise) in
      EditorMediaWorker.shared.sampleFrames(account, project, owner, token, request: request, promise: promise,
        progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("decodePcm") { (account: String, project: String, owner: String, token: String,
                                  request: DecodePcmRequest, promise: Promise) in
      EditorMediaWorker.shared.decodePcm(account, project, owner, token, request: request, promise: promise,
        progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("mixAudio") { (account: String, project: String, owner: String, token: String,
                                  mixJSON: String, sources: [String: String], frames: Int, fps: Int,
                                  promise: Promise) in
      EditorMediaWorker.shared.mixAudio(account, project, owner, token, mixJSON: mixJSON,
        sources: sources, frames: frames, fps: fps, promise: promise,
        progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("beginEncode") { (account: String, project: String, owner: String, token: String,
                                     request: BeginEncodeRequest, promise: Promise) in
      EditorMediaWorker.shared.beginEncode(account, project, owner, token, request: request, promise: promise,
        progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("appendFrameBatch") { (account: String, project: String, owner: String, token: String,
                                          sessionId: String, frames: [FrameRecord], promise: Promise) in
      EditorMediaWorker.shared.appendFrameBatch(account, project, owner, token, sessionId: sessionId,
        frames: frames, promise: promise, progress: self.progress(account, project, owner, token))
    }
    AsyncFunction("finishEncode") { (account: String, project: String, owner: String, token: String,
                                      sessionId: String, audioArtifactId: String?, promise: Promise) in
      EditorMediaWorker.shared.finishEncode(account, project, owner, token, sessionId: sessionId,
        audioArtifactId: audioArtifactId, promise: promise, progress: self.progress(account, project, owner, token))
    }
    Function("cancel") { (account: String, project: String, owner: String, token: String) in
      EditorMediaWorker.shared.cancel(account, project, owner, token)
    }
    AsyncFunction("cancelProject") { (account: String, project: String, promise: Promise) in
      EditorMediaWorker.shared.cancelProject(account, project, promise: promise)
    }
    AsyncFunction("release") { (account: String, project: String, artifactId: String, promise: Promise) in
      EditorMediaWorker.shared.release(account, project, artifactId: artifactId, promise: promise)
    }
    AsyncFunction("pickColor") { (initialHex: String, promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let self else { promise.resolve(nil); return }
        self.presentColorPicker(initialHex, promise: promise)
      }
    }
  }

  private func presentColorPicker(_ initialHex: String, promise: Promise) {
    if let existing = colorPickerSession {
      guard existing.controller.presentingViewController == nil else { promise.resolve(nil); return }
      existing.cancel()
    }
    guard let presenter = appContext?.utilities?.currentViewController() else { promise.resolve(nil); return }
    let session = EditorColorPickerSession(initialHex: initialHex, promise: promise) { [weak self] in self?.colorPickerSession = nil }
    colorPickerSession = session
    session.controller.modalPresentationStyle = .pageSheet
    session.controller.presentationController?.delegate = session
    presenter.present(session.controller, animated: true) { session.controller.presentationController?.delegate = session }
  }

  private func progress(_ account: String, _ project: String, _ owner: String, _ token: String)
    -> EditorMediaWorker.Progress {
    { [weak self] stage, value in
      self?.sendEvent("progress", ["account": account, "project": project, "owner": owner,
        "token": token, "stage": stage, "value": value])
    }
  }
}

private final class EditorColorPickerSession: NSObject, UIColorPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  let controller = EditorColorPickerViewController()
  private let promise: Promise
  private let finished: () -> Void
  private var selected: UIColor
  private var resolved = false

  init(initialHex: String, promise: Promise, finished: @escaping () -> Void) {
    self.promise = promise
    self.finished = finished
    selected = UIColor(editorHex: initialHex) ?? .white
    super.init()
    controller.selectedColor = selected
    controller.supportsAlpha = false
    controller.delegate = self
    controller.onDisappear = { [weak self] in self?.cancel() }
  }

  func colorPickerViewController(_ viewController: UIColorPickerViewController, didSelect color: UIColor, continuously: Bool) {
    selected = color
  }

  func colorPickerViewControllerDidFinish(_ viewController: UIColorPickerViewController) {
    selected = viewController.selectedColor
    resolve()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { resolve() }

  func cancel() {
    guard !resolved else { return }
    resolved = true
    promise.resolve(nil)
    finished()
  }

  private func resolve() {
    guard !resolved else { return }
    resolved = true
    promise.resolve(selected.editorHex)
    finished()
  }
}

private final class EditorColorPickerViewController: UIColorPickerViewController {
  var onDisappear: (() -> Void)?

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    onDisappear?()
  }
}

private extension UIColor {
  convenience init?(editorHex: String) {
    let value = editorHex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
    guard value.count == 6, let number = UInt64(value, radix: 16) else { return nil }
    self.init(red: CGFloat((number >> 16) & 0xff) / 255, green: CGFloat((number >> 8) & 0xff) / 255,
      blue: CGFloat(number & 0xff) / 255, alpha: 1)
  }

  var editorHex: String {
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    let converted = cgColor.converted(to: srgb, intent: .defaultIntent, options: nil).map(UIColor.init(cgColor:)) ?? self
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard converted.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return "#FFFFFF" }
    let byte = { (component: CGFloat) in Int((min(1, max(0, component)) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
  }
}

enum EditorCompositor {
  private static let queue = DispatchQueue(label: "ai.veyrnox.editor-compositor")
  private static let ci = CIContext(options: [.cacheIntermediates: false])
  private static let maximumPlanBytes = 256 * 1024
  private enum SemanticPass { case normal, base, foreground }
  private enum PaintLayer { case visual(Int, SemanticPass), text(Int) }

  static func render(_ account: String, _ project: String, _ owner: String, _ token: String,
                     _ planJSON: String, _ sources: [String: String], _ width: Int, _ height: Int,
                     _ index: Int, _ timestampUs: Int64, promise: Promise) {
    queue.async {
      promise.resolve(mediaResult {
        let identity = try EditorMediaIdentity(account, project, owner, token)
        guard (1...1280).contains(width), (1...1280).contains(height), width * height <= 1280 * 720,
              (0..<1800).contains(index), (0...30_000_000).contains(timestampUs),
              planJSON.utf8.count <= maximumPlanBytes, sources.count <= 40,
              let data = planJSON.data(using: .utf8),
              let plan = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let visuals = plan["visuals"] as? [[String: Any]], visuals.count <= 40,
              let texts = plan["texts"] as? [[String: Any]], texts.count <= 150 else {
          throw EditorMediaFailure.result(.invalidInput, "invalid-compositor-plan")
        }
        let frame = try draw(plan: plan, visuals: visuals, texts: texts, sources: sources,
          identity: identity, width: width, height: height)
        let folder = EditorMediaPaths.shared.projectCache(identity)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        catch { throw EditorMediaFailure.result(.writeFailed) }
        let file = folder.appendingPathComponent("vx-frame-\(UUID().uuidString.lowercased()).rgba")
        do { try frame.write(to: file, options: .atomic) }
        catch { try? FileManager.default.removeItem(at: file); throw EditorMediaFailure.result(.writeFailed) }
        return ["ok": true, "version": 1, "uri": file.absoluteString, "index": index,
          "timestampUs": timestampUs, "byteLength": frame.count, "width": width, "height": height,
          "stride": width * 4, "pixelFormat": "rgba8", "colorSpace": "srgb"]
      })
    }
  }

  static func discard(_ account: String, _ project: String, _ owner: String, _ token: String,
                      _ uris: [String]) {
    guard uris.count <= 8, let identity = try? EditorMediaIdentity(account, project, owner, token) else { return }
    for uri in uris {
      guard let file = try? EditorMediaPaths.shared.inputURL(uri, identity: identity, cacheOnly: true),
            file.lastPathComponent.hasPrefix("vx-frame-"), file.pathExtension == "rgba" else { continue }
      try? FileManager.default.removeItem(at: file)
    }
  }

  private static func draw(plan: [String: Any], visuals: [[String: Any]], texts: [[String: Any]],
                           sources: [String: String], identity: EditorMediaIdentity,
                           width: Int, height: Int) throws -> Data {
    var output = Data(count: width * height * 4)
    let ok = output.withUnsafeMutableBytes { raw -> Bool in
      guard let base = raw.baseAddress,
            let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
              bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
      context.translateBy(x: 0, y: CGFloat(height)); context.scaleBy(x: 1, y: -1)
      if plan["transparentBackground"] as? Bool != true {
        context.setFillColor(color(plan["background"] as? String ?? "#000000").cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
      }
      do {
        for layer in subjectCompositeOrder(visuals: visuals, texts: texts) {
          switch layer {
          case let .visual(index, semantic):
            try drawVisual(visuals[index], semantic: semantic, sources: sources, identity: identity,
              in: context, width: width, height: height)
          case let .text(index):
            try drawText(texts[index], sources: sources, identity: identity, in: context, width: width, height: height)
          }
        }
      } catch { return false }
      return true
    }
    guard ok else { throw EditorMediaFailure.result(.unsupportedCodec, "compositor-source-unavailable") }
    return output
  }

  /// Matches the web compositor's deterministic paint list. A subject which owns opted-in
  /// overlays is painted once without its person matte, then those overlays, then once through
  /// its matte. Claimed overlays are not painted again at their ordinary layer positions.
  private static func subjectCompositeOrder(visuals: [[String: Any]], texts: [[String: Any]]) -> [PaintLayer] {
    var subjects = Set<String>()
    for visual in visuals {
      guard let clip = visual["clip"] as? [String: Any], let id = clip["id"] as? String,
            let semantic = clip["semanticMask"] as? [String: Any], semantic["category"] as? String == "person" else { continue }
      subjects.insert(id)
    }
    var visualBehind: [String: [Int]] = [:], textBehind: [String: [Int]] = [:]
    for (index, visual) in visuals.enumerated() {
      guard let clip = visual["clip"] as? [String: Any], let subject = clip["behindSubject"] as? String,
            subjects.contains(subject) else { continue }
      visualBehind[subject, default: []].append(index)
    }
    for (index, text) in texts.enumerated() {
      guard let item = text["item"] as? [String: Any], let subject = item["behindSubject"] as? String,
            subjects.contains(subject) else { continue }
      textBehind[subject, default: []].append(index)
    }
    let claimedVisuals = Set(visualBehind.values.flatMap { $0 })
    let claimedTexts = Set(textBehind.values.flatMap { $0 })
    var result: [PaintLayer] = []
    for (index, visual) in visuals.enumerated() {
      if claimedVisuals.contains(index) { continue }
      let clip = visual["clip"] as? [String: Any], id = clip?["id"] as? String
      let behindVisuals = id.flatMap { visualBehind[$0] } ?? [], behindTexts = id.flatMap { textBehind[$0] } ?? []
      if behindVisuals.isEmpty && behindTexts.isEmpty { result.append(.visual(index, .normal)); continue }
      result.append(.visual(index, .base))
      result.append(contentsOf: behindVisuals.map { .visual($0, .normal) })
      result.append(contentsOf: behindTexts.map { .text($0) })
      result.append(.visual(index, .foreground))
    }
    for index in texts.indices where !claimedTexts.contains(index) { result.append(.text(index)) }
    return result
  }

  private static func drawVisual(_ visual: [String: Any], semantic: SemanticPass,
                                 sources: [String: String], identity: EditorMediaIdentity,
                                 in context: CGContext, width: Int, height: Int) throws {
    guard let clip = visual["clip"] as? [String: Any], let mediaId = clip["mediaId"] as? String,
          let sourceTime = visual["sourceTimeSeconds"] as? Double, sourceTime.isFinite, sourceTime >= 0,
          let transform = visual["transform"] as? [String: Any], let crop = visual["crop"] as? [String: Any],
          let x = number(transform["x"]), let y = number(transform["y"]), let scale = number(transform["scale"]),
          let rotation = number(transform["rotation"]), let opacity = number(transform["opacity"]),
          let cropX = number(crop["x"]), let cropY = number(crop["y"]), let cropW = number(crop["width"]),
          let cropH = number(crop["height"]), scale > 0, opacity >= 0, opacity <= 1,
          cropX >= 0, cropY >= 0, cropW > 0, cropH > 0, cropX + cropW <= 1.000001, cropY + cropH <= 1.000001 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-compositor-layer")
    }
    let image: CGImage
    if let media = visual["media"] as? [String: Any], media["kind"] as? String == "graphic",
       let graphic = media["graphic"] as? [String: Any] { image = try graphicImage(graphic) }
    else {
      guard let source = sources[mediaId], let sourceURL = try? EditorMediaPaths.shared.inputURL(source, identity: identity) else {
        throw EditorMediaFailure.result(.invalidInput, "compositor-source-unavailable")
      }
      image = try sourceImage(sourceURL, at: sourceTime)
    }
    let pixels = CGRect(x: CGFloat(cropX) * CGFloat(image.width), y: CGFloat(cropY) * CGFloat(image.height),
      width: CGFloat(cropW) * CGFloat(image.width), height: CGFloat(cropH) * CGFloat(image.height)).integral
    guard let cropped = image.cropping(to: pixels) else {
      throw EditorMediaFailure.result(.corruptMedia, "compositor-filter-failed")
    }
    let fit = visual["fit"] as? String ?? "contain"
    let ratio = fit == "cover" ? max(CGFloat(width) / CGFloat(cropped.width), CGFloat(height) / CGFloat(cropped.height))
      : min(CGFloat(width) / CGFloat(cropped.width), CGFloat(height) / CGFloat(cropped.height))
    let targetWidth = max(1, Int((CGFloat(cropped.width) * ratio).rounded())), targetHeight = max(1, Int((CGFloat(cropped.height) * ratio).rounded()))
    guard let scaled = resized(cropped, width: targetWidth, height: targetHeight), let filtered = filtered(scaled, visual: visual) else {
      throw EditorMediaFailure.result(.corruptMedia, "compositor-filter-failed")
    }
    let size = CGSize(width: targetWidth, height: targetHeight)
    var alpha = CGFloat(opacity), tx = CGFloat(x) * CGFloat(width), ty = CGFloat(y) * CGFloat(height)
    var zoom: CGFloat = 1, spin: CGFloat = 0
    if let transition = visual["transition"] as? [String: Any] {
      alpha *= CGFloat(number(transition["alpha"]) ?? 1)
      tx += CGFloat(number(transition["slideX"]) ?? 0) * CGFloat(width)
      ty += CGFloat(number(transition["slideY"]) ?? 0) * CGFloat(height)
      zoom = CGFloat(number(transition["zoom"]) ?? 1); spin = CGFloat(number(transition["spin"]) ?? 0)
    }
    if semantic != .foreground {
      context.saveGState()
      if let reveal = visual["reveal"] as? [String: Any] { clipReveal(reveal, rect: CGRect(x: 0, y: 0, width: width, height: height), context: context) }
      try drawBackground(clip: clip, visual: visual, source: image, sources: sources, identity: identity,
        context: context, width: width, height: height, alpha: alpha)
      context.restoreGState()
    }
    context.saveGState()
    context.setAlpha(alpha); context.setBlendMode(blend(visual["blend"] as? String))
    context.translateBy(x: tx, y: ty); context.rotate(by: CGFloat((rotation + Double(spin)) * .pi / 180))
    let flipX = transform["flipX"] as? Bool == true ? -1.0 : 1.0
    let flipY = transform["flipY"] as? Bool == true ? -1.0 : 1.0
    context.scaleBy(x: CGFloat(scale) * zoom * flipX, y: CGFloat(scale) * zoom * flipY)
    let destination = CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height)
    if let transition = visual["transition"] as? [String: Any] {
      if let wipe = transition["wipe"] as? [String: Any] { clipWipe(wipe, rect: destination, context: context) }
      if let shape = transition["shape"] as? [String: Any] { clipTransitionShape(shape, rect: destination, context: context) }
    }
    if let reveal = visual["reveal"] as? [String: Any] { clipReveal(reveal, rect: destination, context: context) }
    if let mask = visual["mask"] as? [String: Any] { try Self.clip(mask: mask, size: size, context: context) }
    if semantic != .base, let semanticMask = clip["semanticMask"] as? [String: Any] {
      if let dynamic = semanticMask["dynamic"] as? [String: Any] {
        guard let storedIdentity = dynamic["identity"] as? String, let currentIdentity = visual["semanticMaskIdentity"] as? String,
              storedIdentity == currentIdentity, let frames = dynamic["frames"] as? Int, frames == (clip["len"] as? Int),
              let offset = number(visual["offset"]), offset >= 0, offset < Double(frames) else {
          throw EditorMediaFailure.result(.invalidInput, "semantic-mask-source-changed")
        }
      } else {
        guard let storedSourceFrame = number(semanticMask["sourceFrame"]),
              let currentSourceFrame = number(visual["semanticMaskSourceFrame"]),
              abs(storedSourceFrame - currentSourceFrame) < 0.000001 else {
          throw EditorMediaFailure.result(.invalidInput, "semantic-mask-source-changed")
        }
      }
      guard let mediaId = semanticMask["mediaId"] as? String, let maskSource = sources[mediaId],
            let maskURL = try? EditorMediaPaths.shared.inputURL(maskSource, identity: identity),
            let decodedMask = try? sourceImage(maskURL, at: (semanticMask["dynamic"] as? [String: Any]).flatMap {
              guard let maskFps = number($0["fps"]), maskFps > 0 else { return nil }
              return (number(visual["offset"]) ?? 0) / maskFps
            } ?? 0),
            let maskImage = grayMask(decodedMask),
            let croppedMask = maskImage.cropping(to: CGRect(x: CGFloat(cropX) * CGFloat(maskImage.width),
              y: CGFloat(cropY) * CGFloat(maskImage.height), width: CGFloat(cropW) * CGFloat(maskImage.width),
              height: CGFloat(cropH) * CGFloat(maskImage.height)).integral) else {
        throw EditorMediaFailure.result(.invalidInput, "semantic-mask-unavailable")
      }
      context.clip(to: destination, mask: croppedMask)
    }
    context.draw(filtered, in: destination)
    if let effect = clip["effect"] as? [String: Any] {
      drawEffectOverlay(effect, offset: number(visual["offset"]) ?? 0, rect: destination, source: filtered, context: context)
    }
    context.restoreGState()
    if semantic != .base, let transition = visual["transition"] as? [String: Any] {
      let flash = number(transition["flash"]) ?? 0, leak = number(transition["lightLeak"]) ?? 0
      if flash > 0 { context.saveGState(); context.setBlendMode(.screen); context.setAlpha(CGFloat(min(1, flash * 0.75))); context.setFillColor(UIColor.white.cgColor); context.fill(CGRect(x: 0, y: 0, width: width, height: height)); context.restoreGState() }
      if leak > 0 { drawLightLeak(CGFloat(leak), context: context, width: width, height: height) }
    }
  }

  private static func drawBackground(clip: [String: Any], visual: [String: Any], source: CGImage,
                                     sources: [String: String], identity: EditorMediaIdentity,
                                     context: CGContext, width: Int, height: Int, alpha: CGFloat) throws {
    guard let background = clip["background"] as? [String: Any], let type = background["type"] as? String, type != "none" else { return }
    context.saveGState(); defer { context.restoreGState() }
    context.setAlpha(alpha); context.setBlendMode(.normal)
    if let transition = visual["transition"] as? [String: Any], let wipe = transition["wipe"] as? [String: Any] {
      clipWipe(wipe, rect: CGRect(x: 0, y: 0, width: width, height: height), context: context)
    }
    if let transition = visual["transition"] as? [String: Any], let shape = transition["shape"] as? [String: Any] {
      clipTransitionShape(shape, rect: CGRect(x: 0, y: 0, width: width, height: height), context: context)
    }
    let backgroundRect = CGRect(x: 0, y: 0, width: width, height: height)
    if type == "gradient" {
      let first = color(background["color"] as? String ?? "#000000").cgColor
      let second = color(background["secondaryColor"] as? String ?? "#4B2BFF").cgColor
      if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [first, second] as CFArray, locations: [0, 1]) {
        let radians = CGFloat(number(background["angle"]) ?? 135) * .pi / 180
        let center = CGPoint(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
        let radius = hypot(CGFloat(width), CGFloat(height)) / 2
        let vector = CGPoint(x: cos(radians) * radius, y: sin(radians) * radius)
        context.drawLinearGradient(gradient, start: CGPoint(x: center.x - vector.x, y: center.y - vector.y),
          end: CGPoint(x: center.x + vector.x, y: center.y + vector.y), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
      }
    } else {
      context.setFillColor(color(background["color"] as? String ?? "#000000").cgColor)
      context.fill(backgroundRect)
    }
    var picture: CGImage?
    if type == "blur" { picture = source }
    else if type == "image", let media = visual["backgroundMedia"] as? [String: Any], media["kind"] as? String == "graphic",
            let graphic = media["graphic"] as? [String: Any] { picture = try graphicImage(graphic) }
    else if type == "image", let mediaId = background["mediaId"] as? String, let uri = sources[mediaId],
            let url = try? EditorMediaPaths.shared.inputURL(uri, identity: identity) { picture = try? sourceImage(url, at: 0) }
    else if type == "video", let mediaId = background["mediaId"] as? String, let uri = sources[mediaId],
            let url = try? EditorMediaPaths.shared.inputURL(uri, identity: identity) {
      picture = try? sourceImage(url, at: number(visual["sourceTimeSeconds"]) ?? 0)
    }
    guard let picture else { return }
    let crop: CGRect
    if type == "blur", let value = visual["crop"] as? [String: Any] {
      crop = CGRect(x: CGFloat(number(value["x"]) ?? 0) * CGFloat(picture.width), y: CGFloat(number(value["y"]) ?? 0) * CGFloat(picture.height),
        width: CGFloat(number(value["width"]) ?? 1) * CGFloat(picture.width), height: CGFloat(number(value["height"]) ?? 1) * CGFloat(picture.height)).integral
    } else { crop = CGRect(x: 0, y: 0, width: picture.width, height: picture.height) }
    guard let cropped = picture.cropping(to: crop) else { throw EditorMediaFailure.result(.corruptMedia, "background-crop-failed") }
    let pad = type == "blur" ? CGFloat(number(background["blur"]) ?? 18) * CGFloat(height) / 720 * 3 : 0
    let factor = max((CGFloat(width) + pad * 2) / CGFloat(cropped.width), (CGFloat(height) + pad * 2) / CGFloat(cropped.height))
    let scaledWidth = max(1, Int((CGFloat(cropped.width) * factor).rounded())), scaledHeight = max(1, Int((CGFloat(cropped.height) * factor).rounded()))
    guard let scaled = resized(cropped, width: scaledWidth, height: scaledHeight) else { throw EditorMediaFailure.result(.corruptMedia, "background-scale-failed") }
    var ciImage = CIImage(cgImage: scaled)
    if type == "blur" {
      let filter = CIFilter(name: "CIGaussianBlur")!; filter.setValue(ciImage, forKey: kCIInputImageKey)
      filter.setValue(min(60, number(background["blur"]) ?? 18) * Double(height) / 720, forKey: kCIInputRadiusKey)
      ciImage = filter.outputImage ?? ciImage
    }
    guard let rendered = ci.createCGImage(ciImage, from: ciImage.extent) else { return }
    let renderedWidth = CGFloat(rendered.width), renderedHeight = CGFloat(rendered.height)
    context.draw(rendered, in: CGRect(x: (CGFloat(width) - renderedWidth) / 2,
      y: (CGFloat(height) - renderedHeight) / 2, width: renderedWidth, height: renderedHeight))
  }

  private static func clipReveal(_ reveal: [String: Any], rect: CGRect, context: CGContext) {
    guard let x = number(reveal["x"]), let y = number(reveal["y"]), let w = number(reveal["width"]), let h = number(reveal["height"]),
          x != 0 || y != 0 || w != 1 || h != 1 else { return }
    context.clip(to: CGRect(x: rect.minX + CGFloat(x) * rect.width, y: rect.minY + CGFloat(y) * rect.height,
      width: CGFloat(w) * rect.width, height: CGFloat(h) * rect.height))
  }

  private static func clipWipe(_ wipe: [String: Any], rect: CGRect, context: CGContext) {
    let p = CGFloat(min(1, max(0, number(wipe["progress"]) ?? 0))), direction = wipe["direction"] as? String ?? "left"
    let area: CGRect
    switch direction {
    case "right": area = CGRect(x: rect.maxX - rect.width * p, y: rect.minY, width: rect.width * p, height: rect.height)
    case "up": area = CGRect(x: rect.minX, y: rect.maxY - rect.height * p, width: rect.width, height: rect.height * p)
    case "down": area = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height * p)
    default: area = CGRect(x: rect.minX, y: rect.minY, width: rect.width * p, height: rect.height)
    }
    context.clip(to: area)
  }

  private static func clipTransitionShape(_ shape: [String: Any], rect: CGRect, context: CGContext) {
    let p = CGFloat(min(1, max(0, number(shape["progress"]) ?? 0))), kind = shape["kind"] as? String ?? ""
    context.beginPath()
    switch kind {
    case "iris-open": let radius = hypot(rect.width, rect.height) / 2 * p; context.addEllipse(in: CGRect(x: rect.midX - radius, y: rect.midY - radius, width: radius * 2, height: radius * 2))
    case "iris-close": let radius = hypot(rect.width, rect.height) / 2 * (1 - p); context.addRect(rect); context.addEllipse(in: CGRect(x: rect.midX - radius, y: rect.midY - radius, width: radius * 2, height: radius * 2)); context.clip(using: .evenOdd); return
    case "barn": context.addRect(CGRect(x: rect.midX - rect.width * p / 2, y: rect.minY, width: rect.width * p, height: rect.height))
    case "blinds": for row in 0..<8 { context.addRect(CGRect(x: rect.minX, y: rect.minY + rect.height * CGFloat(row) / 8, width: rect.width, height: rect.height * p / 8)) }
    case "clock": context.move(to: CGPoint(x: rect.midX, y: rect.midY)); context.addLine(to: CGPoint(x: rect.midX, y: rect.minY)); context.addArc(center: CGPoint(x: rect.midX, y: rect.midY), radius: hypot(rect.width, rect.height) / 2, startAngle: -.pi / 2, endAngle: -.pi / 2 + .pi * 2 * p, clockwise: false); context.closePath()
    case "pixels": for row in 0..<9 { for column in 0..<16 where deterministicHash(column, row) < Double(p) { context.addRect(CGRect(x: rect.minX + rect.width * CGFloat(column) / 16, y: rect.minY + rect.height * CGFloat(row) / 9, width: rect.width / 16, height: rect.height / 9)) } }
    default: context.addRect(rect)
    }
    context.clip()
  }

  private static func deterministicHash(_ x: Int, _ y: Int) -> Double {
    var h = UInt32(truncatingIfNeeded: (x + 1) &* 374_761_393 &+ (y + 1) &* 668_265_263 &+ 2_147_483_629)
    h = (h ^ (h >> 13)) &* 1_274_126_177; h ^= h >> 16
    return Double(h) / 4_294_967_296
  }

  private static func drawLightLeak(_ amount: CGFloat, context: CGContext, width: Int, height: Int) {
    let colors = [UIColor(red: 1, green: 0.82, blue: 0.48, alpha: 1).cgColor,
      UIColor(red: 1, green: 0.47, blue: 0.16, alpha: 0.6).cgColor,
      UIColor(red: 1, green: 0.24, blue: 0, alpha: 0).cgColor] as CFArray
    guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 0.5, 1]) else { return }
    context.saveGState(); context.setBlendMode(.screen); context.setAlpha(min(1, amount * 0.85))
    context.drawRadialGradient(gradient, startCenter: CGPoint(x: CGFloat(width) * 0.75, y: CGFloat(height) * 0.25), startRadius: 0,
      endCenter: CGPoint(x: CGFloat(width) * 0.75, y: CGFloat(height) * 0.25), endRadius: CGFloat(max(width, height)), options: [])
    context.restoreGState()
  }

  private static func drawEffectOverlay(_ effect: [String: Any], offset: Double, rect: CGRect, source: CGImage, context: CGContext) {
    guard let type = effect["type"] as? String, let intensity = number(effect["intensity"]), intensity > 0 else { return }
    context.saveGState(); defer { context.restoreGState() }; context.clip(to: rect, mask: source)
    switch type {
    case "negative": context.setBlendMode(.difference); context.setAlpha(CGFloat(intensity)); context.setFillColor(UIColor.white.cgColor); context.fill(rect)
    case "scanlines": context.setFillColor(UIColor(white: 0, alpha: CGFloat(0.08 + 0.22 * intensity)).cgColor); let step = max(3, Int((8 - intensity * 5).rounded())); for y in stride(from: Int(offset) % step, to: Int(rect.height), by: step) { context.fill(CGRect(x: rect.minX, y: rect.minY + CGFloat(y), width: rect.width, height: 1)) }
    case "old-film":
      context.setFillColor(UIColor(white: 0, alpha: CGFloat(0.08 + 0.22 * intensity)).cgColor)
      let step = max(3, Int((8 - intensity * 5).rounded()))
      for y in stride(from: Int(offset) % step, to: Int(rect.height), by: step) {
        context.fill(CGRect(x: rect.minX, y: rect.minY + CGFloat(y), width: rect.width, height: 1))
      }
      context.setFillColor(UIColor(red: 1, green: 246 / 255, blue: 214 / 255, alpha: CGFloat(0.12 * intensity)).cgColor); context.fill(rect)
      context.setFillColor(UIColor(white: 1, alpha: CGFloat(0.35 * intensity)).cgColor)
      for n in 0..<5 { let x = Double((n * 211)) + offset * 17
        let position = x.truncatingRemainder(dividingBy: 997) / 997
        context.fill(CGRect(x: rect.minX + CGFloat(position) * rect.width, y: rect.minY,
          width: max(1, CGFloat(intensity * 2)), height: rect.height))
      }
    case "grain": context.setFillColor(UIColor(white: 1, alpha: CGFloat(intensity * 0.5)).cgColor); for n in 0..<150 { let seed = (n * 137 + Int(offset) * 23) % 997; context.fill(CGRect(x: rect.minX + CGFloat(seed) / 997 * rect.width, y: rect.minY + CGFloat((seed * 53) % 991) / 991 * rect.height, width: 2, height: 2)) }
    case "strobe": if sin(offset * 0.7) > 0 { context.setBlendMode(.screen); context.setFillColor(UIColor(white: 1, alpha: CGFloat(intensity * 0.8)).cgColor); context.fill(rect) }
    case "vignette": let colors = [UIColor.clear.cgColor, UIColor(white: 0, alpha: CGFloat(intensity)).cgColor] as CFArray; if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) { context.drawRadialGradient(gradient, startCenter: CGPoint(x: rect.midX, y: rect.midY), startRadius: min(rect.width, rect.height) * 0.2, endCenter: CGPoint(x: rect.midX, y: rect.midY), endRadius: max(rect.width, rect.height) * 0.6, options: []) }
    case "duotone": context.setBlendMode(.multiply); context.setFillColor(UIColor(red: 0.26, green: 0.12, blue: 0.47, alpha: CGFloat(intensity)).cgColor); context.fill(rect); context.setBlendMode(.screen); context.setFillColor(UIColor(red: 0.2, green: 0.84, blue: 0.77, alpha: CGFloat(intensity * 0.7)).cgColor); context.fill(rect)
    case "light-leak":
      let x = rect.minX + CGFloat((offset * 7).truncatingRemainder(dividingBy: Double(rect.width * 2))) - rect.width / 2
      let colors = [UIColor(red: 1, green: 0.96, blue: 0.71, alpha: CGFloat(0.75 * intensity)).cgColor,
        UIColor(red: 1, green: 0.36, blue: 0.25, alpha: CGFloat(0.35 * intensity)).cgColor,
        UIColor(red: 1, green: 0.16, blue: 0.08, alpha: 0).cgColor] as CFArray
      if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.45, 1]) {
        context.setBlendMode(.screen); context.drawRadialGradient(gradient, startCenter: CGPoint(x: x, y: rect.midY), startRadius: 0,
          endCenter: CGPoint(x: x, y: rect.midY), endRadius: max(rect.width, rect.height) * 0.7, options: [])
      }
    default: break
    }
  }

  private static func sourceImage(_ url: URL, at seconds: Double) throws -> CGImage {
    let ext = url.pathExtension.lowercased()
    if ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].contains(ext),
       let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) { return image }
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url)); generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 600); generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 600)
    do { return try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600_000), actualTime: nil) }
    catch { throw EditorMediaFailure.result(.corruptMedia, "compositor-decode-failed") }
  }

  private static func graphicImage(_ graphic: [String: Any]) throws -> CGImage {
    guard let shape = graphic["shape"] as? String, let rawColor = graphic["color"] as? String else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-graphic")
    }
    var bytes = Data(count: 512 * 512 * 4)
    let result = bytes.withUnsafeMutableBytes { raw -> CGImage? in
      guard let base = raw.baseAddress, let context = CGContext(data: base, width: 512, height: 512, bitsPerComponent: 8,
        bytesPerRow: 2048, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
      context.setFillColor(color(rawColor).cgColor); context.setStrokeColor(color(rawColor).cgColor)
      context.setLineWidth(40); context.setLineCap(.round); context.setLineJoin(.round); context.beginPath()
      switch shape {
      case "circle": context.addEllipse(in: CGRect(x: 36, y: 36, width: 440, height: 440))
      case "rectangle": context.addPath(CGPath(roundedRect: CGRect(x: 32, y: 96, width: 448, height: 320), cornerWidth: 24, cornerHeight: 24, transform: nil))
      case "triangle": addPoints([(256,32),(480,480),(32,480)], context)
      case "arrow": addPoints([(32,192),(304,192),(304,64),(480,256),(304,448),(304,320),(32,320)], context)
      case "heart": context.move(to: CGPoint(x: 256, y: 448)); context.addCurve(to: CGPoint(x: 32, y: 156), control1: CGPoint(x: 200, y: 400), control2: CGPoint(x: 32, y: 270)); context.addCurve(to: CGPoint(x: 256, y: 132), control1: CGPoint(x: 32, y: 36), control2: CGPoint(x: 192, y: 12)); context.addCurve(to: CGPoint(x: 480, y: 156), control1: CGPoint(x: 320, y: 12), control2: CGPoint(x: 480, y: 36)); context.addCurve(to: CGPoint(x: 256, y: 448), control1: CGPoint(x: 480, y: 270), control2: CGPoint(x: 312, y: 400))
      case "speech-bubble": context.addPath(CGPath(roundedRect: CGRect(x: 32, y: 56, width: 448, height: 336), cornerWidth: 48, cornerHeight: 48, transform: nil)); addPoints([(112,376),(88,476),(224,376)], context)
      case "checkmark": addPoints([(40,248),(112,176),(216,280),(400,96),(472,168),(216,424)], context)
      case "diamond", "hexagon": polygon(shape == "diamond" ? 4 : 6, inner: nil, context)
      case "star": polygon(10, inner: 100, context)
      case "line": context.addPath(CGPath(roundedRect: CGRect(x: 48, y: 236, width: 416, height: 40), cornerWidth: 20, cornerHeight: 20, transform: nil))
      case "underline": context.addPath(CGPath(roundedRect: CGRect(x: 80, y: 360, width: 352, height: 24), cornerWidth: 20, cornerHeight: 20, transform: nil))
      case "ring": context.addEllipse(in: CGRect(x: 66, y: 66, width: 380, height: 380)); context.strokePath(); return context.makeImage()
      case "cross": addPoints([(216,48),(296,48),(296,216),(464,216),(464,296),(296,296),(296,464),(216,464),(216,296),(48,296),(48,216),(216,216)], context)
      case "lightning": addPoints([(292,24),(100,292),(228,292),(184,488),(412,212),(276,212)], context)
      case "burst": polygon(24, inner: 125, context)
      case "sparkle": polygon(8, inner: 65, context)
      case "bracket": addPoints([(192,48),(96,48),(96,464),(192,464)], context); addPoints([(320,48),(416,48),(416,464),(320,464)], context); context.strokePath(); return context.makeImage()
      case "play": addPoints([(128,64),(448,256),(128,448)], context)
      case "location": context.move(to: CGPoint(x: 256, y: 480)); context.addCurve(to: CGPoint(x: 96, y: 192), control1: CGPoint(x: 220, y: 416), control2: CGPoint(x: 96, y: 304)); context.addCurve(to: CGPoint(x: 256, y: 32), control1: CGPoint(x: 96, y: 80), control2: CGPoint(x: 168, y: 32)); context.addCurve(to: CGPoint(x: 416, y: 192), control1: CGPoint(x: 344, y: 32), control2: CGPoint(x: 416, y: 80)); context.addCurve(to: CGPoint(x: 256, y: 480), control1: CGPoint(x: 416, y: 304), control2: CGPoint(x: 292, y: 416)); context.move(to: CGPoint(x: 256, y: 248)); context.addEllipse(in: CGRect(x: 192, y: 120, width: 128, height: 128))
      default: return nil
      }
      context.closePath(); context.fillPath(); return context.makeImage()
    }
    guard let result else { throw EditorMediaFailure.result(.invalidInput, "invalid-graphic") }
    return result
  }

  private static func addPoints(_ points: [(CGFloat, CGFloat)], _ context: CGContext) {
    for (index, point) in points.enumerated() {
      if index == 0 { context.move(to: CGPoint(x: point.0, y: point.1)) }
      else { context.addLine(to: CGPoint(x: point.0, y: point.1)) }
    }
  }

  private static func polygon(_ count: Int, inner: CGFloat?, _ context: CGContext) {
    for index in 0..<count {
      let angle = CGFloat(index) * .pi * 2 / CGFloat(count) - .pi / 2
      let radius: CGFloat = index % 2 == 0 ? 220 : inner ?? 220
      let point = CGPoint(x: 256 + cos(angle) * radius, y: 256 + sin(angle) * radius)
      if index == 0 { context.move(to: point) } else { context.addLine(to: point) }
    }
  }

  private static func resized(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    var bytes = Data(count: width * height * 4)
    return bytes.withUnsafeMutableBytes { raw -> CGImage? in
      guard let base = raw.baseAddress, let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
      context.interpolationQuality = .high
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return context.makeImage()
    }
  }

  /** Core Graphics clip masks are one-channel grayscale images: 0 hides, 255 reveals. */
  private static func grayMask(_ image: CGImage) -> CGImage? {
    let width = image.width, height = image.height
    let alphaInfo = image.alphaInfo
    let hasAlpha = alphaInfo == .alphaOnly || alphaInfo == .first || alphaInfo == .last
      || alphaInfo == .premultipliedFirst || alphaInfo == .premultipliedLast
    var source = Data(count: width * height * 4), output = Data(count: width * height)
    guard source.withUnsafeMutableBytes({ raw -> Bool in
      guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height)); return true
    }) else { return nil }
    output.withUnsafeMutableBytes { targetRaw in source.withUnsafeBytes { sourceRaw in
      let target = targetRaw.bindMemory(to: UInt8.self), pixels = sourceRaw.bindMemory(to: UInt8.self)
      for index in 0..<target.count {
        let sourceIndex = index * 4
        target[index] = EditorSemanticMaskContract.confidence(red: pixels[sourceIndex], green: pixels[sourceIndex + 1],
          blue: pixels[sourceIndex + 2], alpha: pixels[sourceIndex + 3], hasAlpha: hasAlpha)
      }
    } }
    guard let provider = CGDataProvider(data: output as CFData) else { return nil }
    return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
      provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }

  private static func filtered(_ image: CGImage, visual: [String: Any]) -> CGImage? {
    let processed = pixelAdjusted(image, visual: visual) ?? image
    let special = compositedEffect(processed, visual: visual) ?? processed
    var value = CIImage(cgImage: special)
    if let raw = visual["filter"] as? [String: Any] {
      let brightness = number(raw["brightness"]) ?? 1
      if brightness != 1 {
        let matrix = CIFilter(name: "CIColorMatrix")!; matrix.setValue(value, forKey: kCIInputImageKey)
        matrix.setValue(CIVector(x: brightness, y: 0, z: 0, w: 0), forKey: "inputRVector")
        matrix.setValue(CIVector(x: 0, y: brightness, z: 0, w: 0), forKey: "inputGVector")
        matrix.setValue(CIVector(x: 0, y: 0, z: brightness, w: 0), forKey: "inputBVector")
        value = matrix.outputImage ?? value
      }
      let control = CIFilter(name: "CIColorControls")!; control.setValue(value, forKey: kCIInputImageKey)
      control.setValue(0, forKey: kCIInputBrightnessKey)
      control.setValue(number(raw["contrast"]) ?? 1, forKey: kCIInputContrastKey)
      control.setValue(number(raw["saturate"]) ?? 1, forKey: kCIInputSaturationKey)
      value = control.outputImage ?? value
      let hue = number(raw["hue"]) ?? 0
      if hue != 0 { let filter = CIFilter(name: "CIHueAdjust")!; filter.setValue(value, forKey: kCIInputImageKey); filter.setValue(hue * .pi / 180, forKey: kCIInputAngleKey); value = filter.outputImage ?? value }
      let transitionBlur = (visual["transition"] as? [String: Any]).flatMap { number($0["blur"]) } ?? 0
      let blur = (number(raw["blur"]) ?? 0) + transitionBlur
      if blur > 0 { let filter = CIFilter(name: "CIGaussianBlur")!; filter.setValue(value, forKey: kCIInputImageKey); filter.setValue(min(30, blur), forKey: kCIInputRadiusKey); value = (filter.outputImage ?? value).cropped(to: CIImage(cgImage: image).extent) }
    }
    if let effect = (visual["clip"] as? [String: Any])?["effect"] as? [String: Any],
       let type = effect["type"] as? String, let intensity = number(effect["intensity"]), intensity > 0 {
      let filter: CIFilter?
      switch type {
      case "mono": filter = CIFilter(name: "CIColorMonochrome", parameters: [kCIInputColorKey: CIColor(red: 0.5, green: 0.5, blue: 0.5), kCIInputIntensityKey: intensity])
      case "sepia", "old-film": filter = CIFilter(name: "CISepiaTone", parameters: [kCIInputIntensityKey: type == "old-film" ? 0.25 + 0.65 * intensity : intensity])
      case "posterize": filter = CIFilter(name: "CIColorPosterize", parameters: ["inputLevels": max(2, (8 - intensity * 5).rounded())])
      case "pixelate": filter = CIFilter(name: "CIPixellate", parameters: [kCIInputScaleKey: max(1, intensity * 30)])
      case "pulse": let gain = 1 + (0.5 + 0.5 * sin((number(visual["offset"]) ?? 0) * 0.18)) * intensity * 0.75; filter = CIFilter(name: "CIColorMatrix", parameters: ["inputRVector": CIVector(x: gain, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: gain, z: 0, w: 0), "inputBVector": CIVector(x: 0, y: 0, z: gain, w: 0)])
      default: filter = nil
      }
      if let filter { filter.setValue(value, forKey: kCIInputImageKey); value = filter.outputImage ?? value }
      if type == "old-film" { let controls = CIFilter(name: "CIColorControls")!; controls.setValue(value, forKey: kCIInputImageKey); controls.setValue(1 + 0.18 * intensity, forKey: kCIInputContrastKey); controls.setValue(-0.05 + sin((number(visual["offset"]) ?? 0) * 0.7) * 0.04 * intensity, forKey: kCIInputBrightnessKey); value = controls.outputImage ?? value }
    }
    return ci.createCGImage(value, from: value.extent)
  }

  private static func compositedEffect(_ image: CGImage, visual: [String: Any]) -> CGImage? {
    guard let effect = (visual["clip"] as? [String: Any])?["effect"] as? [String: Any], let type = effect["type"] as? String,
          let intensity = number(effect["intensity"]), intensity > 0, ["mirror", "tiles", "soft-glow", "chromatic"].contains(type) else { return image }
    let width = image.width, height = image.height, extent = CGRect(x: 0, y: 0, width: width, height: height)
    if type == "soft-glow" || type == "chromatic" {
      let base = CIImage(cgImage: image), overlay: CIImage
      if type == "soft-glow" {
        let blur = CIFilter(name: "CIGaussianBlur")!; blur.setValue(base, forKey: kCIInputImageKey); blur.setValue(2 + intensity * 10, forKey: kCIInputRadiusKey)
        let bright = CIFilter(name: "CIColorControls")!; bright.setValue(blur.outputImage ?? base, forKey: kCIInputImageKey); bright.setValue(intensity * 0.4, forKey: kCIInputBrightnessKey); overlay = (bright.outputImage ?? base).cropped(to: base.extent)
      } else {
        let shift = max(1, CGFloat(width) * CGFloat(intensity) * 0.025), left = base.transformed(by: CGAffineTransform(translationX: -shift, y: 0)), right = base.transformed(by: CGAffineTransform(translationX: shift, y: 0))
        let screen = CIFilter(name: "CIScreenBlendMode")!; screen.setValue(left, forKey: kCIInputImageKey); screen.setValue(right, forKey: kCIInputBackgroundImageKey); overlay = (screen.outputImage ?? base).cropped(to: base.extent)
      }
      let alpha = CIFilter(name: "CIColorMatrix")!; alpha.setValue(overlay, forKey: kCIInputImageKey); alpha.setValue(CIVector(x: 0, y: 0, z: 0, w: type == "soft-glow" ? 0.45 + intensity * 0.3 : 0.38 * intensity), forKey: "inputAVector")
      let screen = CIFilter(name: "CIScreenBlendMode")!; screen.setValue(alpha.outputImage ?? overlay, forKey: kCIInputImageKey); screen.setValue(base, forKey: kCIInputBackgroundImageKey)
      return ci.createCGImage((screen.outputImage ?? base).cropped(to: base.extent), from: base.extent)
    }
    var bytes = Data(count: width * height * 4)
    return bytes.withUnsafeMutableBytes { raw -> CGImage? in
      guard let base = raw.baseAddress, let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
      if type == "mirror" {
        context.saveGState(); context.clip(to: CGRect(x: 0, y: 0, width: CGFloat(width)/2, height: CGFloat(height))); context.draw(image, in: extent); context.restoreGState()
        context.saveGState(); context.clip(to: CGRect(x: CGFloat(width)/2, y: 0, width: CGFloat(width)/2, height: CGFloat(height))); context.translateBy(x: CGFloat(width), y: 0); context.scaleBy(x: -1, y: 1); context.draw(image, in: extent); context.restoreGState()
      } else {
        let count = intensity > 0.65 ? 4 : intensity > 0.3 ? 3 : 2, tileW = CGFloat(width) / CGFloat(count), tileH = CGFloat(height) / CGFloat(count)
        let drift = sin((number(visual["offset"]) ?? 0) * 0.12) * Double(tileW) * 0.15 * intensity
        for y in 0..<count { for x in 0..<count { let tile = CGRect(x: CGFloat(x)*tileW, y: CGFloat(y)*tileH, width: tileW, height: tileH)
          context.saveGState(); context.clip(to: tile); context.draw(image, in: tile.offsetBy(dx: CGFloat(drift) * (y % 2 == 0 ? -1 : 1), dy: 0)); context.restoreGState() } }
      }
      return context.makeImage()
    }
  }

  private static func pixelAdjusted(_ image: CGImage, visual: [String: Any]) -> CGImage? {
    let smart = (visual["clip"] as? [String: Any])?["smartPicture"] as? [String: Any]
    let colour = visual["colour"] as? [String: Any]
    let denoise = number(smart?["denoise"]) ?? 0, keyEnabled = smart?["keyEnabled"] as? Bool == true
    let light = number(smart?["light"]) ?? 0
    guard denoise != 0 || keyEnabled || light != 0 || colour != nil else { return image }
    let width = image.width, height = image.height
    var bytes = Data(count: width * height * 4)
    guard bytes.withUnsafeMutableBytes({ raw in
      guard let base = raw.baseAddress, let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height)); return true
    }) else { return nil }
    bytes.withUnsafeMutableBytes { raw in
      let data = raw.bindMemory(to: UInt8.self)
      for index in stride(from: 0, to: data.count, by: 4) where data[index + 3] > 0 && data[index + 3] < 255 {
        let alpha = Double(data[index + 3]) / 255
        for channel in 0..<3 { data[index + channel] = UInt8(max(0, min(255, (Double(data[index + channel]) / alpha).rounded()))) }
      }
      denoisePixels(data, width: width, height: height, amount: denoise)
    }
    let key = colorBytes(smart?["keyColor"] as? String ?? "#00ff00"), dominant = key.enumerated().max(by: { $0.element < $1.element })?.offset ?? 1
    let others = [0, 1, 2].filter { $0 != dominant }, keyChroma = chroma(Double(key[0]), Double(key[1]), Double(key[2]))
    let tolerance = number(smart?["keyTolerance"]) ?? 0.12, keyFeather = number(smart?["keyFeather"]) ?? 0.1
    let despill = number(smart?["despill"]) ?? 0.5, lightX = number(smart?["lightX"]) ?? 0.5
    let lightY = number(smart?["lightY"]) ?? 0.5, lightRadius = number(smart?["lightRadius"]) ?? 0.6
    let exposure = number(colour?["exposure"]) ?? 0, temperature = number(colour?["temperature"]) ?? 0
    let tint = number(colour?["tint"]) ?? 0, shadows = number(colour?["shadows"]) ?? 0
    let highlights = number(colour?["highlights"]) ?? 0, gamma = 1 / (number(colour?["gamma"]) ?? 1)
    let balance = [1 + temperature * 0.2 + tint * 0.05, 1 - tint * 0.15, 1 - temperature * 0.2 + tint * 0.05]
    let hsl = colour?["hsl"] as? [String: [String: Any]] ?? [:], curves = colour?["curves"] as? [String: [[String: Any]]] ?? [:]
    let channels = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"], centres = [0.0, 30, 60, 120, 180, 240, 270, 300]
    let tables = ["red", "green", "blue"].map { channel in (0..<256).map { value -> UInt8 in
      let master = curve(curves["master"], Double(value) / 255), result = curve(curves[channel], master)
      return UInt8(max(0, min(255, Int((result * 255).rounded()))))
    } }
    bytes.withUnsafeMutableBytes { raw in
      let data = raw.bindMemory(to: UInt8.self)
      for y in 0..<height { for x in 0..<width { let index = (y * width + x) * 4
        if keyEnabled { let uv = chroma(Double(data[index]), Double(data[index + 1]), Double(data[index + 2]))
          let distance = hypot(uv.0 - keyChroma.0, uv.1 - keyChroma.1) / 180, alpha = max(0, min(1, (distance - tolerance) / keyFeather)), p = alpha * alpha * (3 - 2 * alpha)
          data[index + 3] = UInt8((Double(data[index + 3]) * p).rounded())
          if p < 1 { let neutral = max(data[index + others[0]], data[index + others[1]])
            let spill = max(0, Double(data[index + dominant]) - Double(neutral)) * (1 - p) * despill
            data[index + dominant] = UInt8(max(0, Double(data[index + dominant]) - spill).rounded()) }
        }
        if light != 0 { let distance = hypot(Double(x) / Double(width) - lightX, Double(y) / Double(height) - lightY)
          let gain = pow(2, light * exp(-distance * distance / (2 * lightRadius * lightRadius)))
          for channel in 0..<3 { data[index + channel] = UInt8(max(0, min(255, (Double(data[index + channel]) * gain).rounded()))) }
        }
        guard colour != nil else { continue }
        var rgb = (0..<3).map { max(0, min(1, Double(data[index + $0]) * pow(2, exposure) / 255 * balance[$0])) }
        let luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
        let shift = shadows * pow(1 - luma, 2) * 0.35 + highlights * luma * luma * 0.35
        rgb = rgb.map { pow(max(0, min(1, $0 + shift)), gamma) }
        var hsla = rgbHsl(rgb[0], rgb[1], rgb[2]), dh = 0.0, ds = 0.0, dl = 0.0, weights = 0.0
        for k in channels.indices { let delta = (hsla.0 - centres[k] + 540).truncatingRemainder(dividingBy: 360) - 180
          let previous = centres[(k + centres.count - 1) % centres.count], next = centres[(k + 1) % centres.count]
          let span = delta < 0 ? (centres[k] - previous + 360).truncatingRemainder(dividingBy: 360) : (next - centres[k] + 360).truncatingRemainder(dividingBy: 360)
          let weight = max(0, 1 - abs(delta) / span), setting = hsl[channels[k]] ?? [:]; if weight == 0 { continue }
          weights += weight; dh += (number(setting["hue"]) ?? 0) * weight; ds += (number(setting["saturation"]) ?? 0) * weight; dl += (number(setting["luminance"]) ?? 0) * weight
        }
        if weights > 0 { hsla.0 = (hsla.0 + dh / weights * hsla.1 + 360).truncatingRemainder(dividingBy: 360); hsla.1 = max(0, min(1, hsla.1 * (1 + ds / weights))); hsla.2 = max(0, min(1, hsla.2 + dl / weights * hsla.1 * 0.5)); rgb = hslRgb(hsla.0, hsla.1, hsla.2) }
        for channel in 0..<3 { data[index + channel] = tables[channel][max(0, min(255, Int((rgb[channel] * 255).rounded())))] }
      } }
      for index in stride(from: 0, to: data.count, by: 4) where data[index + 3] < 255 {
        let alpha = Double(data[index + 3]) / 255
        for channel in 0..<3 { data[index + channel] = UInt8((Double(data[index + channel]) * alpha).rounded()) }
      }
    }
    guard let provider = CGDataProvider(data: bytes as CFData) else { return nil }
    return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
      provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }

  /** Two-pass three-tap bilateral filter matching editorSmartPicture.mjs. */
  private static func denoisePixels(_ data: UnsafeMutableBufferPointer<UInt8>, width: Int, height: Int, amount: Double) {
    guard amount > 0 else { return }
    let original = Array(data), sigma = 10 + amount * 35
    let table = (0..<256).map { exp(-Double($0 * $0) / (2 * sigma * sigma)) }
    var scratch = original, output = original
    for vertical in [false, true] {
      let input = vertical ? scratch : original
      for y in 0..<height { for x in 0..<width { let index = (y * width + x) * 4
        for channel in 0..<3 { var sum = Double(input[index + channel]), weight = 1.0
          for shift in [-1, 1] {
            let xx = vertical ? x : max(0, min(width - 1, x + shift)), yy = vertical ? max(0, min(height - 1, y + shift)) : y
            let neighbour = (yy * width + xx) * 4
            if input[neighbour + 3] == 0 { continue }
            let w = 0.8 * table[abs(Int(input[index + channel]) - Int(input[neighbour + channel]))]
            sum += Double(input[neighbour + channel]) * w; weight += w
          }
          let value = UInt8(max(0, min(255, Int((sum / weight).rounded()))))
          if vertical { output[index + channel] = value } else { scratch[index + channel] = value }
        }
        if vertical { output[index + 3] = input[index + 3] } else { scratch[index + 3] = input[index + 3] }
      } }
    }
    for index in stride(from: 0, to: data.count, by: 4) { for channel in 0..<3 {
      data[index + channel] = UInt8((Double(original[index + channel]) * (1 - amount) + Double(output[index + channel]) * amount).rounded())
    }; data[index + 3] = original[index + 3] }
  }

  private static func colorBytes(_ value: String) -> [UInt8] { let raw = value.hasPrefix("#") ? String(value.dropFirst()) : value
    guard raw.count == 6, let rgb = Int(raw, radix: 16) else { return [0, 255, 0] }; return [UInt8((rgb >> 16) & 255), UInt8((rgb >> 8) & 255), UInt8(rgb & 255)] }
  private static func chroma(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double) { (-0.168736*r-0.331264*g+0.5*b, 0.5*r-0.418688*g-0.081312*b) }
  private static func curve(_ points: [[String: Any]]?, _ value: Double) -> Double { guard let points, points.count >= 2 else { return value }; let v = max(0, min(1, value))
    guard let right = points.firstIndex(where: { (number($0["x"]) ?? 0) >= v }), right > 0 else { return number(points[0]["y"]) ?? v }
    let a = points[right-1], b = points[right], ax = number(a["x"]) ?? 0, bx = number(b["x"]) ?? 1
    return (number(a["y"]) ?? 0) + ((number(b["y"]) ?? 1) - (number(a["y"]) ?? 0)) * (v - ax) / max(0.000001, bx - ax) }
  private static func rgbHsl(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) { let high = max(r,max(g,b)), low = min(r,min(g,b)), delta = high-low, light = (high+low)/2
    if delta == 0 { return (0,0,light) }; let hue = high == r ? ((g-b)/delta+(g<b ? 6:0))*60 : high == g ? ((b-r)/delta+2)*60 : ((r-g)/delta+4)*60
    return (hue, delta/(1-abs(2*light-1)), light) }
  private static func hslRgb(_ h: Double, _ s: Double, _ l: Double) -> [Double] { let c=(1-abs(2*l-1))*s, x=c*(1-abs((h/60).truncatingRemainder(dividingBy:2)-1)), m=l-c/2
    let values = h<60 ? [c,x,0] : h<120 ? [x,c,0] : h<180 ? [0,c,x] : h<240 ? [0,x,c] : h<300 ? [x,0,c] : [c,0,x]; return values.map{$0+m} }

  private static func clip(mask: [String: Any], size: CGSize, context: CGContext) throws {
    guard let x = number(mask["x"]), let y = number(mask["y"]), let w = number(mask["width"]),
          let h = number(mask["height"]), let rotation = number(mask["rotation"]), let feather = number(mask["feather"]),
          let shape = mask["shape"] as? String else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-mask")
    }
    let inverted = mask["inverted"] as? Bool == true
    let full = CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height)
    if feather > 0 {
      let pixelWidth = max(1, Int(size.width.rounded())), pixelHeight = max(1, Int(size.height.rounded()))
      var data = Data(count: pixelWidth * pixelHeight)
      let maskImage = data.withUnsafeMutableBytes { raw -> CGImage? in
        guard let base = raw.baseAddress, let alpha = CGContext(data: base, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8,
          bytesPerRow: pixelWidth, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        alpha.setFillColor(gray: 1, alpha: 1); alpha.translateBy(x: CGFloat(x) * CGFloat(pixelWidth), y: CGFloat(y) * CGFloat(pixelHeight))
        alpha.rotate(by: CGFloat(rotation * .pi / 180))
        let rect = CGRect(x: -CGFloat(w) * CGFloat(pixelWidth) / 2, y: -CGFloat(h) * CGFloat(pixelHeight) / 2,
          width: CGFloat(w) * CGFloat(pixelWidth), height: CGFloat(h) * CGFloat(pixelHeight))
        if shape == "circle" { alpha.fillEllipse(in: rect) }
        else if shape == "rounded" { alpha.addPath(CGPath(roundedRect: rect, cornerWidth: min(rect.width, rect.height) * 0.15,
          cornerHeight: min(rect.width, rect.height) * 0.15, transform: nil)); alpha.fillPath() }
        else { alpha.fill(rect) }
        guard let hard = alpha.makeImage() else { return nil }
        var value = CIImage(cgImage: hard)
        let blur = CIFilter(name: "CIGaussianBlur")!; blur.setValue(value, forKey: kCIInputImageKey)
        blur.setValue(feather * Double(min(pixelWidth, pixelHeight)), forKey: kCIInputRadiusKey); value = (blur.outputImage ?? value).cropped(to: value.extent)
        if inverted { let invert = CIFilter(name: "CIColorInvert")!; invert.setValue(value, forKey: kCIInputImageKey); value = invert.outputImage ?? value }
        return ci.createCGImage(value, from: CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
      }
      guard let maskImage else { throw EditorMediaFailure.result(.invalidInput, "invalid-mask") }
      context.clip(to: full, mask: maskImage); return
    }
    var transform = CGAffineTransform(translationX: full.minX + CGFloat(x) * size.width, y: full.minY + CGFloat(y) * size.height)
      .rotated(by: CGFloat(rotation * .pi / 180))
    let rect = CGRect(x: -CGFloat(w) * size.width / 2, y: -CGFloat(h) * size.height / 2,
      width: CGFloat(w) * size.width, height: CGFloat(h) * size.height)
    let path = CGMutablePath()
    if inverted { path.addRect(CGRect(x: -size.width * 2, y: -size.height * 2, width: size.width * 4, height: size.height * 4)) }
    if shape == "circle" { path.addEllipse(in: rect, transform: transform) }
    else if shape == "rounded" { path.addPath(CGPath(roundedRect: rect, cornerWidth: min(rect.width, rect.height) * 0.15,
      cornerHeight: min(rect.width, rect.height) * 0.15, transform: &transform)) }
    else { path.addRect(rect, transform: transform) }
    context.addPath(path); context.clip(using: inverted ? .evenOdd : .winding)
  }

  private static func drawText(_ layer: [String: Any], sources: [String: String], identity: EditorMediaIdentity,
                               in context: CGContext, width: Int, height: Int) throws {
    guard let item = layer["item"] as? [String: Any], let presentation = layer["presentation"] as? [String: Any],
          let text = presentation["text"] as? String, !text.isEmpty, text.utf8.count <= 4_000,
          let transform = layer["transform"] as? [String: Any], let x = number(transform["x"]),
          let y = number(transform["y"]), let scale = number(transform["scale"]),
          let rotation = number(transform["rotation"]), let opacity = number(transform["opacity"]) else { return }
    let style = item["style"] as? [String: Any] ?? [:], size = max(8, CGFloat(height) * CGFloat(number(item["size"]) ?? 6) / 100)
    let family = style["font"] as? String ?? "sans-serif", weight = style["weight"] as? String == "normal" ? UIFont.Weight.regular : .bold
    let base: UIFont
    if family == "sans-serif" { base = UIFont.systemFont(ofSize: size, weight: weight) }
    else if family == "serif" { base = UIFont(descriptor: UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body).withDesign(.serif)!, size: size) }
    else if family == "monospace" { base = UIFont.monospacedSystemFont(ofSize: size, weight: weight) }
    else if family.hasPrefix("VXFont_") {
      guard let metadata = layer["customFont"] as? [String: Any], metadata["family"] as? String == family,
            let sha = metadata["sha256"] as? String, sha.count == 64,
            family == "VXFont_\(sha)", let format = metadata["format"] as? String,
            ["ttf", "otf", "woff", "woff2"].contains(format), let expected = metadata["bytes"] as? Int,
            expected >= 12, expected <= 2 * 1024 * 1024, let uri = sources[family], let url = URL(string: uri), url.isFileURL,
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
        throw EditorMediaFailure.result(.invalidInput, "custom-font-unavailable")
      }
      let expectedFolder = documents.appendingPathComponent("veyrnox-editor-fonts", isDirectory: true)
        .appendingPathComponent(identity.account, isDirectory: true).appendingPathComponent(identity.project, isDirectory: true)
        .resolvingSymlinksInPath().standardizedFileURL
      let resolved = url.resolvingSymlinksInPath().standardizedFileURL
      guard resolved.deletingLastPathComponent() == expectedFolder,
            resolved.lastPathComponent == "\(sha).\(format)",
            (try? resolved.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]))?.isRegularFile == true,
            (try? resolved.resourceValues(forKeys: [.fileSizeKey]).fileSize) == expected else {
        throw EditorMediaFailure.result(.invalidInput, "custom-font-unavailable")
      }
      if let chosen = UIFont(name: family, size: size) { base = chosen }
      else {
        CTFontManagerRegisterFontsForURL(resolved as CFURL, .process, nil)
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(resolved as CFURL) as? [CTFontDescriptor],
              let descriptor = descriptors.first else { throw EditorMediaFailure.result(.unsupportedCodec, "custom-font-unavailable") }
        let registered = CTFontCreateWithFontDescriptor(descriptor, size, nil)
        guard let chosen = UIFont(name: CTFontCopyPostScriptName(registered) as String, size: size) else {
          throw EditorMediaFailure.result(.unsupportedCodec, "custom-font-unavailable")
        }
        base = chosen
      }
    }
    else if let chosen = UIFont(name: family, size: size) { base = chosen }
    else { throw EditorMediaFailure.result(.invalidInput, "custom-font-unavailable") }
    var traits = base.fontDescriptor.symbolicTraits
    if style["italic"] as? Bool == true { traits.insert(.traitItalic) }
    if style["weight"] as? String != "normal" { traits.insert(.traitBold) }
    let font = base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: size) } ?? base
    let foreground = color(style["color"] as? String ?? "#ffffff")
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = style["align"] as? String == "left" ? .left : style["align"] as? String == "right" ? .right : .center
    paragraph.lineHeightMultiple = CGFloat(number(style["lineHeight"]) ?? 1.2)
    let shadow = NSShadow(); shadow.shadowColor = color(style["shadowColor"] as? String ?? "#000000").withAlphaComponent(CGFloat(number(style["shadowOpacity"]) ?? 0)); shadow.shadowBlurRadius = CGFloat(number(style["shadowBlur"]) ?? 4) * CGFloat(height) / 720; shadow.shadowOffset = CGSize(width: CGFloat(number(style["shadowX"]) ?? 2) * CGFloat(height) / 720, height: CGFloat(number(style["shadowY"]) ?? 2) * CGFloat(height) / 720)
    let strokeWidth = number(style["strokeWidth"]) ?? 0
    let attributed = NSMutableAttributedString(string: text, attributes: [.font: font, .foregroundColor: foreground,
      .paragraphStyle: paragraph, .kern: CGFloat(number(style["letterSpacing"]) ?? 0) * CGFloat(height) / 720,
      .shadow: shadow, .strokeColor: color(style["stroke"] as? String ?? "#000000"), .strokeWidth: -CGFloat(strokeWidth),
      .underlineStyle: style["underline"] as? Bool == true ? NSUnderlineStyle.single.rawValue : 0])
    if let ranges = presentation["ranges"] as? [[String: Any]] {
      let highlight = color((item["wordStyle"] as? [String: Any])?["color"] as? String ?? "#00e5ff")
      for range in ranges { if let from = range["from"] as? Int, let to = range["to"] as? Int, from >= 0, to > from, to <= attributed.length { attributed.addAttribute(.foregroundColor, value: highlight, range: NSRange(location: from, length: to - from)) } }
    }
    context.saveGState(); defer { context.restoreGState() }
    let itemX = number(item["x"]) ?? 0.5, itemY = number(item["y"]) ?? 0.85
    context.translateBy(x: CGFloat(itemX + x - 0.5) * CGFloat(width), y: CGFloat(itemY + y - 0.5) * CGFloat(height)); context.rotate(by: CGFloat(rotation * .pi / 180)); context.scaleBy(x: CGFloat(scale), y: CGFloat(scale)); context.setAlpha(CGFloat(opacity))
    let lineHeight = size * CGFloat(number(style["lineHeight"]) ?? 1.2), maxWidth = CGFloat(width) * 0.92
    let rawLines = text.components(separatedBy: "\n")
    var offset = 0, lines: [(NSMutableAttributedString, CGFloat, CGFloat)] = []
    for rawLine in rawLines {
      let length = (rawLine as NSString).length
      let line = NSMutableAttributedString(attributedString: attributed.attributedSubstring(from: NSRange(location: offset, length: length)))
      let natural = max(1, ceil(line.boundingRect(with: CGSize(width: .greatestFiniteMagnitude, height: lineHeight * 2),
        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).width))
      lines.append((line, min(natural, maxWidth), min(1, maxWidth / natural))); offset += length + 1
    }
    let y0 = -CGFloat(max(0, lines.count - 1)) * lineHeight / 2
    let widest = lines.map(\.1).max() ?? 0
    let shadowPad = CGFloat(number(style["shadowOpacity"]) ?? 0) > 0
      ? CGFloat(number(style["shadowBlur"]) ?? 0) * CGFloat(height) / 240 : 0
    let revealBounds = CGRect(x: -widest / 2 - shadowPad, y: y0 - lineHeight / 2 - shadowPad,
      width: widest + shadowPad * 2, height: CGFloat(lines.count) * lineHeight + shadowPad * 2)
    if let reveal = layer["reveal"] as? [String: Any] { clipReveal(reveal, rect: revealBounds, context: context) }
    UIGraphicsPushContext(context); defer { UIGraphicsPopContext() }
    let alignment = style["align"] as? String ?? "center", backgroundOpacity = CGFloat(number(style["backgroundOpacity"]) ?? 0)
    for (index, entry) in lines.enumerated() {
      let (line, drawnWidth, squeeze) = entry, lineY = y0 + CGFloat(index) * lineHeight
      let left = alignment == "left" ? 0 : alignment == "right" ? -drawnWidth : -drawnWidth / 2
      if backgroundOpacity > 0 {
        context.setFillColor(color(style["background"] as? String ?? "#000000").withAlphaComponent(backgroundOpacity).cgColor)
        context.fill(CGRect(x: left - 8, y: lineY - lineHeight / 2, width: drawnWidth + 16, height: lineHeight))
      }
      context.saveGState(); context.translateBy(x: left, y: lineY - lineHeight / 2); context.scaleBy(x: squeeze, y: 1)
      line.draw(with: CGRect(x: 0, y: 0, width: drawnWidth / squeeze, height: lineHeight),
        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
      context.restoreGState()
    }
  }

  private static func number(_ value: Any?) -> Double? {
    if let value = value as? Double, value.isFinite { return value }
    if let value = value as? NSNumber, value.doubleValue.isFinite { return value.doubleValue }
    return nil
  }
  private static func color(_ value: String) -> UIColor {
    let raw = value.hasPrefix("#") ? String(value.dropFirst()) : value
    guard raw.count == 6, let rgb = Int(raw, radix: 16) else { return .black }
    return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
      blue: CGFloat(rgb & 255) / 255, alpha: 1)
  }
  private static func blend(_ value: String?) -> CGBlendMode {
    switch value { case "multiply": return .multiply; case "screen": return .screen; case "overlay": return .overlay
    case "darken": return .darken; case "lighten": return .lighten; case "difference": return .difference; default: return .normal }
  }
}

public final class VeyrnoxEditorCompositorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeyrnoxEditorCompositor")
    AsyncFunction("capabilities") { (promise: Promise) in
      promise.resolve(["ok": true, "platform": "ios", "minimumIos": "16.4", "protocolVersion": 2,
        "features": ["timeline-background", "image-source", "graphic-source", "video-source", "fit", "crop", "transform",
          "visual-layering", "blend", "mask", "transition", "clip-animation", "animation-reveal",
          "clip-background-solid", "clip-background-blur", "clip-background-image", "clip-background-gradient", "clip-background-video", "basic-filter", "smart-picture",
          "advanced-colour", "effect", "text-layer", "caption-words", "custom-font", "behind-subject",
          "semantic-mask", "semantic-mask-dynamic", "audio-mix"]])
    }
    AsyncFunction("renderFrame") { (account: String, project: String, owner: String, token: String,
                                     planJSON: String, sources: [String: String], width: Int, height: Int,
                                     index: Int, timestampUs: Int64, promise: Promise) in
      EditorCompositor.render(account, project, owner, token, planJSON, sources, width, height, index, timestampUs, promise: promise)
    }
    Function("discardFrames") { (account: String, project: String, owner: String, token: String, uris: [String]) in
      EditorCompositor.discard(account, project, owner, token, uris)
    }
  }
}

private struct MotionSample {
  var x: Double, y: Double, luminance: Double, correctionX: Double = 0, correctionY: Double = 0, gain: Double = 1
}

private final class EditorMotionJob {
  let identity: EditorMediaIdentity, request: MotionProcessRequest, promise: Promise
  let projectGeneration: Int
  var cancelled = false
  init(_ identity: EditorMediaIdentity, _ request: MotionProcessRequest, _ projectGeneration: Int, _ promise: Promise) {
    self.identity = identity; self.request = request; self.projectGeneration = projectGeneration; self.promise = promise
  }
}

final class EditorMotionWorker {
  static let shared = EditorMotionWorker()
  typealias Progress = (String, Double) -> Void
  private let queue = DispatchQueue(label: "ai.veyrnox.editor-motion")
  private let lock = NSLock()
  private var running: EditorMotionJob?
  private let ci = CIContext(options: [.cacheIntermediates: false])

  func process(_ identity: EditorMediaIdentity, request: MotionProcessRequest, promise: Promise,
               progress: @escaping Progress) {
    guard let generation = EditorMediaWorker.shared.currentProjectGeneration(identity) else {
      promise.resolve(EditorMediaFailure.result(.cancelled).dictionary); return
    }
    let job = EditorMotionJob(identity, request, generation, promise)
    lock.lock(); guard running == nil else { lock.unlock(); promise.resolve(["ok": false, "code": "busy"]); return }
    running = job; lock.unlock()
    queue.async {
      let result = mediaResult { try self.run(job, progress: progress) }
      self.lock.lock(); if job.cancelled { self.deleteOutput(result, identity: identity) }
      self.running = nil; let cancelled = job.cancelled; self.lock.unlock()
      promise.resolve(cancelled ? EditorMediaFailure.result(.cancelled).dictionary : result)
    }
  }
  func cancel(_ identity: EditorMediaIdentity) {
    lock.lock(); if running?.identity == identity { running?.cancelled = true }; lock.unlock()
  }
  func cancelProject(_ account: String, _ project: String) {
    lock.lock(); if running?.identity.account == account && running?.identity.project == project { running?.cancelled = true }; lock.unlock()
  }
  func cancelAll() { lock.lock(); running?.cancelled = true; lock.unlock() }
  private func stopped(_ job: EditorMotionJob) throws {
    lock.lock(); let value = job.cancelled; lock.unlock()
    if value || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) {
      throw EditorMediaFailure.result(.cancelled)
    }
  }
  private func deleteOutput(_ value: [String: Any], identity: EditorMediaIdentity) {
    if let id = value["artifactId"] as? String { try? EditorMediaPaths.shared.release(identity.account, project: identity.project, artifactId: id) }
  }

  private func run(_ job: EditorMotionJob, progress: @escaping Progress) throws -> [String: Any] {
    let request = job.request
    let tools = ["stabilize", "flicker", "optical-flow", "track-reframe", "camera-movement"]
    guard tools.contains(request.tool), [24, 25, 30, 50, 60].contains(request.frameRate),
          [360, 480, 720].contains(request.height), (1...30).contains(request.smoothing),
          request.strength.isFinite, (0...1).contains(request.strength),
          request.tool != "optical-flow" || request.height <= 480 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-motion-options")
    }
    let input = try EditorMediaPaths.shared.inputURL(request.uri, identity: job.identity)
    let sourceBytes = try input.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard sourceBytes > 0, sourceBytes <= 100 * 1024 * 1024 else {
      throw EditorMediaFailure.result(.invalidInput, "motion-source-size")
    }
    let asset = AVURLAsset(url: input)
    guard asset.isReadable, let track = asset.tracks(withMediaType: .video).first else {
      throw EditorMediaFailure.result(.unsupportedCodec, "video-track-missing")
    }
    let sourceSeconds = CMTimeGetSeconds(asset.duration), limit = request.tool == "optical-flow" ? 10.0 : 30.0
    let startSeconds = request.fromSeconds, seconds = request.durationSeconds ?? (sourceSeconds - startSeconds)
    guard sourceSeconds.isFinite, sourceSeconds > 0, startSeconds.isFinite, startSeconds >= 0,
          seconds.isFinite, seconds > 0, seconds <= limit,
          startSeconds + seconds <= sourceSeconds + 1 / Double(request.frameRate) else {
      throw EditorMediaFailure.result(.invalidInput, "motion-duration")
    }
    let natural = track.naturalSize.applying(track.preferredTransform)
    let sourceWidth = abs(natural.width), sourceHeight = abs(natural.height)
    guard sourceWidth >= 8, sourceHeight >= 8, max(sourceWidth, sourceHeight) <= 4096,
          min(sourceWidth, sourceHeight) / max(sourceWidth, sourceHeight) >= 0.1 else {
      throw EditorMediaFailure.result(.invalidInput, "source-too-large")
    }
    let targetAspect = request.tool == "track-reframe" ? request.aspect ?? sourceWidth / sourceHeight : sourceWidth / sourceHeight
    guard [9.0 / 16.0, 1.0, 16.0 / 9.0].contains(where: { request.tool != "track-reframe" || abs($0 - targetAspect) < 0.0001 }) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-motion-aspect")
    }
    let outputHeight = request.height, outputWidth = max(8, min(1280, Int((Double(outputHeight) * targetAspect / 2).rounded(.down)) * 2))
    let frameCount = Int(ceil(seconds * Double(request.frameRate)))
    guard frameCount > 0, frameCount <= 1800, outputWidth * outputHeight <= 1280 * 720 else {
      throw EditorMediaFailure.result(.invalidInput, "motion-output-too-large")
    }
    let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 600)
    progress("analysing", 0.02)
    var samples = request.tool == "track-reframe"
      ? try EditorAdvancedMotion.trackReframe(frameCount: frameCount, frameRate: request.frameRate,
          region: EditorAdvancedMotion.Region(x: request.regionX ?? 0.25, y: request.regionY ?? 0.25,
            width: request.regionWidth ?? 0.5, height: request.regionHeight ?? 0.5), smoothing: request.smoothing,
          frame: { index in try generator.copyCGImage(at: CMTime(seconds: startSeconds + Double(index) / Double(request.frameRate),
            preferredTimescale: 600_000), actualTime: nil) },
          cancelled: { job.cancelled || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) },
          progress: { progress("analysing", 0.02 + $0 * 0.28) }).map { MotionSample(x: $0.x, y: $0.y, luminance: $0.confidence) }
      : try analyse(generator, startSeconds: startSeconds, count: frameCount, frameRate: request.frameRate, smoothing: request.smoothing,
          job: job) { progress("analysing", 0.02 + $0 * 0.28) }
    try stopped(job)
    if request.tool == "camera-movement" { samples = Array(repeating: MotionSample(x: 0, y: 0, luminance: 0.5), count: frameCount) }

    var pcmId: String?
    if !asset.tracks(withMediaType: .audio).isEmpty {
      var pcm = DecodePcmRequest(); pcm.uri = request.uri; pcm.fromSeconds = startSeconds; pcm.toSeconds = startSeconds + seconds
      pcm.sampleRate = 48_000; pcm.channels = 2
      let decoded = try EditorPcmDecoder.decode(identity: job.identity, projectGeneration: job.projectGeneration, request: pcm,
        paths: EditorMediaPaths.shared,
        cancelled: { job.cancelled || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) }) {
          value in progress("preparing", 0.30 + value * 0.08)
        }
      pcmId = decoded["artifactId"] as? String
      guard pcmId != nil else { throw EditorMediaFailure.result(.corruptMedia, "motion-audio-decode") }
    }
    defer { if let pcmId { try? EditorMediaPaths.shared.release(job.identity.account, project: job.identity.project, artifactId: pcmId) } }
    var begin = BeginEncodeRequest(); begin.width = outputWidth; begin.height = outputHeight; begin.fps = request.frameRate
    begin.videoBitRate = outputHeight == 720 ? 6_000_000 : 3_000_000
    begin.alpha = request.alpha == true
    if let pcmId { begin.audioArtifactId = pcmId; begin.audioBitRate = 192_000 }
    let encoder = try EditorMp4Encoder(identity: job.identity, projectGeneration: job.projectGeneration, request: begin, paths: EditorMediaPaths.shared)
    var finished = false
    defer { if !finished { encoder.cancel() } }
    var records: [FrameRecord] = []
    for index in 0..<frameCount {
      try stopped(job)
      let time = min(startSeconds + seconds - 0.000_001, startSeconds + Double(index) / Double(request.frameRate))
      let picture = try generator.copyCGImage(at: CMTime(seconds: time, preferredTimescale: 600_000), actualTime: nil)
      let next: CGImage?
      if request.tool == "optical-flow", index + 1 < frameCount {
        next = try? generator.copyCGImage(at: CMTime(seconds: min(startSeconds + seconds - 0.000_001, startSeconds + Double(index + 1) / Double(request.frameRate)), preferredTimescale: 600_000), actualTime: nil)
      } else { next = nil }
      let bytes = try render(picture, next: next, index: index, count: frameCount, sample: samples[index], request: request,
        outputWidth: outputWidth, outputHeight: outputHeight,
        cancelled: { job.cancelled || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) })
      let file = EditorMediaPaths.shared.projectCache(job.identity)
        .appendingPathComponent("vx-frame-\(UUID().uuidString.lowercased()).rgba")
      do { try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true); try bytes.write(to: file, options: .atomic) }
      catch { throw EditorMediaFailure.result(.writeFailed) }
      var record = FrameRecord(); record.uri = file.absoluteString; record.index = index
      record.timestampUs = Int64((Double(index) * 1_000_000 / Double(request.frameRate)).rounded())
      record.byteLength = bytes.count; record.width = outputWidth; record.height = outputHeight; record.stride = outputWidth * 4
      records.append(record)
      if records.count == 8 || index == frameCount - 1 {
        _ = try encoder.append(records, cancelledExternally: {
          job.cancelled || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration)
        }); records.removeAll(keepingCapacity: true)
      }
      progress("processing", 0.38 + 0.57 * Double(index + 1) / Double(frameCount))
    }
    try stopped(job); progress("finishing", 0.96)
    let result = try encoder.finish(audioArtifactId: pcmId,
      cancelledExternally: { job.cancelled || !EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) },
      validBeforePublish: { !job.cancelled && EditorMediaWorker.shared.projectIsCurrent(job.identity, generation: job.projectGeneration) })
    finished = true; progress("finishing", 1)
    return result
  }

  private func analyse(_ generator: AVAssetImageGenerator, startSeconds: Double, count: Int, frameRate: Int, smoothing: Int,
                       job: EditorMotionJob, progress: (Double) -> Void) throws -> [MotionSample] {
    var samples: [MotionSample] = [], previous: [UInt8]?, pathX = 0.0, pathY = 0.0
    for index in 0..<count {
      try stopped(job)
      let image = try generator.copyCGImage(at: CMTime(seconds: startSeconds + Double(index) / Double(frameRate), preferredTimescale: 600_000), actualTime: nil)
      let small = grayscale(image, width: 64, height: 36), luminance = small.reduce(0.0) { $0 + Double($1) } / Double(small.count) / 255
      if let previous { let motion = translation(previous, small, width: 64, height: 36); pathX += motion.x; pathY += motion.y }
      samples.append(MotionSample(x: pathX, y: pathY, luminance: luminance)); previous = small
      if index % 3 == 0 { progress(Double(index + 1) / Double(count)) }
    }
    for index in samples.indices {
      let low = max(0, index - smoothing), high = min(samples.count - 1, index + smoothing)
      let window = samples[low...high], avgX = window.reduce(0.0) { $0 + $1.x } / Double(window.count)
      let avgY = window.reduce(0.0) { $0 + $1.y } / Double(window.count)
      let avgLog = window.reduce(0.0) { $0 + log(max(0.03, $1.luminance)) } / Double(window.count)
      samples[index].correctionX = avgX - samples[index].x; samples[index].correctionY = avgY - samples[index].y
      samples[index].gain = min(2, max(0.5, exp(avgLog) / max(0.03, samples[index].luminance)))
    }
    return samples
  }

  private func grayscale(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: width * height)
    bytes.withUnsafeMutableBytes { raw in
      let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
      context.interpolationQuality = .low; context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return bytes
  }
  private func translation(_ a: [UInt8], _ b: [UInt8], width: Int, height: Int) -> (x: Double, y: Double) {
    var best = Int64.max, bx = 0, by = 0
    for dy in -6...6 { for dx in -6...6 {
      var error: Int64 = 0, count = 0
      for y in 6..<(height - 6) where y + dy >= 0 && y + dy < height {
        for x in 6..<(width - 6) where x + dx >= 0 && x + dx < width {
          error += Int64(abs(Int(a[y * width + x]) - Int(b[(y + dy) * width + x + dx]))); count += 1
        }
      }
      if count > 0 && error < best { best = error; bx = dx; by = dy }
    } }
    return (Double(bx), Double(by))
  }

  private func render(_ image: CGImage, next: CGImage?, index: Int, count: Int, sample: MotionSample,
                      request: MotionProcessRequest, outputWidth: Int, outputHeight: Int,
                      cancelled: () -> Bool) throws -> Data {
    var value = normalized(CIImage(cgImage: image)), crop: CGRect
    let source = value.extent, progress = count > 1 ? Double(index) / Double(count - 1) : 0
    if request.tool == "camera-movement" {
      let fromX = request.fromX ?? 0.5, fromY = request.fromY ?? 0.5, fromZoom = request.fromZoom ?? 1
      let toX = request.toX ?? 0.5, toY = request.toY ?? 0.5, toZoom = request.toZoom ?? 1
      guard [fromX, fromY, toX, toY].allSatisfy({ (0...1).contains($0) }), [fromZoom, toZoom].allSatisfy({ (1...3).contains($0) }) else {
        throw EditorMediaFailure.result(.invalidInput, "invalid-camera-movement")
      }
      let eased = progress * progress * (3 - 2 * progress), zoom = fromZoom + (toZoom - fromZoom) * eased
      crop = cropRect(source: source, aspect: Double(outputWidth) / Double(outputHeight), x: fromX + (toX - fromX) * eased,
        y: fromY + (toY - fromY) * eased, zoom: zoom)
    } else if request.tool == "track-reframe" {
      let regionX = request.regionX ?? 0.25, regionY = request.regionY ?? 0.25
      let regionWidth = request.regionWidth ?? 0.5, regionHeight = request.regionHeight ?? 0.5
      guard regionWidth >= 0.05, regionHeight >= 0.05, regionX >= 0, regionY >= 0,
            regionX + regionWidth <= 1, regionY + regionHeight <= 1 else { throw EditorMediaFailure.result(.invalidInput, "invalid-track-region") }
      crop = cropRect(source: source, aspect: Double(outputWidth) / Double(outputHeight),
        x: min(1, max(0, sample.x)), y: min(1, max(0, sample.y)), zoom: 1)
    } else { crop = cropRect(source: source, aspect: Double(outputWidth) / Double(outputHeight), x: 0.5, y: 0.5, zoom: 1) }
    if request.tool == "stabilize" {
      let dx = sample.correctionX / 64 * source.width * request.strength
      let dy = sample.correctionY / 36 * source.height * request.strength
      let zoom = min(1.65, 1 + max(abs(dx) / source.width, abs(dy) / source.height) * 2)
      value = value.transformed(by: CGAffineTransform(translationX: CGFloat(dx), y: CGFloat(dy)))
      crop = cropRect(source: source, aspect: Double(outputWidth) / Double(outputHeight), x: 0.5, y: 0.5, zoom: zoom)
    }
    if request.tool == "flicker" {
      let gain = 1 + (sample.gain - 1) * request.strength
      let filter = CIFilter(name: "CIExposureAdjust")!; filter.setValue(value, forKey: kCIInputImageKey); filter.setValue(log2(gain), forKey: kCIInputEVKey); value = filter.outputImage ?? value
    }
    if request.tool == "optical-flow", let next {
      return try EditorAdvancedMotion.interpolate(image, next, fraction: 0.5, width: outputWidth, height: outputHeight,
        cancelled: cancelled)
    }
    value = value.cropped(to: crop).transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
    let scaleX = CGFloat(outputWidth) / crop.width, scaleY = CGFloat(outputHeight) / crop.height
    value = value.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY)).cropped(to: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight))
    var data = Data(count: outputWidth * outputHeight * 4)
    data.withUnsafeMutableBytes { raw in
      ci.render(value, toBitmap: raw.baseAddress!, rowBytes: outputWidth * 4,
        bounds: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight), format: .RGBA8,
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    }
    return data
  }
  private func normalized(_ image: CIImage) -> CIImage {
    image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
  }
  private func cropRect(source: CGRect, aspect: Double, x: Double, y: Double, zoom: Double) -> CGRect {
    var width = source.width, height = source.height
    if Double(width / height) > aspect { width = height * CGFloat(aspect) } else { height = width / CGFloat(aspect) }
    width /= CGFloat(zoom); height /= CGFloat(zoom)
    let originX = min(source.maxX - width, max(source.minX, source.minX + CGFloat(x) * source.width - width / 2))
    let originY = min(source.maxY - height, max(source.minY, source.minY + CGFloat(y) * source.height - height / 2))
    return CGRect(x: originX, y: originY, width: width, height: height)
  }
}

public final class VeyrnoxEditorMotionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeyrnoxEditorMotion")
    Events("progress")
    AsyncFunction("capabilities") { (promise: Promise) in
      promise.resolve(["ok": true, "platform": "ios", "minimumIos": "16.4",
        "tools": ["stabilize", "flicker", "optical-flow", "track-reframe", "camera-movement"]])
    }
    AsyncFunction("inspect") { (account: String, project: String, owner: String, token: String,
                                 uri: String, promise: Promise) in
      do {
        let identity = try EditorMediaIdentity(account, project, owner, token)
        let url = try EditorMediaPaths.shared.inputURL(uri, identity: identity)
        var result = try EditorFrameSampler.inspect(url: url)
        result["fileSize"] = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        promise.resolve(result)
      } catch let error as EditorMediaFailure { promise.resolve(error.dictionary) }
      catch { promise.resolve(["ok": false, "code": "corrupt-media"]) }
    }
    AsyncFunction("process") { (account: String, project: String, owner: String, token: String,
                                 request: MotionProcessRequest, promise: Promise) in
      do {
        let identity = try EditorMediaIdentity(account, project, owner, token)
        EditorMotionWorker.shared.process(identity, request: request, promise: promise) { [weak self] stage, value in
          self?.sendEvent("progress", ["owner": owner, "token": token, "stage": stage, "value": value])
        }
      } catch { promise.resolve(["ok": false, "code": "invalid-input"]) }
    }
    Function("cancel") { (account: String, project: String, owner: String, token: String) in
      if let identity = try? EditorMediaIdentity(account, project, owner, token) { EditorMotionWorker.shared.cancel(identity) }
    }
  }
}

private final class SpeechRun {
  let token: String, promise: Promise
  var task: SFSpeechRecognitionTask?
  let temporary: URL?
  var finished = false
  init(token: String, promise: Promise, temporary: URL? = nil) { self.token = token; self.promise = promise; self.temporary = temporary }
}

private final class EditorSpeechWorker {
  static let shared = EditorSpeechWorker()
  private let lock = NSLock()
  private var runs: [String: SpeechRun] = [:]
  private let authorizationKey = "ai.veyrnox.editor-speech-was-authorized"

  func permission() -> [String: Any] {
    let state = permissionName(SFSpeechRecognizer.authorizationStatus())
    if state == "authorized" { UserDefaults.standard.set(true, forKey: authorizationKey) }
    let revoked = UserDefaults.standard.bool(forKey: authorizationKey) && state == "denied"
    return ["ok": true, "permission": revoked ? "revoked" : state]
  }
  func requestPermission(_ promise: Promise) {
    SFSpeechRecognizer.requestAuthorization { _ in DispatchQueue.main.async { promise.resolve(self.permission()) } }
  }
  func capabilities(locale: String) -> [String: Any] {
    let available: Bool
    if #available(iOS 26.0, *) { available = true } else { available = false }
    guard locale.utf8.count <= 80, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
      return ["ok": true, "platform": "ios", "minimumIos": "16.4", "automaticCaptions": false,
        "onDeviceRecognition": false, "translation": available,
        "translationGate": available ? NSNull() : "ios-translation-requires-ios-26"]
    }
    return ["ok": true, "platform": "ios", "minimumIos": "16.4", "automaticCaptions": true,
      "onDeviceRecognition": recognizer.supportsOnDeviceRecognition, "translation": available,
      "translationGate": available ? NSNull() : "ios-translation-requires-ios-26"]
  }
  func translate(_ source: String, _ target: String, _ texts: [String], promise: Promise) {
    guard source.utf8.count <= 80, target.utf8.count <= 80, !source.isEmpty, !target.isEmpty,
          !texts.isEmpty, texts.count <= 150, texts.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 4_000 }),
          texts.reduce(0, { $0 + $1.utf8.count }) <= 40_000 else {
      promise.resolve(["ok": false, "code": "invalid-input"]); return
    }
    guard #available(iOS 26.0, *) else {
      promise.resolve(["ok": false, "code": "translation-unavailable"]); return
    }
    Task { @MainActor in
      do {
        let session = TranslationSession(installedSource: Locale.Language(identifier: source),
          target: Locale.Language(identifier: target))
        var output: [String] = []
        for text in texts { output.append(try await session.translate(text).targetText) }
        promise.resolve(["ok": true, "onDevice": true, "sourceLocale": source,
          "targetLocale": target, "texts": output])
      } catch { promise.resolve(["ok": false, "code": "languages-not-installed"]) }
    }
  }
  func transcribe(_ identity: EditorMediaIdentity, uri: String, locale: String, promise: Promise) {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
          locale.utf8.count <= 80, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
          recognizer.supportsOnDeviceRecognition,
          let url = try? EditorMediaPaths.shared.inputURL(uri, identity: identity) else {
      promise.resolve(["ok": false, "code": SFSpeechRecognizer.authorizationStatus() == .authorized
        ? "on-device-unavailable" : "permission-denied"]); return
    }
    let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    let asset = AVURLAsset(url: url), duration = CMTimeGetSeconds(asset.duration)
    guard values?.isRegularFile == true, let bytes = values?.fileSize, bytes > 0, bytes <= 100 * 1024 * 1024,
          duration.isFinite, duration > 0, duration <= 30 else {
      promise.resolve(["ok": false, "code": "invalid-input"]); return
    }
    start(identity, url: url, locale: locale, promise: promise)
  }
  func transcribePcm(_ identity: EditorMediaIdentity, artifactId: String, locale: String, promise: Promise) {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
          let folder = try? EditorMediaPaths.shared.artifactFolder(identity.account, project: identity.project, artifactId: artifactId),
          let raw = try? EditorMediaPaths.shared.artifactFile(folder, name: "audio.f32le"),
          let manifestURL = try? EditorMediaPaths.shared.artifactFile(folder, name: "pcm.json"),
          let manifestData = try? Data(contentsOf: manifestURL),
          let manifest = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          manifest["sampleRate"] as? Int == 48_000, manifest["channels"] as? Int == 2,
          manifest["format"] as? String == "f32le-interleaved", let bytes = manifest["bytes"] as? Int,
          bytes > 0, bytes <= 30 * 48_000 * 2 * 4, bytes <= EditorMediaPaths.pcmLimit, bytes % 8 == 0,
          (try? raw.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]))?.isRegularFile == true,
          (try? raw.resourceValues(forKeys: [.fileSizeKey]))?.fileSize == bytes else {
      promise.resolve(["ok": false, "code": "invalid-input"]); return
    }
    let wave = EditorMediaPaths.shared.projectCache(identity).appendingPathComponent("vx-speech-\(UUID().uuidString.lowercased()).wav")
    do { try speechWave(raw: raw, bytes: bytes).write(to: wave, options: .atomic) }
    catch { try? FileManager.default.removeItem(at: wave); promise.resolve(["ok": false, "code": "recognition-failed"]); return }
    start(identity, url: wave, locale: locale, promise: promise, temporary: wave)
  }
  private func start(_ identity: EditorMediaIdentity, url: URL, locale: String, promise: Promise, temporary: URL? = nil) {
    guard locale.utf8.count <= 80, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
          recognizer.supportsOnDeviceRecognition else {
      if let temporary { try? FileManager.default.removeItem(at: temporary) }
      promise.resolve(["ok": false, "code": "on-device-unavailable"]); return
    }
    let run = SpeechRun(token: identity.token, promise: promise, temporary: temporary)
    lock.lock()
    guard runs[identity.token] == nil, runs.count < 2 else {
      lock.unlock(); if let temporary { try? FileManager.default.removeItem(at: temporary) }
      promise.resolve(["ok": false, "code": "busy"]); return
    }
    runs[identity.token] = run; lock.unlock()
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true; request.shouldReportPartialResults = false
    request.addsPunctuation = true
    run.task = recognizer.recognitionTask(with: request) { result, error in
      guard result?.isFinal == true || error != nil else { return }
      if let result, result.isFinal {
        let segments = result.bestTranscription.segments.prefix(1_000).map { segment in
          ["text": segment.substring, "startMs": Int((segment.timestamp * 1_000).rounded()),
           "durationMs": max(1, Int((segment.duration * 1_000).rounded()))] as [String: Any]
        }
        self.finish(run, value: ["ok": true, "locale": locale, "onDevice": true,
          "text": result.bestTranscription.formattedString, "segments": segments])
      } else { self.finish(run, value: ["ok": false, "code": "recognition-failed"]) }
    }
  }
  func cancel(_ token: String) {
    lock.lock(); let run = runs[token]; lock.unlock(); run?.task?.cancel()
    if let run { finish(run, value: ["ok": false, "code": "cancelled"]) }
  }
  private func finish(_ run: SpeechRun, value: [String: Any]) {
    lock.lock(); guard !run.finished else { lock.unlock(); return }
    run.finished = true; runs.removeValue(forKey: run.token); lock.unlock()
    if let temporary = run.temporary { try? FileManager.default.removeItem(at: temporary) }
    run.promise.resolve(value)
  }
  private func speechWave(raw: URL, bytes: Int) throws -> Data {
    let pcm = try Data(contentsOf: raw, options: .mappedIfSafe)
    guard pcm.count == bytes else { throw EditorMediaFailure.result(.corruptMedia) }
    var output = Data(); func text(_ value: String) { output.append(value.data(using: .ascii)!) }
    func u16(_ value: UInt16) { var little = value.littleEndian; output.append(Data(bytes: &little, count: 2)) }
    func u32(_ value: UInt32) { var little = value.littleEndian; output.append(Data(bytes: &little, count: 4)) }
    text("RIFF"); u32(UInt32(36 + bytes)); text("WAVEfmt "); u32(16); u16(3); u16(2); u32(48_000)
    u32(48_000 * 2 * 4); u16(8); u16(32); text("data"); u32(UInt32(bytes)); output.append(pcm); return output
  }
  private func permissionName(_ state: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "restricted"
    }
  }
}

public final class VeyrnoxEditorSpeechModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeyrnoxEditorSpeech")
    AsyncFunction("permission") { (promise: Promise) in promise.resolve(EditorSpeechWorker.shared.permission()) }
    AsyncFunction("requestPermission") { (promise: Promise) in EditorSpeechWorker.shared.requestPermission(promise) }
    AsyncFunction("capabilities") { (locale: String, promise: Promise) in
      promise.resolve(EditorSpeechWorker.shared.capabilities(locale: locale))
    }
    AsyncFunction("transcribe") { (account: String, project: String, owner: String, token: String,
                                     uri: String, locale: String, promise: Promise) in
      do {
        let identity = try EditorMediaIdentity(account, project, owner, token)
        EditorSpeechWorker.shared.transcribe(identity, uri: uri, locale: locale, promise: promise)
      } catch { promise.resolve(["ok": false, "code": "invalid-input"]) }
    }
    AsyncFunction("transcribePcm") { (account: String, project: String, owner: String, token: String,
                                        artifactId: String, locale: String, promise: Promise) in
      do {
        let identity = try EditorMediaIdentity(account, project, owner, token)
        EditorSpeechWorker.shared.transcribePcm(identity, artifactId: artifactId, locale: locale, promise: promise)
      } catch { promise.resolve(["ok": false, "code": "invalid-input"]) }
    }
    AsyncFunction("translate") { (sourceLocale: String, targetLocale: String, texts: [String], promise: Promise) in
      EditorSpeechWorker.shared.translate(sourceLocale, targetLocale, texts, promise: promise)
    }
    Function("cancel") { (token: String) in EditorSpeechWorker.shared.cancel(token) }
  }
}
