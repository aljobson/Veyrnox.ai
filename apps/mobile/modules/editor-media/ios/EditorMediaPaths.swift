import Foundation

final class EditorMediaPaths {
  static let shared = EditorMediaPaths()
  static let quota = 512 * 1024 * 1024
  static let frameLimit = 64 * 1024 * 1024
  static let pcmLimit = 16 * 1024 * 1024
  static let mp4Limit = 25 * 1024 * 1024
  static let batchLimit = 32 * 1024 * 1024
  static let artifactOverhead = 1024 * 1024
  private let fm = FileManager.default
  private let marker = ".vx-artifact"
  private let processGeneration = UUID().uuidString.lowercased()
  private init() {}

  private var documentRoot: URL {
    fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("veyrnox-editor-media", isDirectory: true)
  }
  private var cacheRoot: URL {
    fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("veyrnox-editor-media", isDirectory: true)
  }
  func projectCache(_ identity: EditorMediaIdentity) -> URL {
    cacheRoot.appendingPathComponent(identity.account, isDirectory: true)
      .appendingPathComponent(identity.project, isDirectory: true)
  }
  func inputURL(_ source: String, identity: EditorMediaIdentity, cacheOnly: Bool = false) throws -> URL {
    let lowered = source.lowercased()
    guard !lowered.contains("%2e"), !lowered.contains("%2f"), !lowered.contains("%5c"),
          let parts = URLComponents(string: source),
          parts.scheme == "file", parts.host == nil || parts.host?.isEmpty == true,
          parts.query == nil, parts.fragment == nil, let raw = parts.url else {
      throw EditorMediaFailure.result(.invalidInput, "unsafe-file-url")
    }
    let candidate = raw.standardizedFileURL.resolvingSymlinksInPath()
    let cache = projectCache(identity).standardizedFileURL.resolvingSymlinksInPath()
    let document = documentRoot.appendingPathComponent(identity.account, isDirectory: true)
      .appendingPathComponent(identity.project, isDirectory: true)
      .standardizedFileURL.resolvingSymlinksInPath()
    guard contains(cache, candidate) || (!cacheOnly && contains(document, candidate)) else {
      throw EditorMediaFailure.result(.invalidInput, "file-outside-editor-roots")
    }
    return candidate
  }
  func makeArtifact(_ identity: EditorMediaIdentity, kind: String, expected: Int,
                    projectGeneration: Int, excluding: Set<String> = []) throws -> (String, URL) {
    guard ["frames", "pcm", "mp4"].contains(kind), projectGeneration >= 0 else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-artifact")
    }
    try ensureCapacity(expected, account: identity.account, project: identity.project,
      projectGeneration: projectGeneration, excluding: excluding)
    let id = "vx-\(kind)-\(UUID().uuidString.lowercased())"
    let folder = projectCache(identity).appendingPathComponent(id, isDirectory: true)
    do {
      try fm.createDirectory(at: folder, withIntermediateDirectories: true)
      let value: [String: Any] = ["processGeneration": processGeneration,
        "projectGeneration": projectGeneration, "kind": kind, "created": Date().timeIntervalSince1970]
      try JSONSerialization.data(withJSONObject: value)
        .write(to: folder.appendingPathComponent(marker), options: .atomic)
      return (id, folder)
    } catch { try? fm.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
  }
  func release(_ account: String, project: String, artifactId: String) throws {
    let identity = try EditorMediaIdentity(account, project, "release", "release")
    guard validArtifactId(artifactId) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-artifact")
    }
    let root = projectCache(identity).standardizedFileURL.resolvingSymlinksInPath()
    let url = root.appendingPathComponent(artifactId, isDirectory: true)
      .standardizedFileURL.resolvingSymlinksInPath()
    guard url.lastPathComponent == artifactId, url.deletingLastPathComponent() == root, contains(root, url),
          fm.fileExists(atPath: url.appendingPathComponent(marker).path) else {
      throw EditorMediaFailure.result(.invalidInput, "unknown-artifact")
    }
    do { try fm.removeItem(at: url) }
    catch { throw EditorMediaFailure.result(.writeFailed) }
  }
  func artifactFolder(_ account: String, project: String, artifactId: String) throws -> URL {
    let identity = try EditorMediaIdentity(account, project, "artifact", "artifact")
    guard validArtifactId(artifactId) else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-artifact")
    }
    let root = projectCache(identity).standardizedFileURL.resolvingSymlinksInPath()
    let folder = root.appendingPathComponent(artifactId, isDirectory: true)
      .standardizedFileURL.resolvingSymlinksInPath()
    guard folder.lastPathComponent == artifactId, folder.deletingLastPathComponent() == root, contains(root, folder),
          fm.fileExists(atPath: folder.appendingPathComponent(marker).path),
          fm.fileExists(atPath: folder.appendingPathComponent("artifact.json").path) else {
      throw EditorMediaFailure.result(.invalidInput, "unknown-artifact")
    }
    return folder
  }
  func artifactFile(_ folder: URL, name: String) throws -> URL {
    guard !name.isEmpty, !name.contains("/"), !name.contains("\\") else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-artifact")
    }
    let root = folder.standardizedFileURL.resolvingSymlinksInPath()
    let original = root.appendingPathComponent(name)
    let originalValues = try? original.resourceValues(forKeys: [.isSymbolicLinkKey])
    let file = original.standardizedFileURL.resolvingSymlinksInPath()
    let values = try? file.resourceValues(forKeys: [.isRegularFileKey])
    guard originalValues?.isSymbolicLink != true, file.lastPathComponent == name,
          file.deletingLastPathComponent() == root, contains(root, file), values?.isRegularFile == true else {
      throw EditorMediaFailure.result(.invalidInput, "invalid-artifact")
    }
    return file
  }
  func purgeProject(account: String, project: String) {
    guard let identity = try? EditorMediaIdentity(account, project, "purge", "purge") else { return }
    try? fm.removeItem(at: projectCache(identity))
  }
  func purgeForeignAccounts(_ active: String?) {
    guard let entries = try? fm.contentsOfDirectory(at: cacheRoot, includingPropertiesForKeys: nil) else { return }
    for entry in entries where active == nil || entry.lastPathComponent != active { try? fm.removeItem(at: entry) }
  }
  func cleanupOnce(excluding: Set<String>) {
    let root = cacheRoot.standardizedFileURL.resolvingSymlinksInPath()
    guard let accounts = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
    for account in accounts {
      let accountValues = try? account.resourceValues(forKeys: [.isSymbolicLinkKey])
      let resolvedAccount = account.standardizedFileURL.resolvingSymlinksInPath()
      guard accountValues?.isSymbolicLink != true, resolvedAccount.deletingLastPathComponent() == root,
            let projects = try? fm.contentsOfDirectory(at: resolvedAccount, includingPropertiesForKeys: nil) else { continue }
      for project in projects {
        let projectValues = try? project.resourceValues(forKeys: [.isSymbolicLinkKey])
        let resolvedProject = project.standardizedFileURL.resolvingSymlinksInPath()
        guard projectValues?.isSymbolicLink != true,
              resolvedProject.deletingLastPathComponent() == resolvedAccount,
              let entries = try? fm.contentsOfDirectory(at: resolvedProject, includingPropertiesForKeys: nil) else { continue }
        for entry in entries {
          let entryValues = try? entry.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
          let resolved = entry.standardizedFileURL.resolvingSymlinksInPath()
          guard entryValues?.isSymbolicLink != true, resolved.deletingLastPathComponent() == resolvedProject,
                contains(root, resolved), !excluding.contains(resolved.path) else { continue }
          if entry.lastPathComponent.hasPrefix("vx-batch-") {
            try? fm.removeItem(at: resolved); continue
          }
          if entry.lastPathComponent.hasPrefix("vx-frame-"), entryValues?.isRegularFile == true {
            try? fm.removeItem(at: resolved); continue
          }
          guard validArtifactId(entry.lastPathComponent),
                !fm.fileExists(atPath: resolved.appendingPathComponent("artifact.json").path) else { continue }
          try? fm.removeItem(at: resolved)
        }
      }
    }
  }
  func ensureCapacity(_ expected: Int, account: String, project: String,
                      projectGeneration: Int, excluding: Set<String> = []) throws {
    try? fm.createDirectory(at: cacheRoot, withIntermediateDirectories: true)
    var used = cacheBytes()
    if used + Int64(expected) > Int64(Self.quota) {
      for candidate in evictableArtifacts(account: account, project: project,
        projectGeneration: projectGeneration).filter({ !excluding.contains($0.url.path) }) {
        try? fm.removeItem(at: candidate.url); used = cacheBytes()
        if used + Int64(expected) <= Int64(Self.quota) { break }
      }
    }
    let available = (try? cacheRoot.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage) ?? Int64.max
    guard used + Int64(expected) <= Int64(Self.quota), available >= Int64(expected + 16 * 1024 * 1024) else {
      throw EditorMediaFailure.result(.diskFull)
    }
  }
  func ensureHardQuota() throws {
    let used = cacheBytes()
    let available = (try? cacheRoot.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage) ?? Int64.max
    guard used <= Int64(Self.quota), available >= Int64(16 * 1024 * 1024) else {
      throw EditorMediaFailure.result(.diskFull)
    }
  }
  func markComplete(_ folder: URL, bytes: Int, limit: Int, kind: String,
                    projectGeneration: Int) throws {
    guard bytes > 0, bytes <= limit else {
      try? fm.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed, "artifact-too-large")
    }
    do {
      let record: [String: Any] = ["bytes": bytes, "completed": Date().timeIntervalSince1970,
        "processGeneration": processGeneration, "projectGeneration": projectGeneration, "kind": kind]
      try JSONSerialization.data(withJSONObject: record)
        .write(to: folder.appendingPathComponent("artifact.json"), options: .atomic)
    } catch { try? fm.removeItem(at: folder); throw EditorMediaFailure.result(.writeFailed) }
  }
  private func contains(_ root: URL, _ child: URL) -> Bool {
    let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
    return child.path.hasPrefix(prefix)
  }
  private func cacheBytes() -> Int64 {
    guard let enumerator = fm.enumerator(at: cacheRoot, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]) else { return 0 }
    var result: Int64 = 0
    for case let url as URL in enumerator {
      let value = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      if value?.isRegularFile == true { result += Int64(value?.fileSize ?? 0) }
    }
    return result
  }
  private func evictableArtifacts(account currentAccount: String, project currentProject: String,
                                  projectGeneration: Int) -> [(url: URL, date: Date)] {
    guard let accounts = try? fm.contentsOfDirectory(at: cacheRoot, includingPropertiesForKeys: nil) else { return [] }
    var found: [(url: URL, date: Date)] = []
    for account in accounts {
      guard let projects = try? fm.contentsOfDirectory(at: account, includingPropertiesForKeys: nil) else { continue }
      for project in projects {
        guard let artifacts = try? fm.contentsOfDirectory(at: project, includingPropertiesForKeys: [.contentModificationDateKey]) else { continue }
        for artifact in artifacts where validArtifactId(artifact.lastPathComponent)
          && fm.fileExists(atPath: artifact.appendingPathComponent(marker).path)
          && fm.fileExists(atPath: artifact.appendingPathComponent("artifact.json").path) {
          let values = try? artifact.resourceValues(forKeys: [.isSymbolicLinkKey])
          guard values?.isSymbolicLink != true else { continue }
          let manifest = artifact.appendingPathComponent("artifact.json")
          let markerURL = artifact.appendingPathComponent(marker)
          guard let data = try? Data(contentsOf: manifest),
                let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let markerData = try? Data(contentsOf: markerURL),
                let markerValue = try? JSONSerialization.jsonObject(with: markerData) as? [String: Any],
                let artifactProcess = value["processGeneration"] as? String,
                let artifactGeneration = value["projectGeneration"] as? Int,
                markerValue["processGeneration"] as? String == artifactProcess,
                markerValue["projectGeneration"] as? Int == artifactGeneration,
                markerValue["kind"] as? String == value["kind"] as? String else { continue }
          let isOlderProcess = artifactProcess != processGeneration
          let isOlderProjectGeneration = account.lastPathComponent == currentAccount
            && project.lastPathComponent == currentProject && artifactGeneration < projectGeneration
          guard isOlderProcess || isOlderProjectGeneration else { continue }
          let date = (try? artifact.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
          found.append((artifact, date))
        }
      }
    }
    return found.sorted { $0.date < $1.date }
  }
  private func validArtifactId(_ value: String) -> Bool {
    for kind in ["frames", "pcm", "mp4"] {
      let prefix = "vx-\(kind)-"
      if value.hasPrefix(prefix), UUID(uuidString: String(value.dropFirst(prefix.count))) != nil { return true }
    }
    return false
  }
}
