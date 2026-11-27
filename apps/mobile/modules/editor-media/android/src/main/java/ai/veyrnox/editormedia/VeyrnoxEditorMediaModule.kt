package ai.veyrnox.editormedia

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Honest Android surface for the S9 iOS-first media foundation.
 *
 * Keep this API in lockstep with the Apple module. Android never touches a
 * path, creates an artifact, or asks for a permission: media work returns the
 * same stable refusal on every device until the named Kotlin implementation
 * is built and qualified.
 */
class VeyrnoxEditorMediaModule : Module() {
  private fun unsupported(): Map<String, Any?> = mapOf(
    "ok" to false,
    "code" to "unsupported-platform"
  )

  override fun definition() = ModuleDefinition {
    Name("VeyrnoxEditorMedia")
    Events("progress")

    AsyncFunction("capabilities") { promise: Promise ->
      promise.resolve(mapOf(
        "ok" to true,
        "available" to false,
        "platform" to "android",
        "protocolVersion" to 1,
        "reason" to "unsupported-platform",
        "operations" to mapOf(
          "inspect" to false,
          "sampleFrames" to false,
          "decodePcm" to false,
          "beginEncode" to false,
          "appendFrameBatch" to false,
          "finishEncode" to false,
          "cancel" to false,
          "cancelProject" to false,
          "release" to false
        )
      ))
    }

    // Lifecycle calls are idempotent no-ops. They create no Android state.
    AsyncFunction("setOwner") { _: String?, _: String, _: Int, promise: Promise -> promise.resolve(null) }
    AsyncFunction("setProjectGeneration") { _: String, _: String, _: Int, promise: Promise -> promise.resolve(null) }

    AsyncFunction("inspect") {
        _: String, _: String, _: String, _: String, _: String, promise: Promise ->
      promise.resolve(unsupported())
    }
    AsyncFunction("sampleFrames") {
        _: String, _: String, _: String, _: String, _: Map<String, Any?>, promise: Promise ->
      promise.resolve(unsupported())
    }
    AsyncFunction("decodePcm") {
        _: String, _: String, _: String, _: String, _: Map<String, Any?>, promise: Promise ->
      promise.resolve(unsupported())
    }
    AsyncFunction("beginEncode") {
        _: String, _: String, _: String, _: String, _: Map<String, Any?>, promise: Promise ->
      promise.resolve(unsupported())
    }
    AsyncFunction("appendFrameBatch") {
        _: String, _: String, _: String, _: String, _: String, _: List<Map<String, Any?>>, promise: Promise ->
      promise.resolve(unsupported())
    }
    AsyncFunction("finishEncode") {
        _: String, _: String, _: String, _: String, _: String, _: String?, promise: Promise ->
      promise.resolve(unsupported())
    }

    // No worker exists on Android, so cancellation cannot have a side effect.
    Function("cancel") { _: String, _: String, _: String, _: String -> Unit }
    AsyncFunction("cancelProject") { _: String, _: String, promise: Promise -> promise.resolve(null) }
    AsyncFunction("release") { _: String, _: String, _: String, promise: Promise -> promise.resolve(null) }
    AsyncFunction("share") { _: String, _: String, promise: Promise -> promise.resolve(unsupported()) }
  }
}
