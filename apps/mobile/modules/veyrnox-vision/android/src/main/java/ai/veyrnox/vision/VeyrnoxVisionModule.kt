package ai.veyrnox.vision

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

// One running inference overall; at most four queued owners, one job per owner.
private object VisionWorker {
  private val lock = Any()
  private val executor = Executors.newSingleThreadExecutor()
  private val engine = VisionEngine()
  private var initialized = false
  private var initializing = false
  private val waiters = mutableListOf<Promise>()
  private data class Job(val owner: String, val token: String, val op: String, val jpeg: String, val width: Int,
    val height: Int, val promise: Promise, val admitted: () -> Unit, var cancelled: Boolean = false)
  private var running: Job? = null
  private val queued = mutableListOf<Job>()
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
  fun submit(owner: String, token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise, admitted: () -> Unit) {
    val job = Job(owner, token, op, jpeg, width, height, promise, admitted)
    synchronized(lock) {
      if (!initialized || owner.isEmpty() || owner.length > 100 || token.length > 100 || jpeg.length > 900_000) {
        promise.resolve(mapOf("error" to "inference-unavailable")); return
      }
      if (running != null) {
        val index = queued.indexOfFirst { it.owner == owner }
        if (index >= 0) {
          // Keep the owner's FIFO position when replacing its queued job.
          val old = queued.set(index, job)
          old.promise.resolve(mapOf("cancelled" to true)); return
        }
        val overflow = if (queued.size == 4) queued.removeAt(0) else null
        queued.add(job)
        overflow?.promise?.resolve(mapOf("error" to "inference-busy")); return
      }
      running = job
    }
    execute(job)
  }
  fun cancel(owner: String, token: String) {
    synchronized(lock) {
      running?.takeIf { it.owner == owner && it.token == token }?.cancelled = true
      val index = queued.indexOfFirst { it.owner == owner && it.token == token }
      if (index >= 0) {
        queued.removeAt(index).promise.resolve(mapOf("cancelled" to true))
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
        val next = if (queued.isEmpty()) null else queued.removeAt(0); running = next; next
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
    AsyncFunction("detect") { owner: String, token: String, op: String, jpeg: String, width: Int, height: Int, promise: Promise ->
      VisionWorker.submit(owner, token, op, jpeg, width, height, promise) { sendEvent("admitted", mapOf("token" to token)) }
    }
    Function("cancel") { owner: String, token: String -> VisionWorker.cancel(owner, token) }
  }
}
