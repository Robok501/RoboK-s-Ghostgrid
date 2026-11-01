import ExpoModulesCore
import UIKit
import CoreAudioKit

/// Bridge between JavaScript and the native engine. Implements the engine interface from the architecture memo (§5).
public class GhostgridEngineModule: Module {
  private let engine = GGEngine()
  private let stems = GGStems()
  private let stemPlayer = GGStemPlayer()
  private let stemQueue = DispatchQueue(label: "ghostgrid.separate", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("GhostgridEngine")

    Events("onPadHit", "onControl", "onMidiSources", "onCaptureHit", "onMicLevel", "onRouteChange", "onStemsProgress")

    OnCreate {
      self.engine.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      self.engine.setupMidi()
      self.stems.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
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

    Function("scheduleDrum") { (time: Double, sound: Int, gain: Double) in
      self.engine.scheduleDrum(time: time, sound: sound, gain: gain)
    }

    Function("cancelAfter") { (time: Double) in
      self.engine.cancelAfter(time: time)
    }

    Function("setClickSound") { (name: String) in
      self.engine.setClickSound(name)
    }

    /// Convert a touch timestamp (seconds since boot) to engine time, for the on-screen tap pad.
    Function("uptimeToEngine") { (uptime: Double) -> Double in
      return self.engine.uptimeToEngine(uptime)
    }

    Function("startRecording") { () -> Bool in
      return self.engine.startRecording()
    }

    Function("stopRecording") { () -> [String: Any] in
      return self.engine.stopRecording()
    }

    // MARK: stems (song separation and practice player)

    Function("stemsModelStatus") { (name: String) -> [String: Any] in
      return self.stems.modelStatus(name)
    }

    AsyncFunction("stemsDownloadModel") { (url: String, name: String, promise: Promise) in
      self.stems.downloadModel(from: url, name: name) { result in
        switch result {
        case .success: promise.resolve(self.stems.modelStatus(name))
        case .failure(let e): promise.reject("E_DOWNLOAD", e.localizedDescription)
        }
      }
    }

    Function("stemsCancelDownload") {
      self.stems.cancelDownload()
    }

    Function("stemsDeleteModel") { (name: String) in
      self.stems.deleteModel(name)
    }

    /// Separate a song file into drums.caf and nodrums.caf in `outDir` (file paths, not URLs). Resolves with the duration.
    AsyncFunction("stemsSeparate") { (input: String, outDir: String, model: String, promise: Promise) in
      self.stemQueue.async {
        do {
          let d = try self.stems.separate(input: URL(fileURLWithPath: input), outDir: URL(fileURLWithPath: outDir), modelName: model)
          promise.resolve(d)
        } catch {
          promise.reject("E_SEPARATE", error.localizedDescription)
        }
      }
    }

    /// Where the last separation got to (phase, free memory). A phase other than done/error means iOS stopped the app.
    Function("stemsLastRun") { () -> [String: Any] in
      return self.stems.lastRun()
    }

    Function("stemsFreeMemoryMB") { () -> Double in
      return GGStems.freeMB()
    }

    Function("stemsCancel") {
      self.stems.cancel()
    }

    AsyncFunction("stemsLoad") { (drums: String?, rest: String) -> Double in
      return try self.stemPlayer.load(drumsPath: drums, restPath: rest)
    }
    Function("stemsUnload") { self.stemPlayer.unload() }
    Function("stemsPlay") { try self.stemPlayer.play() }
    Function("stemsPause") { self.stemPlayer.pause() }
    Function("stemsSeek") { (t: Double) in try self.stemPlayer.seek(t) }
    Function("stemsPosition") { () -> Double in self.stemPlayer.position() }
    Function("stemsIsPlaying") { () -> Bool in self.stemPlayer.isPlaying() }
    Function("stemsSetVolumes") { (drums: Double, rest: Double) in self.stemPlayer.setVolumes(drums: drums, rest: rest) }
    Function("stemsSetRate") { (r: Double) in self.stemPlayer.setRate(r) }
    Function("stemsSetLoop") { (a: Double, b: Double, on: Bool) in try self.stemPlayer.setLoop(a: a, b: b, on: on) }

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
