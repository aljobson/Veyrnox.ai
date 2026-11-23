import ExpoModulesCore
import UIKit

public final class VeyrnoxBeatKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeyrnoxBeatKeyboard")
    View(VeyrnoxBeatKeyboardView.self) {
      Events("onKeyCommand")
      Prop("active") { (view: VeyrnoxBeatKeyboardView, active: Bool) in view.active = active }
      Prop("focusToken") { (view: VeyrnoxBeatKeyboardView, _: Int) in view.claimFocus() }
    }
  }
}

final class VeyrnoxBeatKeyboardView: ExpoView {
  let onKeyCommand = EventDispatcher()
  var active = false { didSet { if active { claimFocus() } else { resignFirstResponder() } } }

  override var canBecomeFirstResponder: Bool { active }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if active { claimFocus() }
  }

  func claimFocus() {
    guard active, window != nil else { return }
    DispatchQueue.main.async { [weak self] in _ = self?.becomeFirstResponder() }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var handled = false
    for press in presses {
      guard let key = press.key, let name = keyName(key.charactersIgnoringModifiers) else { continue }
      handled = true
      onKeyCommand([
        "key": name,
        "shift": key.modifierFlags.contains(.shift),
        "alt": key.modifierFlags.contains(.alternate),
        "control": key.modifierFlags.contains(.control),
        "meta": key.modifierFlags.contains(.command),
        "repeat": press.phase == .changed,
      ])
    }
    if !handled { super.pressesBegan(presses, with: event) }
  }

  private func keyName(_ input: String) -> String? {
    switch input {
    case UIKeyCommand.inputLeftArrow: return "ArrowLeft"
    case UIKeyCommand.inputRightArrow: return "ArrowRight"
    case UIKeyCommand.inputUpArrow: return "ArrowUp"
    case UIKeyCommand.inputDownArrow: return "ArrowDown"
    case "\r", "\n": return "Enter"
    case "\u{1b}": return "Escape"
    case "\u{8}": return "Backspace"
    case "\u{7f}": return "Delete"
    default: return input.isEmpty ? nil : input
    }
  }
}
