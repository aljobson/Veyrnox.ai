package ai.veyrnox.vision

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

// One running inference and at most one replacement, shared across React owners.
private object VisionWorker {
  private val lock = Any()
  private val executor = Executors.newSingleThreadExecutor()
  private val engine = VisionEngine()
  private var initialized = false
  private var initializing = false
  private val waiters = mutableListOf<Promise>()
  private data class Job(val token: String, val op: String, val jpeg: String, val width: Int,
    val height: Int, val promise: Promise, val admitted: () -> Unit, var cancelled: Boolean = false)
  private var running: Job? = null
  private var queued: Job? = null
  fun initialize(context: Context?, promise: Promise) {
    synchronized(lock) {
      if (initialized) { promise.resolve(null); return }
      if (context == null) { promise.reject("inference-unavailable", "inference-unavailable", null); return }
      waiters.add(promise)
      if (initializing) return
      initializing = true
    }
    executor.execute {
      val success = try { engine.initialize(checkNotNull(context).applicationContext); true } catch (_: Exception) { false }
      val waiting = synchronized(lock) {
        initialized = success; initializing = false
        waiters.toList().also { waiters.clear() }
      }
      waiting.forEach {
        if (success) it.resolve(null) else it.reject("inference-unavailable", "inference-unavailable", null)
      }
    }
  }
  fun submit(token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise, admitted: () -> Unit) {
    val job = Job(token, op, jpeg, width, height, promise, admitted)
    synchronized(lock) {
      if (!initialized || token.length > 100 || jpeg.length > 900_000) {
        promise.resolve(mapOf("error" to "inference-unavailable")); return
      }
      if (running != null) {
        queued?.promise?.resolve(mapOf("cancelled" to true)); queued = job; return
      }
      running = job
    }
    execute(job)
  }
  fun cancel(token: String) {
    synchronized(lock) {
      running?.takeIf { it.token == token }?.cancelled = true
      if (queued?.token == token) {
        queued?.promise?.resolve(mapOf("cancelled" to true)); queued = null
      }
    }
  }
  private fun execute(job: Job) {
    executor.execute {
      var result: Map<String, Any?> = mapOf("cancelled" to true)
      if (!synchronized(lock) { job.cancelled }) {
        result = try {
          job.admitted()
          engine.detect(job.op, job.jpeg, job.width, job.height)
        } catch (_: Exception) { mapOf("error" to "inference-unavailable") }
      }
      val next = synchronized(lock) {
        if (job.cancelled) result = mapOf("cancelled" to true)
        val next = queued; queued = null; running = next; next
      }
      job.promise.resolve(result)
      if (next != null) execute(next)
    }
  }
}
class VeyrnoxVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeyrnoxVision")
    Events("admitted")
    AsyncFunction("init") { promise: Promise -> VisionWorker.initialize(appContext.reactContext, promise) }
    AsyncFunction("detect") { token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise ->
      VisionWorker.submit(token, op, jpeg, width, height, promise) { sendEvent("admitted", mapOf("token" to token)) }
    }
    Function("cancel") { token: String -> VisionWorker.cancel(token) }
  }
}
