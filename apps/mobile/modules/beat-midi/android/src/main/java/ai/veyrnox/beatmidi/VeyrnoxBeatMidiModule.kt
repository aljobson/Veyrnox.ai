package ai.veyrnox.beatmidi

import android.content.Context
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiDeviceStatus
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException

class VeyrnoxBeatMidiModule : Module() {
  private var midi: MidiManager? = null
  private var device: MidiDevice? = null
  private var output: MidiOutputPort? = null
  private var connectedId: String? = null
  private val handler = Handler(Looper.getMainLooper())
  private val callback = object : MidiManager.DeviceCallback() {
    override fun onDeviceAdded(info: MidiDeviceInfo) = emitDevices()
    override fun onDeviceRemoved(info: MidiDeviceInfo) {
      if (connectedId == info.id.toString()) disconnect()
      emitDevices()
    }
    override fun onDeviceStatusChanged(status: MidiDeviceStatus) = emitDevices()
  }
  private val receiver = object : MidiReceiver() {
    override fun onSend(data: ByteArray, offset: Int, count: Int, timestamp: Long) {
      if (count <= 0 || offset < 0 || offset + count > data.size) return
      // Preserve the native callback's byte stream. Running status, realtime bytes and messages
      // split across callbacks are framed by the shared stateful parser on the JS side.
      val bytes = (offset until offset + count).map { data[it].toInt() and 255 }
      sendEvent("message", mapOf("bytes" to bytes,
        "receivedAtMs" to if (timestamp > 0) timestamp / 1_000_000.0 else System.nanoTime() / 1_000_000.0))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("VeyrnoxBeatMidi")
    Events("devices", "message", "status")
    OnCreate {
      midi = appContext.reactContext?.getSystemService(Context.MIDI_SERVICE) as? MidiManager
      midi?.registerDeviceCallback(callback, handler)
      emitDevices()
    }
    OnDestroy {
      midi?.unregisterDeviceCallback(callback); disconnect(); midi = null
    }
    AsyncFunction("requestAccess") {
      mapOf("permission" to if (midi == null) "unavailable" else "granted", "devices" to devices())
    }
    AsyncFunction("connect") { id: String, promise: Promise -> connect(id, promise) }
    AsyncFunction("disconnect") { disconnect() }
  }

  private fun devices(): List<Map<String, Any>> = midi?.devices?.filter { it.outputPortCount > 0 }?.map {
    val properties = it.properties
    mapOf("id" to it.id.toString(), "name" to (properties.getString(MidiDeviceInfo.PROPERTY_NAME) ?: "MIDI ${it.id}"),
      "manufacturer" to (properties.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER) ?: ""), "connected" to true)
  } ?: emptyList()

  private fun connect(id: String, promise: Promise) {
    disconnect()
    val manager = midi ?: return promise.reject("midi_unavailable", "MIDI is unavailable", null)
    val info = manager.devices.firstOrNull { it.id.toString() == id && it.outputPortCount > 0 }
      ?: return promise.reject("midi_device_unavailable", "MIDI device is unavailable", null)
    manager.openDevice(info, { opened ->
      if (opened == null) { promise.reject("midi_connect_failed", "MIDI device could not be opened", null); return@openDevice }
      val portIndex = info.ports.firstOrNull { it.type == MidiDeviceInfo.PortInfo.TYPE_OUTPUT }?.portNumber
      val openedPort = portIndex?.let { opened.openOutputPort(it) }
      if (openedPort == null) { opened.close(); promise.reject("midi_connect_failed", "MIDI output could not be opened", null); return@openDevice }
      openedPort.connect(receiver); device = opened; output = openedPort; connectedId = id
      sendEvent("status", mapOf("connectedId" to id, "error" to null)); emitDevices(); promise.resolve(null)
    }, handler)
  }

  private fun disconnect() {
    try { output?.disconnect(receiver) } catch (_: IOException) {}
    try { output?.close() } catch (_: IOException) {}
    try { device?.close() } catch (_: IOException) {}
    output = null; device = null; connectedId = null
    sendEvent("status", mapOf("connectedId" to null, "error" to null))
  }

  private fun emitDevices() { sendEvent("devices", mapOf("devices" to devices(), "connectedId" to connectedId)) }
}
