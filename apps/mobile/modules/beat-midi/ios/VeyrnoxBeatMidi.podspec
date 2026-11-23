Pod::Spec.new do |s|
  s.name = 'VeyrnoxBeatMidi'
  s.version = '1.0.0'
  s.summary = 'External CoreMIDI input for Veyrnox Beats'
  s.description = s.summary
  s.homepage = 'https://veyrnox.ai'
  s.license = { :type => 'Proprietary' }
  s.author = 'Veyrnox'
  s.source = { :git => 'https://github.com/VEYRNOX/veyrnox.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMIDI'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
