package ai.veyrnox.vision

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import java.nio.ByteOrder
import kotlin.math.floor

internal class VisionEngine {
  private var face: FaceLandmarker? = null
  private var segmenter: ImageSegmenter? = null
  fun initialize(context: Context) {
    if (face != null && segmenter != null) return
    fun base(name: String) = BaseOptions.builder().setModelAssetPath("veyrnox-vision/$name")
      .setDelegate(Delegate.CPU).build()
    val newFace = FaceLandmarker.createFromOptions(context, FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(base("face_landmarker.task")).setRunningMode(RunningMode.IMAGE).setNumFaces(2)
      .setOutputFaceBlendshapes(false).setOutputFacialTransformationMatrixes(false).build())
    var newSegmenter: ImageSegmenter? = null
    try {
      newSegmenter = ImageSegmenter.createFromOptions(context, ImageSegmenter.ImageSegmenterOptions.builder()
        .setBaseOptions(base("selfie_multiclass_256x256.tflite")).setRunningMode(RunningMode.IMAGE)
        .setOutputConfidenceMasks(true).setOutputCategoryMask(false).build())
      check(newSegmenter.labels == listOf("background", "hair", "body-skin", "face-skin", "clothes", "others"))
      face = newFace; segmenter = newSegmenter
    } catch (error: Exception) {
      newSegmenter?.close(); newFace.close(); throw error
    }
  }
  fun detect(op: String, jpeg: String, width: Int, height: Int): Map<String, Any?> {
    check(op in listOf("detect", "swapDetect") && width in 8..384 && height in 8..384)
    check(jpeg.length <= 900_000 && jpeg.startsWith("data:image/jpeg;base64,"))
    val bytes = Base64.decode(jpeg.substring(23), Base64.DEFAULT)
    check(bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte())
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    check(bounds.outWidth == width && bounds.outHeight == height)
    val bitmap = checkNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
    try {
      val input = BitmapImageBuilder(bitmap).build()
      try {
        val faces = checkNotNull(face).detect(input).faceLandmarks()
        val count = minOf(2, faces.size)
        val result = mutableMapOf<String, Any?>("count" to count, "landmarks" to emptyList<Float>(),
          "width" to width, "height" to height)
        if (count != 1) {
          if (op == "detect") result["hair"] = null
          return result
        }
        val landmarks = faces[0].flatMap { listOf(it.x(), it.y(), it.z()) }
        check(landmarks.size == 1434 && landmarks.all { it.isFinite() && kotlin.math.abs(it) <= 2 })
        result["landmarks"] = landmarks
        val segmentation = checkNotNull(segmenter).segment(input)
        val masks = segmentation.confidenceMasks().orElse(emptyList())
        try {
          check(masks.size == 6)
          if (op == "detect") {
            val mask = masks[1]
            result["width"] = mask.width; result["height"] = mask.height
            result["hair"] = quantize(mask, mask.width, mask.height).map { it.toInt() and 255 }
          } else {
            for ((key, index) in listOf("background" to 0, "body" to 2, "face" to 3)) {
              result[key] = Base64.encodeToString(quantize(masks[index], width, height), Base64.NO_WRAP)
            }
          }
          return result
        } finally {
          masks.forEach { it.close() }
          segmentation.categoryMask().ifPresent { it.close() }
        }
      } finally { input.close() }
    } finally { bitmap.recycle() }
  }
  private fun quantize(mask: MPImage, width: Int, height: Int): ByteArray {
    check(mask.width in 8..512 && mask.height in 8..512)
    val values = ByteBufferExtractor.extract(mask).order(ByteOrder.nativeOrder()).asFloatBuffer()
    check(values.remaining() == mask.width * mask.height)
    for (i in 0 until values.limit()) check(values[i].isFinite() && values[i] in 0f..1f)
    return ByteArray(width * height) { i ->
      val x = minOf(mask.width - 1, floor((i % width + 0.5) * mask.width / width).toInt())
      val y = minOf(mask.height - 1, floor((i / width + 0.5) * mask.height / height).toInt())
      floor(values[y * mask.width + x].toDouble() * 255 + 0.5).toInt().toByte()
    }
  }
}
