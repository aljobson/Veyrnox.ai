import ExpoModulesCore
import Foundation

final class EditorMediaWorker {
  static let shared = EditorMediaWorker()
  typealias Progress = (String, Double) -> Void

  private struct JobKey: Hashable {
    let account: String, project: String, owner: String, token: String
    init(_ identity: EditorMediaIdentity) {
      account = identity.account; project = identity.project; owner = identity.owner; token = identity.token
    }
  }
  private struct Lease: Equatable {
    let key: JobKey, projectGeneration: Int, ownerEpoch: Int
  }

  private let executor = DispatchQueue(label: "ai.veyrnox.editor-media")
  private let gate = NSLock()
  private let paths = EditorMediaPaths.shared
  private var account: String?
  private var ownerSet = false, ownerEpoch = 0
  private var adoptedClientOwner: String?
  private var adoptedClientEpoch: Int?
  private var generations: [String: Int] = [:]
  private var reserved: Lease?
  private var cancelled = Set<JobKey>()
  private var cancelledOrder: [JobKey] = []
  private var encoder: EditorMp4Encoder?
  private var cleaned = false

  func capabilities(_ promise: Promise) {
    let names = ["inspect", "sampleFrames", "decodePcm", "mixAudio", "beginEncode", "appendFrameBatch",
      "finishEncode", "cancel", "cancelProject", "release"]
    let operations = names.reduce(into: [String: Bool]()) { $0[$1] = true }
    promise.resolve(["ok": true, "available": true, "platform": "ios", "protocolVersion": 1,
      "operations": operations])
  }

  func setOwner(_ next: String?, clientOwner: String, clientEpoch: Int, promise: Promise) {
    if let next, (try? EditorMediaIdentity(next, "owner", "owner", "owner")) == nil {
      promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    guard (try? EditorMediaIdentity("account", "project", clientOwner, "token")) != nil,
          clientEpoch >= 0 else {
      promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    gate.lock()
    if adoptedClientOwner == clientOwner, let adoptedClientEpoch, clientEpoch < adoptedClientEpoch {
      gate.unlock(); promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    if ownerSet && account == next && adoptedClientOwner == clientOwner
      && adoptedClientEpoch == clientEpoch { gate.unlock(); promise.resolve(nil); return }
    let captured = reserved
    if let captured { rememberCancelled(captured.key) }
    ownerEpoch += 1; let epoch = ownerEpoch
    account = next; adoptedClientOwner = clientOwner; adoptedClientEpoch = clientEpoch
    ownerSet = true; generations.removeAll()
    gate.unlock()
    EditorMotionWorker.shared.cancelAll()
    executor.async {
      if let captured { self.abort(captured) }
      if self.ownerMatches(next, epoch: epoch) { self.paths.purgeForeignAccounts(next) }
      promise.resolve(nil)
    }
  }

  func setProjectGeneration(_ account: String, project: String, generation: Int, promise: Promise) {
    guard generation >= 0,
          (try? EditorMediaIdentity(account, project, "generation", "generation")) != nil else {
      promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    let mapKey = generationKey(account, project)
    gate.lock()
    guard self.account == account else { gate.unlock(); promise.resolve(nil); return }
    if let old = generations[mapKey], generation < old {
      gate.unlock(); promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    if generations[mapKey] == generation { gate.unlock(); promise.resolve(nil); return }
    generations[mapKey] = generation
    let epoch = ownerEpoch
    let captured = reserved.flatMap { $0.key.account == account && $0.key.project == project ? $0 : nil }
    if let captured { rememberCancelled(captured.key) }
    gate.unlock()
    EditorMotionWorker.shared.cancelProject(account, project)
    executor.async {
      if let captured { self.abort(captured) }
      if self.projectMatches(account, project, generation: generation, epoch: epoch) {
        self.paths.purgeProject(account: account, project: project)
      }
      promise.resolve(nil)
    }
  }

  func inspect(_ account: String, _ project: String, _ owner: String, _ token: String,
               uri: String, promise: Promise, progress: @escaping Progress) {
    submit(account, project, owner, token, promise: promise, progress: progress) { identity, _, cancelled, _ in
      let url = try self.paths.inputURL(uri, identity: identity)
      if cancelled() { throw EditorMediaFailure.result(.cancelled) }
      return try EditorFrameSampler.inspect(url: url)
    }
  }

  func sampleFrames(_ account: String, _ project: String, _ owner: String, _ token: String,
                    request: SampleFramesRequest, promise: Promise, progress: @escaping Progress) {
    submit(account, project, owner, token, promise: promise, progress: progress) { identity, generation, cancelled, emit in
      emit("decoding", 0.05)
      return try EditorFrameSampler.sample(identity: identity, projectGeneration: generation,
        request: request, paths: self.paths, cancelled: cancelled) { emit("decoding", 0.05 + 0.90 * $0) }
    }
  }

  func decodePcm(_ account: String, _ project: String, _ owner: String, _ token: String,
                 request: DecodePcmRequest, promise: Promise, progress: @escaping Progress) {
    submit(account, project, owner, token, promise: promise, progress: progress) { identity, generation, cancelled, emit in
      emit("decoding", 0.05)
      return try EditorPcmDecoder.decode(identity: identity, projectGeneration: generation,
        request: request, paths: self.paths, cancelled: cancelled) { emit("decoding", 0.05 + 0.90 * $0) }
    }
  }

  func mixAudio(_ account: String, _ project: String, _ owner: String, _ token: String,
                mixJSON: String, sources: [String: String], frames: Int, fps: Int,
                promise: Promise, progress: @escaping Progress) {
    submit(account, project, owner, token, promise: promise, progress: progress) { identity, generation, cancelled, emit in
      emit("decoding", 0.05)
      return try EditorAdvancedAudioMix.mix(identity, projectGeneration: generation, mixJSON,
        sources, frames, fps, paths: self.paths, cancelled: cancelled) {
          emit("decoding", 0.05 + 0.90 * $0)
        }
    }
  }

  func beginEncode(_ account: String, _ project: String, _ owner: String, _ token: String,
                   request: BeginEncodeRequest, promise: Promise, progress: @escaping Progress) {
    guard let identity = try? EditorMediaIdentity(account, project, owner, token) else {
      promise.resolve(EditorMediaFailure.result(.invalidInput, "invalid-identity").dictionary); return
    }
    guard let lease = reserve(JobKey(identity)) else {
      promise.resolve(EditorMediaFailure.result(admissionCode(for: JobKey(identity))).dictionary); return
    }
    executor.async {
      let audioExclusions: Set<String>
      if let artifactId = request.audioArtifactId,
         let folder = try? self.paths.artifactFolder(account, project: project, artifactId: artifactId) {
        audioExclusions = [folder.path]
      } else { audioExclusions = [] }
      self.cleanupIfNeeded(excluding: audioExclusions)
      var result = mediaResult {
        try self.validate(lease); self.emit(progress, lease, "preparing", 0)
        let encoder = try EditorMp4Encoder(identity: identity, projectGeneration: lease.projectGeneration,
          request: request, paths: self.paths)
        guard self.isValid(lease) else { encoder.cancel(); throw EditorMediaFailure.result(.cancelled) }
        self.encoder = encoder; self.emit(progress, lease, "preparing", 0.05)
        self.scheduleTimeout(encoder.sessionId, activity: encoder.lastActivity, lease: lease)
        return ["ok": true, "sessionId": encoder.sessionId]
      }
      if result["ok"] as? Bool == true, !self.isValid(lease) {
        self.encoder?.cancel(); self.encoder = nil; result = EditorMediaFailure.result(.cancelled).dictionary
      }
      if result["ok"] as? Bool != true {
        self.encoder?.cancel(); self.encoder = nil; self.clearReservation(lease)
      }
      promise.resolve(result)
    }
  }

  func appendFrameBatch(_ account: String, _ project: String, _ owner: String, _ token: String,
                        sessionId: String, frames: [FrameRecord], promise: Promise,
                        progress: @escaping Progress) {
    guard let identity = try? EditorMediaIdentity(account, project, owner, token) else {
      promise.resolve(EditorMediaFailure.result(.invalidInput, "invalid-identity").dictionary); return
    }
    let key = JobKey(identity)
    guard let lease = lease(for: key) else {
      let wasCancelled = isCancelled(key)
      if wasCancelled { executor.async { EditorFrameDescriptor.discard(frames, paths: self.paths, identity: identity) } }
      promise.resolve(EditorMediaFailure.result(wasCancelled ? .cancelled : admissionCode(for: key)).dictionary); return
    }
    executor.async {
      let startingFrames = self.encoder?.framesWritten
      let result = mediaResult {
        guard self.isValid(lease) else {
          EditorFrameDescriptor.discard(frames, paths: self.paths, identity: identity)
          throw EditorMediaFailure.result(.cancelled)
        }
        guard let encoder = self.encoder, encoder.sessionId == sessionId,
              encoder.projectGeneration == lease.projectGeneration else {
          EditorFrameDescriptor.discard(frames, paths: self.paths, identity: identity)
          throw EditorMediaFailure.result(.cancelled)
        }
        let value = try encoder.append(frames, cancelledExternally: { !self.isValid(lease) })
        self.emit(progress, lease, "encoding", 0.05 + 0.90 * encoder.progress)
        self.scheduleTimeout(encoder.sessionId, activity: encoder.lastActivity, lease: lease)
        return value
      }
      let partialBatch = startingFrames.map { self.encoder?.framesWritten != $0 } ?? false
      if let code = result["code"] as? String,
         code != EditorMediaCode.invalidInput.rawValue || partialBatch { self.cancelLease(lease) }
      promise.resolve(result)
    }
  }

  func finishEncode(_ account: String, _ project: String, _ owner: String, _ token: String,
                    sessionId: String, audioArtifactId: String?, promise: Promise,
                    progress: @escaping Progress) {
    guard let identity = try? EditorMediaIdentity(account, project, owner, token) else {
      promise.resolve(EditorMediaFailure.result(.invalidInput, "invalid-identity").dictionary); return
    }
    let key = JobKey(identity)
    guard let lease = lease(for: key) else {
      promise.resolve(EditorMediaFailure.result(isCancelled(key) ? .cancelled : admissionCode(for: key)).dictionary); return
    }
    executor.async {
      var result = mediaResult {
        try self.validate(lease)
        guard let encoder = self.encoder, encoder.sessionId == sessionId,
              encoder.projectGeneration == lease.projectGeneration else {
          throw EditorMediaFailure.result(.cancelled)
        }
        self.emit(progress, lease, "finishing", 0.95)
        return try encoder.finish(audioArtifactId: audioArtifactId,
          cancelledExternally: { !self.isValid(lease) }, validBeforePublish: { self.isValid(lease) })
      }
      if result["ok"] as? Bool == true {
        if self.takeIfValid(lease) { progress("finishing", 1) }
        else {
          self.deleteCandidate(result, identity: identity)
          result = EditorMediaFailure.result(.cancelled).dictionary
        }
      } else { self.cancelLease(lease) }
      self.encoder = nil; promise.resolve(result)
    }
  }

  func cancel(_ account: String, _ project: String, _ owner: String, _ token: String) {
    guard let identity = try? EditorMediaIdentity(account, project, owner, token) else { return }
    let key = JobKey(identity)
    gate.lock(); rememberCancelled(key); let captured = reserved.flatMap { $0.key == key ? $0 : nil }; gate.unlock()
    if let captured { executor.async { self.abort(captured) } }
  }

  func cancelProject(_ account: String, _ project: String, promise: Promise) {
    guard (try? EditorMediaIdentity(account, project, "project", "project")) != nil else {
      promise.reject(EditorMediaCode.invalidInput.rawValue, EditorMediaCode.invalidInput.rawValue); return
    }
    gate.lock()
    guard self.account == account else { gate.unlock(); promise.resolve(nil); return }
    let mapKey = generationKey(account, project)
    let nextGeneration = (generations[mapKey] ?? 0) + 1; generations[mapKey] = nextGeneration
    let epoch = ownerEpoch
    let captured = reserved.flatMap { $0.key.account == account && $0.key.project == project ? $0 : nil }
    if let captured { rememberCancelled(captured.key) }
    gate.unlock()
    EditorMotionWorker.shared.cancelProject(account, project)
    executor.async {
      if let captured { self.abort(captured) }
      if self.projectMatches(account, project, generation: nextGeneration, epoch: epoch) {
        self.paths.purgeProject(account: account, project: project)
      }
      promise.resolve(nil)
    }
  }

  func release(_ account: String, _ project: String, artifactId: String, promise: Promise) {
    executor.async {
      if self.encoder?.ownsAudioArtifact(account: account, project: project, artifactId: artifactId) == true {
        promise.reject(EditorMediaCode.busy.rawValue, EditorMediaCode.busy.rawValue); return
      }
      do { try self.paths.release(account, project: project, artifactId: artifactId); promise.resolve(nil) }
      catch let failure as EditorMediaFailure {
        let value = failure.dictionary, code = value["code"] as? String ?? EditorMediaCode.writeFailed.rawValue
        promise.reject(code, code)
      } catch { promise.reject(EditorMediaCode.writeFailed.rawValue, EditorMediaCode.writeFailed.rawValue) }
    }
  }

  func currentProjectGeneration(_ identity: EditorMediaIdentity) -> Int? {
    gate.lock(); defer { gate.unlock() }
    guard ownerSet, account == identity.account else { return nil }
    return generations[generationKey(identity.account, identity.project)] ?? 0
  }

  func projectIsCurrent(_ identity: EditorMediaIdentity, generation: Int) -> Bool {
    gate.lock(); defer { gate.unlock() }
    return ownerSet && account == identity.account
      && (generations[generationKey(identity.account, identity.project)] ?? 0) == generation
  }

  private func submit(_ account: String, _ project: String, _ owner: String, _ token: String,
                      promise: Promise, progress: @escaping Progress,
                      work: @escaping (EditorMediaIdentity, Int, @escaping () -> Bool,
                        @escaping Progress) throws -> [String: Any]) {
    guard let identity = try? EditorMediaIdentity(account, project, owner, token) else {
      promise.resolve(EditorMediaFailure.result(.invalidInput, "invalid-identity").dictionary); return
    }
    guard let lease = reserve(JobKey(identity)) else {
      promise.resolve(EditorMediaFailure.result(admissionCode(for: JobKey(identity))).dictionary); return
    }
    executor.async {
      self.cleanupIfNeeded(); self.emit(progress, lease, "preparing", 0)
      var result = autoreleasepool { mediaResult {
        try self.validate(lease)
        return try work(identity, lease.projectGeneration, { !self.isValid(lease) },
          { stage, value in self.emit(progress, lease, stage, value) })
      } }
      if result["ok"] as? Bool == true {
        if !self.takeIfValid(lease) {
          self.deleteCandidate(result, identity: identity)
          result = EditorMediaFailure.result(.cancelled).dictionary
        }
      } else { self.clearReservation(lease) }
      promise.resolve(result)
    }
  }

  private func reserve(_ key: JobKey) -> Lease? {
    gate.lock(); defer { gate.unlock() }
    guard reserved == nil, account == key.account, adoptedClientOwner == key.owner else { return nil }
    let generation = generations[generationKey(key.account, key.project)] ?? 0
    let lease = Lease(key: key, projectGeneration: generation, ownerEpoch: ownerEpoch)
    reserved = lease; cancelled.remove(key); cancelledOrder.removeAll { $0 == key }; return lease
  }
  private func lease(for key: JobKey) -> Lease? {
    gate.lock(); defer { gate.unlock() }; return reserved?.key == key ? reserved : nil
  }
  private func admissionCode(for key: JobKey) -> EditorMediaCode {
    gate.lock(); defer { gate.unlock() }
    return account != key.account || adoptedClientOwner != key.owner ? .cancelled : .busy
  }
  private func validate(_ lease: Lease) throws {
    guard isValid(lease) else { throw EditorMediaFailure.result(.cancelled) }
  }
  private func isValid(_ lease: Lease) -> Bool {
    gate.lock(); defer { gate.unlock() }
    return reserved == lease && account == lease.key.account && ownerEpoch == lease.ownerEpoch
      && generations[generationKey(lease.key.account, lease.key.project)] ?? 0 == lease.projectGeneration
      && !cancelled.contains(lease.key)
  }
  private func clearReservation(_ lease: Lease) {
    gate.lock(); if reserved == lease { reserved = nil }; gate.unlock()
  }
  private func takeIfValid(_ lease: Lease) -> Bool {
    gate.lock(); defer { gate.unlock() }
    let valid = reserved == lease && account == lease.key.account && ownerEpoch == lease.ownerEpoch
      && generations[generationKey(lease.key.account, lease.key.project)] ?? 0 == lease.projectGeneration
      && !cancelled.contains(lease.key)
    if reserved == lease { reserved = nil }
    return valid
  }
  private func rememberCancelled(_ key: JobKey) {
    if cancelled.insert(key).inserted { cancelledOrder.append(key) }
    if cancelledOrder.count > 256,
       let index = cancelledOrder.firstIndex(where: { $0 != reserved?.key }) {
      cancelled.remove(cancelledOrder.remove(at: index))
    }
  }
  private func isCancelled(_ key: JobKey) -> Bool {
    gate.lock(); defer { gate.unlock() }; return cancelled.contains(key)
  }
  private func abort(_ lease: Lease) {
    if let encoder, encoder.identity.account == lease.key.account,
       encoder.identity.project == lease.key.project, encoder.identity.owner == lease.key.owner,
       encoder.identity.token == lease.key.token, encoder.projectGeneration == lease.projectGeneration {
      encoder.cancel(); self.encoder = nil
    }
    clearReservation(lease)
  }
  private func cancelLease(_ lease: Lease) {
    gate.lock(); rememberCancelled(lease.key); gate.unlock(); abort(lease)
  }
  private func emit(_ progress: Progress, _ lease: Lease, _ stage: String, _ value: Double) {
    if isValid(lease) { progress(stage, min(1, max(0, value))) }
  }
  private func deleteCandidate(_ result: [String: Any], identity: EditorMediaIdentity) {
    if let artifactId = result["artifactId"] as? String {
      try? paths.release(identity.account, project: identity.project, artifactId: artifactId)
    }
  }
  private func cleanupIfNeeded(excluding additional: Set<String> = []) {
    guard !cleaned else { return }; cleaned = true
    paths.cleanupOnce(excluding: additional.union(encoder?.cleanupExclusions() ?? []))
  }
  private func scheduleTimeout(_ sessionId: String, activity: Date, lease: Lease) {
    executor.asyncAfter(deadline: .now() + 30) {
      guard let encoder = self.encoder, encoder.sessionId == sessionId,
            encoder.lastActivity == activity, encoder.isIdle() else { return }
      self.gate.lock(); self.rememberCancelled(lease.key); self.gate.unlock(); self.abort(lease)
    }
  }
  private func ownerMatches(_ value: String?, epoch: Int) -> Bool {
    gate.lock(); defer { gate.unlock() }; return account == value && ownerEpoch == epoch
  }
  private func projectMatches(_ account: String, _ project: String, generation: Int, epoch: Int) -> Bool {
    gate.lock(); defer { gate.unlock() }
    return self.account == account && ownerEpoch == epoch
      && generations[generationKey(account, project)] == generation
  }
  private func generationKey(_ account: String, _ project: String) -> String { account + "/" + project }
}
