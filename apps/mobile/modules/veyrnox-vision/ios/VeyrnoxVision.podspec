Pod::Spec.new do |s|
  s.name = 'VeyrnoxVision'
  s.version = '1.0.0'
  s.summary = 'On-device still-photo vision for Veyrnox'
  s.description = s.summary
  s.homepage = 'https://veyrnox.ai'
  s.license = { :type => 'Proprietary' }
  s.author = 'Veyrnox'
  s.source = { :git => 'https://github.com/VEYRNOX/veyrnox.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '1.0.1'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'VeyrnoxVisionModels' => ['Models/*'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
