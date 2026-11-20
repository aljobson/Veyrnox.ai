import ExpoModulesCore

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
  private var queued: Job?
  private final class Job {
    let token: String, op: String, jpeg: String
    let width: Int, height: Int, promise: Promise
    let admitted: () -> Void
    var cancelled = false
    init(_ token: String, _ op: String, _ jpeg: String, _ width: Int, _ height: Int,
         _ promise: Promise, _ admitted: @escaping () -> Void) {
      self.token = token; self.op = op; self.jpeg = jpeg; self.width = width
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
        do { try self.engine.initialize(); return true } catch { return false }
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
  func submit(_ token: String, _ op: String, _ jpeg: String, _ width: Int, _ height: Int,
              _ promise: Promise, _ admitted: @escaping () -> Void) {
    lock.lock()
    guard initialized, token.count <= 100, jpeg.utf8.count <= 900_000 else {
      lock.unlock(); promise.resolve(["error": "inference-unavailable"]); return
    }
    let job = Job(token, op, jpeg, width, height, promise, admitted)
    if running != nil {
      let old = queued; queued = job
      lock.unlock(); old?.promise.resolve(["cancelled": true]); return
    }
    running = job
    lock.unlock()
    execute(job)
  }
  func cancel(_ token: String) {
    lock.lock()
    if running?.token == token { running?.cancelled = true }
    let dropped = queued?.token == token ? queued : nil
    if dropped != nil { queued = nil }
    lock.unlock()
    dropped?.promise.resolve(["cancelled": true])
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
      let next = self.queued; self.queued = nil; self.running = next
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
    AsyncFunction("init") { (promise: Promise) in VisionWorker.shared.initialize(promise) }
    AsyncFunction("detect") { (token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise) in
      VisionWorker.shared.submit(token, op, jpeg, width, height, promise) { [weak self] in
        self?.sendEvent("admitted", ["token": token])
      }
    }
    Function("cancel") { (token: String) in VisionWorker.shared.cancel(token) }
  }
}
