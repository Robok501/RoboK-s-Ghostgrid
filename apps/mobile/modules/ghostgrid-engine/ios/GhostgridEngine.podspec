Pod::Spec.new do |s|
  s.name           = 'GhostgridEngine'
  s.version        = '0.1.0'
  s.summary        = 'Ghostgrid native audio engine: sample-accurate click, Bluetooth-safe audio session, CoreMIDI e-drum input, mic hit capture.'
  s.description    = s.summary
  s.author         = 'Kris Geelen'
  s.homepage       = 'https://github.com/Robok501/RoboK-s-Ghostgrid'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => 'https://github.com/Robok501/RoboK-s-Ghostgrid.git' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # on-device stem separation (HT-Demucs drums model, downloaded on first use)
  s.dependency 'onnxruntime-objc', '>= 1.20.0'
  s.frameworks = 'AVFoundation', 'CoreMIDI', 'CoreAudioKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
