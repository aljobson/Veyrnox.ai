import ExpoModulesCore

public final class VeyrnoxEditorMediaModule: Module {
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
  }

  private func progress(_ account: String, _ project: String, _ owner: String, _ token: String)
    -> EditorMediaWorker.Progress {
    { [weak self] stage, value in
      self?.sendEvent("progress", ["account": account, "project": project, "owner": owner,
        "token": token, "stage": stage, "value": value])
    }
  }
}
