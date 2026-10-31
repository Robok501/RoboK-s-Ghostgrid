import ExpoModulesCore
import UIKit
import CoreAudioKit

/// Bridge between JavaScript and the native engine. Implements the engine interface from the architecture memo (§5).
public class GhostgridEngineModule: Module {
  private let engine = GGEngine()

  public func definition() -> ModuleDefinition {
    Name("GhostgridEngine")

    Events("onPadHit", "onControl", "onMidiSources", "onCaptureHit", "onMicLevel", "onRouteChange")

    OnCreate {
      self.engine.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      self.engine.setupMidi()
    }

    OnDestroy {
      self.engine.stop()
    }

    /// Start (or restart) the audio session and engine. Returns sample rate, latencies and the current route.
    AsyncFunction("start") { (keepBluetoothOutput: Bool, mic: Bool, sensitivity: Double) -> [String: Any] in
      return try self.engine.start(keepBluetoothOutput: keepBluetoothOutput, mic: mic, sensitivity: sensitivity)
    }

    AsyncFunction("stop") {
      self.engine.stop()
    }

    AsyncFunction("requestMicPermission") { (promise: Promise) in
      GGEngine.requestMicPermission { granted in promise.resolve(granted) }
    }

    /// Engine clock in seconds (frames rendered / sample rate).
    Function("now") { () -> Double in
      return self.engine.now()
    }

    Function("scheduleClick") { (time: Double, level: Int) in
      self.engine.scheduleClick(time: time, level: level)
    }

    Function("cancelAfter") { (time: Double) in
      self.engine.cancelAfter(time: time)
    }

    Function("info") { () -> [String: Any] in
      return self.engine.info()
    }

    Function("midiSources") { () -> [String] in
      return self.engine.sourceNames
    }

    /// Apple's own Bluetooth MIDI pairing screen (finds e-drums such as a Roland TD-27).
    AsyncFunction("showBluetoothMidi") {
      guard let root = self.appContext?.utilities?.currentViewController() else { return }
      let picker = CABTMIDICentralViewController()
      let nav = UINavigationController(rootViewController: picker)
      picker.navigationItem.rightBarButtonItem = UIBarButtonItem(
        systemItem: .done,
        primaryAction: UIAction { _ in nav.dismiss(animated: true) }
      )
      root.present(nav, animated: true)
    }.runOnQueue(.main)
  }
}
