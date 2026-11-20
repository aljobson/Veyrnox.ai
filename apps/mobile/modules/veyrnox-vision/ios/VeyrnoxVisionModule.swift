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
    AsyncFunction("init") { (promise: Promise) in VisionWorker.shared.initialize(promise) }
    AsyncFunction("detect") { (owner: String, token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise) in
      VisionWorker.shared.submit(owner, token, op, jpeg, width, height, promise) { [weak self] in
        self?.sendEvent("admitted", ["token": token])
      }
    }
    Function("cancel") { (owner: String, token: String) in VisionWorker.shared.cancel(owner, token) }
  }
}
