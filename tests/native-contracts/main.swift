import Foundation

struct AudioFixture: Decodable {
  struct Case: Decodable { let name: String, channels: [[Float]], expected: [[Float]] }
  let cases: [Case]
}
struct MaskFixture: Decodable {
  struct Case: Decodable { let name: String, rgba: [UInt8], hasAlpha: Bool, expected: UInt8 }
  let cases: [Case]
}
enum ContractFailure: Error { case invalid(String) }

let decoder = JSONDecoder(), arguments = CommandLine.arguments
guard arguments.count == 3 else { throw ContractFailure.invalid("expected audio and mask fixture paths") }
let audio = try decoder.decode(AudioFixture.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[1])))
for fixture in audio.cases {
  var samples = fixture.channels.flatMap { $0 }
  EditorAudioOutputContract.peakNormalize(&samples)
  let expected = fixture.expected.flatMap { $0 }
  guard samples.count == expected.count, zip(samples, expected).allSatisfy({ abs($0 - $1) < 0.000_001 }) else {
    throw ContractFailure.invalid("audio: \(fixture.name)")
  }
}
let masks = try decoder.decode(MaskFixture.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[2])))
for fixture in masks.cases {
  guard fixture.rgba.count == 4 else { throw ContractFailure.invalid("mask shape: \(fixture.name)") }
  let confidence = EditorSemanticMaskContract.confidence(red: fixture.rgba[0], green: fixture.rgba[1], blue: fixture.rgba[2],
    alpha: fixture.rgba[3], hasAlpha: fixture.hasAlpha)
  guard confidence == fixture.expected else { throw ContractFailure.invalid("mask: \(fixture.name)") }
}
print("native editor contracts: \(audio.cases.count) audio, \(masks.cases.count) mask fixtures passed")
