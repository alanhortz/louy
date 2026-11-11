// Lit le bandeau incrusté en haut des images de caméras (« A015_SPY_061.400_(+) »)
// avec l'OCR du système (Vision, macOS). Appelé par harvest-cameras.mjs.
//
//   swift scripts/read-stamps.swift image1.jpg image2.jpg …
//
// Sortie : une ligne « chemin <tab> texte lu » par image.

import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("\(path)\t"); continue }
    // le bandeau occupe le haut de l'image : 8 % de sa hauteur, quelle que soit sa définition
    let height = max(34, Int(Double(cg.height) * 0.08))
    let strip = cg.cropping(to: CGRect(x: 0, y: 0, width: cg.width, height: min(cg.height, height))) ?? cg
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: strip, options: [:]).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    print("\(path)\t\(text)")
}
