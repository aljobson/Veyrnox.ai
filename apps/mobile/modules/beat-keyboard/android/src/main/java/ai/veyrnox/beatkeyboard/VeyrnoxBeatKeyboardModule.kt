package ai.veyrnox.beatkeyboard

import android.content.Context
import android.view.KeyEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class VeyrnoxBeatKeyboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeyrnoxBeatKeyboard")
    View(VeyrnoxBeatKeyboardView::class) {
      Events("onKeyCommand")
      Prop("active") { view: VeyrnoxBeatKeyboardView, active: Boolean -> view.setActive(active) }
      Prop("focusToken") { view: VeyrnoxBeatKeyboardView, _: Int -> view.claimFocus() }
    }
  }
}

class VeyrnoxBeatKeyboardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onKeyCommand by EventDispatcher()
  private var active = false

  init {
    isFocusable = true
    isFocusableInTouchMode = true
  }

  fun setActive(value: Boolean) {
    active = value
    if (value) claimFocus() else clearFocus()
  }

  fun claimFocus() {
    if (active && isAttachedToWindow) post { requestFocus() }
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    val key = when (keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
      KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
      KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
      KeyEvent.KEYCODE_ENTER -> "Enter"
      KeyEvent.KEYCODE_ESCAPE -> "Escape"
      KeyEvent.KEYCODE_DEL -> "Backspace"
      KeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
      else -> event.unicodeChar.takeIf { it != 0 }?.toChar()?.toString()
    } ?: return super.onKeyDown(keyCode, event)
    onKeyCommand(mapOf(
      "key" to key,
      "shift" to event.isShiftPressed,
      "alt" to event.isAltPressed,
      "control" to event.isCtrlPressed,
      "meta" to event.isMetaPressed,
      "repeat" to (event.repeatCount > 0),
    ))
    return true
  }
}
