import CoreMIDI
import ExpoModulesCore
import Foundation

private let beatMidiReadProc: MIDIReadProc = { packets, refCon, _ in
  guard let refCon else { return }
  Unmanaged<BeatMidiManager>.fromOpaque(refCon).takeUnretainedValue().receive(packets)
}

public final class VeyrnoxBeatMidiModule: Module {
  private let manager = BeatMidiManager()

  public func definition() -> ModuleDefinition {
    Name("VeyrnoxBeatMidi")
    Events("devices", "message", "status")
    OnCreate { manager.start { [weak self] event, payload in self?.sendEvent(event, payload) } }
    OnDestroy { manager.stop() }
    AsyncFunction("requestAccess") { () -> [String: Any] in
      ["permission": "granted", "devices": manager.devices()]
    }
    AsyncFunction("connect") { (deviceId: String) in try manager.connect(deviceId) }
    AsyncFunction("disconnect") { manager.disconnect() }
  }
}

private final class BeatMidiManager {
  typealias Emitter = (String, [String: Any?]) -> Void
  // CoreMIDI invokes notifications and packet callbacks on its own threads, while Expo calls
  // connect/disconnect/stop on the module queue. Keep every mutable handle and emitter on one
  // serial queue so hot-unplug and teardown cannot race packet delivery.
  private let stateQueue = DispatchQueue(label: "ai.veyrnox.beat-midi.state")
  private var client = MIDIClientRef(), input = MIDIPortRef(), source = MIDIEndpointRef()
  private var sourceId: String?, emit: Emitter?

  func start(emit: @escaping Emitter) {
    stateQueue.sync {
      self.emit = emit
      guard MIDIClientCreateWithBlock("VeyrnoxBeatMidi" as CFString, &client, { [weak self] _ in self?.refresh() }) == noErr else {
        emit("status", ["connectedId": nil, "error": "midi_client_unavailable"]); return
      }
      let opaque = Unmanaged.passUnretained(self).toOpaque()
      guard MIDIInputPortCreate(client, "VeyrnoxBeatMidiInput" as CFString, beatMidiReadProc, opaque, &input) == noErr else {
        emit("status", ["connectedId": nil, "error": "midi_input_unavailable"]); return
      }
      refreshLocked()
    }
  }

  func stop() {
    stateQueue.sync {
      disconnectLocked()
      if input != 0 { MIDIPortDispose(input); input = 0 }
      if client != 0 { MIDIClientDispose(client); client = 0 }
      emit = nil
    }
  }

  func devices() -> [[String: Any]] {
    stateQueue.sync { deviceList() }
  }

  private func deviceList() -> [[String: Any]] {
    (0..<MIDIGetNumberOfSources()).compactMap { index in
      let endpoint = MIDIGetSource(index); guard endpoint != 0 else { return nil }
      return ["id": id(endpoint), "name": stringProperty(endpoint, kMIDIPropertyDisplayName) ?? "MIDI \(index + 1)",
              "manufacturer": stringProperty(endpoint, kMIDIPropertyManufacturer) ?? "", "connected": true]
    }
  }

  func connect(_ deviceId: String) throws {
    try stateQueue.sync {
      disconnectLocked()
      guard input != 0 else { throw MidiFailure("midi_input_unavailable") }
      for index in 0..<MIDIGetNumberOfSources() {
        let endpoint = MIDIGetSource(index)
        if id(endpoint) == deviceId {
          guard MIDIPortConnectSource(input, endpoint, nil) == noErr else { throw MidiFailure("midi_connect_failed") }
          source = endpoint; sourceId = deviceId
          emit?("status", ["connectedId": deviceId, "error": nil]); refreshLocked(); return
        }
      }
      throw MidiFailure("midi_device_unavailable")
    }
  }

  func disconnect() {
    stateQueue.sync { disconnectLocked() }
  }

  private func disconnectLocked() {
    if input != 0 && source != 0 { MIDIPortDisconnectSource(input, source) }
    source = 0; sourceId = nil
    emit?("status", ["connectedId": nil, "error": nil])
  }

  func receive(_ packets: UnsafePointer<MIDIPacketList>) {
    // unsafeSequence keeps each packet pointer inside CoreMIDI's original list allocation. Copying
    // list.packet and calling MIDIPacketNext on that stack copy reads later packets out of bounds.
    let messages = packets.unsafeSequence().compactMap { packet -> [UInt8]? in
      let bytes = Array(packet.bytes()); return bytes.isEmpty ? nil : bytes
    }
    guard !messages.isEmpty else { return }
    stateQueue.async { [weak self] in
      guard let self, let emit = self.emit else { return }
      for bytes in messages { emit("message", ["bytes": bytes, "receivedAtMs": ProcessInfo.processInfo.systemUptime * 1000]) }
    }
  }

  private func refresh() {
    stateQueue.async { [weak self] in self?.refreshLocked() }
  }

  private func refreshLocked() {
    let found = deviceList()
    if let selected = sourceId, !found.contains(where: { $0["id"] as? String == selected }) { disconnectLocked() }
    emit?("devices", ["devices": found, "connectedId": sourceId])
  }

  private func id(_ endpoint: MIDIObjectRef) -> String {
    var value: Int32 = 0
    MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &value)
    return String(value)
  }

  private func stringProperty(_ endpoint: MIDIObjectRef, _ property: CFString) -> String? {
    var value: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(endpoint, property, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
  }
}

private struct MidiFailure: LocalizedError {
  let code: String
  init(_ code: String) { self.code = code }
  var errorDescription: String? { code }
}
