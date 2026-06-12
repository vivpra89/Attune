import Vision
import Foundation
import CoreML

public struct AttuneMLResult {
    public let engagementProb: Float
    public let gazeAwayProb: Float
    public let probEngaged: Float
    public let probBored: Float
    public let probConfused: Float
    public let probFrustrated: Float
    public let probNeutral: Float
    public let dominantEmotionCode: Int32
    public let emotionConfidence: Float
    public let attentionScore: Float
    public let modelVersion: String
}

public struct AttuneInferenceStatus {
    public let modelVersion: String
    public let engagementLoaded: Bool
    public let affectLoaded: Bool
    public let gazeLoaded: Bool
    public let pretrainedGazeLoaded: Bool
    public let affectSource: String
}

private enum EmotionCode: Int32 {
    case unknown = 0
    case engaged = 1
    case bored = 2
    case confused = 3
    case frustrated = 4
}

private enum AffectSource: String {
    case hsemotion
    case landmark
    case heuristic
}

private let featureDim = 32
private let modelsSubdirectory = "models"

/// 5×8 remap: Attune classes × HSEmotion logits (Anger…Surprise).
/// Surprise maps to neutral — concentrated/neutral faces often trigger it, not confusion.
private let hsemotionRemapMatrix: [[Float]] = [
    [0, 0, 0, 0, 1, 0, 0, 0], // engaged ← Happiness
    [0, 0, 0, 0, 0, 0, 1, 0], // bored ← Sadness
    [0, 0, 0, 1, 0, 0, 0, 0], // confused ← Fear only
    [1, 1, 1, 0, 0, 0, 0, 0], // frustrated ← Anger, Contempt, Disgust
    [0, 0, 0, 0, 0, 1, 0, 1], // neutral ← Neutral, Surprise
]

private func softmax(_ logits: [Float]) -> [Float] {
    guard !logits.isEmpty else { return [] }
    let maxVal = logits.max() ?? 0
    let exps = logits.map { exp($0 - maxVal) }
    let sum = exps.reduce(0, +)
    guard sum > 0 else { return logits.map { _ in 1.0 / Float(logits.count) } }
    return exps.map { $0 / sum }
}

private func remapHsemotionProbs(_ hseProbs: [Float]) -> [Float] {
    guard hseProbs.count >= 8 else { return [0.2, 0.2, 0.2, 0.2, 0.2] }
    var attune = [Float](repeating: 0, count: 5)
    for i in 0..<5 {
        var sum: Float = 0
        for j in 0..<8 {
            sum += hsemotionRemapMatrix[i][j] * hseProbs[j]
        }
        attune[i] = sum
    }
    let total = attune.reduce(0, +)
    if total > 0 {
        attune = attune.map { $0 / total }
    }
    return attune
}

private func normalizeProbs(_ probs: [Float]) -> [Float] {
    let total = probs.reduce(0, +)
    guard total > 0 else { return probs }
    return probs.map { $0 / total }
}

/// Landmark-based smile strength in [0, 1], used to fuse with HSEmotion output.
private func landmarkSmileStrength(from observation: VNFaceObservation, eyeOpen: Float) -> Float {
    guard let landmarks = observation.landmarks,
          let outer = landmarks.outerLips,
          outer.pointCount >= 2 else {
        return 0
    }
    let pts = outer.normalizedPoints
    var minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y
    for p in pts {
        minX = min(minX, p.x)
        maxX = max(maxX, p.x)
        minY = min(minY, p.y)
        maxY = max(maxY, p.y)
    }
    let mouthWidth = Float(maxX - minX)
    let mouthHeight = Float(maxY - minY)
    let smileRatio = mouthHeight > 0.001 ? mouthWidth / mouthHeight : 1.0

    if smileRatio > 2.8 && eyeOpen > 0.45 {
        return min(1.0, 0.75 + (smileRatio - 2.8) * 0.15)
    }
    if smileRatio > 2.3 && eyeOpen > 0.40 {
        return 0.65
    }
    if smileRatio > 2.0 && eyeOpen > 0.35 {
        return 0.45
    }
    return max(0, min(0.35, (smileRatio - 1.6) / 3.0))
}

/// Blend HSEmotion probs with landmark smile and raw Happiness logit (index 4).
private func fuseSmileWithAffect(
    emotionProbs: [Float],
    hseProbs: [Float],
    smileStrength: Float
) -> [Float] {
    var probs = emotionProbs
    let happinessProb = hseProbs.count > 4 ? hseProbs[4] : 0

    if happinessProb >= 0.30 {
        probs[0] = max(probs[0], happinessProb)
    }

    if smileStrength > 0.40 {
        probs[0] = max(probs[0], smileStrength * 0.90, happinessProb)
        probs[2] *= max(0.25, 1.0 - smileStrength * 0.75)
        probs[4] *= max(0.5, 1.0 - smileStrength * 0.40)
        probs = normalizeProbs(probs)
    }

    return probs
}

private func deriveEngagement(
    probEngaged: Float,
    probBored: Float,
    gazeAwayProb: Float,
    faceQuality: Float,
    eyeOpen: Float
) -> Float {
    let raw =
        0.35 * probEngaged
        + 0.25 * (1.0 - gazeAwayProb)
        + 0.20 * (faceQuality / 100.0)
        + 0.10 * eyeOpen
        + 0.10 * (1.0 - probBored)
    return max(0, min(1, raw))
}

private func extractLandmarkFeatures(from landmarks: VNFaceLandmarks2D) -> [Float] {
    var features: [Float] = []
    let regions: [VNFaceLandmarkRegion2D?] = [
        landmarks.leftEye,
        landmarks.rightEye,
        landmarks.leftEyebrow,
        landmarks.rightEyebrow,
        landmarks.outerLips,
        landmarks.innerLips,
        landmarks.nose,
        landmarks.faceContour,
    ]

    for region in regions {
        guard let region, region.pointCount >= 2 else {
            features.append(contentsOf: [0, 0, 0, 0])
            continue
        }
        let points = region.normalizedPoints
        guard let first = points.first else {
            features.append(contentsOf: [0, 0, 0, 0])
            continue
        }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for p in points {
            minX = min(minX, p.x)
            maxX = max(maxX, p.x)
            minY = min(minY, p.y)
            maxY = max(maxY, p.y)
        }
        features.append(Float(maxX - minX))
        features.append(Float(maxY - minY))
        features.append(Float((minX + maxX) / 2))
        features.append(Float((minY + maxY) / 2))
    }
    return features
}

public final class AttuneInferenceEngine {
    public static let shared = AttuneInferenceEngine()

    private var engagementModel: MLModel?
    private var affectModel: MLModel?
    private var affectUsesImageInput = false
    private var gazePretrainedModel: MLModel?
    private var loadedVersion: String = "heuristic-v0.1"
    private var lastAffectSource: AffectSource = .heuristic

    private init() {
        let bundle = Bundle.main

        if let url =
            bundle.url(forResource: "AttuneEngagement", withExtension: "mlmodelc", subdirectory: modelsSubdirectory)
            ?? bundle.url(forResource: "AttuneEngagement", withExtension: "mlmodelc"),
           let model = try? MLModel(contentsOf: url) {
            engagementModel = model
        }

        if let url =
            bundle.url(forResource: "AttuneAffect", withExtension: "mlmodelc", subdirectory: modelsSubdirectory)
            ?? bundle.url(forResource: "AttuneAffect", withExtension: "mlmodelc"),
           let model = try? MLModel(contentsOf: url) {
            affectModel = model
            let inputNames = model.modelDescription.inputDescriptionsByName.keys
            affectUsesImageInput = inputNames.contains("face")
        }

        let gazeNames = ["AttuneGazePretrained", "AttuneGazeAway"]
        for name in gazeNames {
            let url =
                bundle.url(forResource: name, withExtension: "mlmodelc", subdirectory: modelsSubdirectory)
                ?? bundle.url(forResource: name, withExtension: "mlmodelc")
            guard let url else { continue }
            if let model = try? MLModel(contentsOf: url) {
                gazePretrainedModel = model
                if name == "AttuneGazePretrained" {
                    break
                }
            }
        }

        loadedVersion = resolveModelVersion()
    }

    private func resolveModelVersion() -> String {
        let hseLoaded = affectModel != nil && affectUsesImageInput
        let gazeLoaded = gazePretrainedModel != nil
        let engagementLoaded = engagementModel != nil

        if hseLoaded && gazeLoaded {
            return "coreml-hsemotion-v1.0"
        }
        if hseLoaded || gazeLoaded || engagementLoaded {
            return "coreml-partial-v1.0"
        }
        return "heuristic-v0.1"
    }

    public func inferenceStatus() -> AttuneInferenceStatus {
        let hseLoaded = affectModel != nil && affectUsesImageInput
        return AttuneInferenceStatus(
            modelVersion: loadedVersion,
            engagementLoaded: engagementModel != nil || hseLoaded,
            affectLoaded: affectModel != nil,
            gazeLoaded: gazePretrainedModel != nil,
            pretrainedGazeLoaded: gazePretrainedModel != nil
                && (gazePretrainedModel?.modelDescription.inputDescriptionsByName.keys.contains("image") ?? false),
            affectSource: lastAffectSource.rawValue
        )
    }

    public func infer(
        from observation: VNFaceObservation,
        pixelBuffer: CVPixelBuffer?,
        faceQuality: Float,
        eyeOpen: Float,
        headPenalty: Float
    ) -> AttuneMLResult {
        var result = runHeuristicInference(
            observation: observation,
            faceQuality: faceQuality,
            eyeOpen: eyeOpen,
            headPenalty: headPenalty
        )
        lastAffectSource = .heuristic

        if let gazeModel = gazePretrainedModel,
           let pixelBuffer,
           let pretrained = runPretrainedGaze(
               model: gazeModel,
               observation: observation,
               pixelBuffer: pixelBuffer
           ) {
            result = mergePretrainedGaze(base: result, pretrained: pretrained)
        }

        if affectUsesImageInput, let affectModel, let pixelBuffer {
            if let hseResult = runHsemotionAffect(
                model: affectModel,
                observation: observation,
                pixelBuffer: pixelBuffer,
                base: result,
                faceQuality: faceQuality,
                eyeOpen: eyeOpen
            ) {
                result = hseResult
                lastAffectSource = .hsemotion
            }
        } else if engagementModel != nil || affectModel != nil {
            result = applyLandmarkCoreML(
                base: result,
                observation: observation,
                faceQuality: faceQuality,
                eyeOpen: eyeOpen,
                headPenalty: headPenalty
            )
            if affectModel != nil {
                lastAffectSource = .landmark
            }
        }

        return result
    }

    private struct PretrainedGazeOutput {
        let gazeAwayProb: Float
        let yawNorm: Float
        let pitchNorm: Float
    }

    private func runPretrainedGaze(
        model: MLModel,
        observation: VNFaceObservation,
        pixelBuffer: CVPixelBuffer
    ) -> PretrainedGazeOutput? {
        guard let tensor = AttuneGazePreprocess.faceCropTensor(
            pixelBuffer: pixelBuffer,
            observation: observation
        ) else {
            return nil
        }
        do {
            let input = try MLDictionaryFeatureProvider(dictionary: [
                "image": MLFeatureValue(multiArray: try MLMultiArray(tensor, shape: [1, 3, 448, 448])),
            ])
            let out = try model.prediction(from: input)
            guard let gazeAway = out.featureValue(for: "gaze_away")?.doubleValue else {
                return nil
            }
            let yawNorm = Float(out.featureValue(for: "yaw_norm")?.doubleValue ?? 0)
            let pitchNorm = Float(out.featureValue(for: "pitch_norm")?.doubleValue ?? 0)
            return PretrainedGazeOutput(
                gazeAwayProb: Float(gazeAway),
                yawNorm: yawNorm,
                pitchNorm: pitchNorm
            )
        } catch {
            return nil
        }
    }

    private func mergePretrainedGaze(base: AttuneMLResult, pretrained: PretrainedGazeOutput) -> AttuneMLResult {
        buildResult(
            engagementProb: base.engagementProb,
            gazeAwayProb: pretrained.gazeAwayProb,
            emotionProbs: [
                base.probEngaged,
                base.probBored,
                base.probConfused,
                base.probFrustrated,
                base.probNeutral,
            ],
            modelVersion: loadedVersion
        )
    }

    private func runHsemotionAffect(
        model: MLModel,
        observation: VNFaceObservation,
        pixelBuffer: CVPixelBuffer,
        base: AttuneMLResult,
        faceQuality: Float,
        eyeOpen: Float
    ) -> AttuneMLResult? {
        guard let cropBuffer = AttuneFaceCrop.crop(pixelBuffer: pixelBuffer, observation: observation) else {
            return nil
        }
        do {
            let input = try MLDictionaryFeatureProvider(dictionary: [
                "face": MLFeatureValue(pixelBuffer: cropBuffer),
            ])
            let out = try model.prediction(from: input)
            guard let arr = out.featureValue(for: "emotion_logits")?.multiArrayValue else {
                return nil
            }
            var logits: [Float] = []
            for i in 0..<min(8, arr.count) {
                logits.append(Float(truncating: arr[i]))
            }
            guard logits.count == 8 else { return nil }

            let hseProbs = softmax(logits)
            let smileStrength = landmarkSmileStrength(from: observation, eyeOpen: eyeOpen)
            var emotionProbs = fuseSmileWithAffect(
                emotionProbs: remapHsemotionProbs(hseProbs),
                hseProbs: hseProbs,
                smileStrength: smileStrength
            )

            var engagementProb = deriveEngagement(
                probEngaged: emotionProbs[0],
                probBored: emotionProbs[1],
                gazeAwayProb: base.gazeAwayProb,
                faceQuality: faceQuality,
                eyeOpen: eyeOpen
            )

            if let engModel = engagementModel, let landmarks = observation.landmarks {
                let features = extractLandmarkFeatures(from: landmarks)
                if features.count == featureDim {
                    do {
                        let engInput = try MLDictionaryFeatureProvider(dictionary: [
                            "features": MLFeatureValue(multiArray: try MLMultiArray(features)),
                        ])
                        let engOut = try engModel.prediction(from: engInput)
                        if let val = engOut.featureValue(for: "engagement")?.doubleValue {
                            engagementProb = 0.5 * engagementProb + 0.5 * Float(val)
                        }
                    } catch {}
                }
            }

            return buildResult(
                engagementProb: engagementProb,
                gazeAwayProb: base.gazeAwayProb,
                emotionProbs: emotionProbs,
                modelVersion: loadedVersion
            )
        } catch {
            return nil
        }
    }

    private func applyLandmarkCoreML(
        base: AttuneMLResult,
        observation: VNFaceObservation,
        faceQuality: Float,
        eyeOpen: Float,
        headPenalty: Float
    ) -> AttuneMLResult {
        guard let landmarks = observation.landmarks else { return base }
        let features = extractLandmarkFeatures(from: landmarks)
        guard features.count == featureDim else { return base }

        var emotionProbs: [Float] = [
            base.probEngaged,
            base.probBored,
            base.probConfused,
            base.probFrustrated,
            base.probNeutral,
        ]

        if let model = affectModel, !affectUsesImageInput {
            do {
                let input = try MLDictionaryFeatureProvider(dictionary: [
                    "features": MLFeatureValue(multiArray: try MLMultiArray(features)),
                ])
                let out = try model.prediction(from: input)
                if let arr = out.featureValue(for: "emotion_probs")?.multiArrayValue {
                    var probs: [Float] = []
                    for i in 0..<min(5, arr.count) {
                        probs.append(Float(truncating: arr[i]))
                    }
                    if probs.count == 5 {
                        emotionProbs = probs
                    }
                }
            } catch {}
        }

        var engagementProb = deriveEngagement(
            probEngaged: emotionProbs[0],
            probBored: emotionProbs[1],
            gazeAwayProb: base.gazeAwayProb,
            faceQuality: faceQuality,
            eyeOpen: eyeOpen
        )

        if let model = engagementModel {
            do {
                let input = try MLDictionaryFeatureProvider(dictionary: [
                    "features": MLFeatureValue(multiArray: try MLMultiArray(features)),
                ])
                let out = try model.prediction(from: input)
                if let val = out.featureValue(for: "engagement")?.doubleValue {
                    engagementProb = 0.5 * engagementProb + 0.5 * Float(val)
                }
            } catch {}
        }

        let _ = headPenalty
        return buildResult(
            engagementProb: engagementProb,
            gazeAwayProb: base.gazeAwayProb,
            emotionProbs: emotionProbs,
            modelVersion: loadedVersion
        )
    }

    private func runHeuristicInference(
        observation: VNFaceObservation,
        faceQuality: Float,
        eyeOpen: Float,
        headPenalty: Float
    ) -> AttuneMLResult {
        let yaw = abs(observation.yaw?.doubleValue ?? 0)
        let pitch = abs(observation.pitch?.doubleValue ?? 0)

        var gazeAwayProb: Float = 0.15
        if yaw > 0.35 || pitch > 0.35 {
            gazeAwayProb = 0.85
        } else if yaw > 0.2 || pitch > 0.2 {
            gazeAwayProb = 0.55
        } else if yaw > 0.15 || pitch > 0.15 {
            gazeAwayProb = 0.50
        } else if eyeOpen < 0.3 {
            gazeAwayProb = 0.45
        }

        var mouthWidth: Float = 0.1
        var mouthHeight: Float = 0.05
        var browSpan: Float = 0.08
        if let landmarks = observation.landmarks {
            if let outer = landmarks.outerLips, outer.pointCount >= 2 {
                let pts = outer.normalizedPoints
                var minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y
                for p in pts {
                    minX = min(minX, p.x); maxX = max(maxX, p.x)
                    minY = min(minY, p.y); maxY = max(maxY, p.y)
                }
                mouthWidth = Float(maxX - minX)
                mouthHeight = Float(maxY - minY)
            }
            let leftBrow = landmarks.leftEyebrow
            let rightBrow = landmarks.rightEyebrow
            if let lb = leftBrow, let rb = rightBrow, lb.pointCount >= 2, rb.pointCount >= 2 {
                browSpan = max(
                    Float(hypot(lb.normalizedPoints.last!.x - lb.normalizedPoints.first!.x,
                                lb.normalizedPoints.last!.y - lb.normalizedPoints.first!.y)),
                    Float(hypot(rb.normalizedPoints.last!.x - rb.normalizedPoints.first!.x,
                                rb.normalizedPoints.last!.y - rb.normalizedPoints.first!.y))
                )
            }
        }

        let smileRatio = mouthHeight > 0.001 ? mouthWidth / mouthHeight : 1.0

        var logits: [Float] = [0, 0, 0, 0, 0]
        if smileRatio > 2.8 && eyeOpen > 0.45 {
            logits = [2.2, -0.5, -0.8, -1.0, 0.2]
        } else if browSpan > 0.16 && eyeOpen < 0.35 {
            logits = [-0.5, 0.2, 1.2, 0.3, 0.5]
        } else if headPenalty < 45 && eyeOpen < 0.35 && smileRatio < 2.0 {
            logits = [-0.8, 0.3, 0.5, 1.8, 0.1]
        } else if eyeOpen < 0.4 && smileRatio < 2.2 {
            logits = [-0.3, 1.6, 0.2, 0.4, 0.5]
        } else if eyeOpen > 0.5 {
            logits = [1.4, -0.2, -0.3, -0.5, 0.4]
        } else {
            logits = [0.2, 0.6, 0.1, 0.2, 0.8]
        }

        let emotionProbs = softmax(logits)
        let engagementProb = deriveEngagement(
            probEngaged: emotionProbs[0],
            probBored: emotionProbs[1],
            gazeAwayProb: gazeAwayProb,
            faceQuality: faceQuality,
            eyeOpen: eyeOpen
        )

        return buildResult(
            engagementProb: engagementProb,
            gazeAwayProb: gazeAwayProb,
            emotionProbs: emotionProbs,
            modelVersion: loadedVersion
        )
    }

    private func pickDominantEmotion(
        emotionProbs: [Float],
        engagementProb: Float
    ) -> (EmotionCode, Float) {
        let probs = emotionProbs.count >= 5 ? emotionProbs : [0.2, 0.2, 0.2, 0.2, 0.2]
        let labels: [EmotionCode] = [.engaged, .bored, .confused, .frustrated, .unknown]

        var bestIdx = 0
        var bestProb = probs[0]
        for i in 1..<5 {
            if probs[i] > bestProb {
                bestProb = probs[i]
                bestIdx = i
            }
        }

        // No strong affect signal — default to neutral rather than a weak winner.
        if bestProb < 0.50 {
            return (.unknown, probs[4])
        }

        // Confused is a common false positive during focused work; demote when engagement is decent.
        if labels[bestIdx] == .confused {
            let engagedProb = probs[0]
            let neutralProb = probs[4]
            if engagedProb >= bestProb - 0.08 {
                return (.engaged, engagedProb)
            }
            if engagementProb >= 0.50 && bestProb < 0.65 && engagedProb >= bestProb - 0.12 {
                return (.engaged, engagedProb)
            }
            if neutralProb >= bestProb - 0.10 && engagementProb >= 0.45 {
                return (.unknown, neutralProb)
            }
        }

        // Strong engaged signal should win over marginal confused.
        if labels[bestIdx] == .confused && probs[0] >= 0.35 && probs[0] >= bestProb - 0.05 {
            return (.engaged, probs[0])
        }

        return (labels[bestIdx], bestProb)
    }

    private func buildResult(
        engagementProb: Float,
        gazeAwayProb: Float,
        emotionProbs: [Float],
        modelVersion: String
    ) -> AttuneMLResult {
        let probs = emotionProbs.count >= 5 ? emotionProbs : [0.2, 0.2, 0.2, 0.2, 0.2]
        let (dominant, confidence) = pickDominantEmotion(
            emotionProbs: probs,
            engagementProb: engagementProb
        )

        let attentionScore = max(0, min(100, engagementProb * 100))

        return AttuneMLResult(
            engagementProb: engagementProb,
            gazeAwayProb: gazeAwayProb,
            probEngaged: probs[0],
            probBored: probs[1],
            probConfused: probs[2],
            probFrustrated: probs[3],
            probNeutral: probs[4],
            dominantEmotionCode: dominant.rawValue,
            emotionConfidence: confidence,
            attentionScore: attentionScore,
            modelVersion: modelVersion
        )
    }
}

private extension MLMultiArray {
    convenience init(_ values: [Float], shape: [Int]? = nil) throws {
        if let shape {
            try self.init(shape: shape.map { NSNumber(value: $0) }, dataType: .float32)
        } else {
            try self.init(shape: [NSNumber(value: values.count)], dataType: .float32)
        }
        for (i, v) in values.enumerated() {
            self[i] = NSNumber(value: v)
        }
    }
}

@_cdecl("attune_inference_status")
public func attune_inference_status(
    version_buffer: UnsafeMutablePointer<CChar>?,
    buffer_len: Int32,
    engagement_loaded: UnsafeMutablePointer<Bool>?,
    affect_loaded: UnsafeMutablePointer<Bool>?,
    gaze_loaded: UnsafeMutablePointer<Bool>?,
    affect_source_buffer: UnsafeMutablePointer<CChar>?,
    affect_source_len: Int32
) {
    let status = AttuneInferenceEngine.shared.inferenceStatus()
    if let engagement_loaded {
        engagement_loaded.pointee = status.engagementLoaded
    }
    if let affect_loaded {
        affect_loaded.pointee = status.affectLoaded
    }
    if let gaze_loaded {
        gaze_loaded.pointee = status.gazeLoaded || status.pretrainedGazeLoaded
    }
    guard let version_buffer, buffer_len > 0 else { return }
    status.modelVersion.withCString { cstr in
        strncpy(version_buffer, cstr, Int(buffer_len - 1))
        version_buffer[Int(buffer_len - 1)] = 0
    }
    if let affect_source_buffer, affect_source_len > 0 {
        status.affectSource.withCString { cstr in
            strncpy(affect_source_buffer, cstr, Int(affect_source_len - 1))
            affect_source_buffer[Int(affect_source_len - 1)] = 0
        }
    }
}

// MARK: - Screening classifier (optional bundled AttuneScreening.mlmodel)

private final class AttuneScreeningPredictor {
    static let shared = AttuneScreeningPredictor()
    private var model: MLModel?

    private init() {
        let bundle = Bundle.main
        if let url = bundle.url(forResource: "AttuneScreening", withExtension: "mlmodelc", subdirectory: modelsSubdirectory)
            ?? bundle.url(forResource: "AttuneScreening", withExtension: "mlmodelc") {
            model = try? MLModel(contentsOf: url)
        }
    }

    var isLoaded: Bool { model != nil }

    func predict(features: [Float]) -> Float? {
        guard let model, !features.isEmpty else { return nil }
        guard let input = try? MLMultiArray(features) else { return nil }
        let provider = try? MLDictionaryFeatureProvider(dictionary: ["features": MLFeatureValue(multiArray: input)])
        guard let provider, let out = try? model.prediction(from: provider) else { return nil }
        if let val = out.featureValue(for: "adhd_indicator_prob")?.doubleValue {
            return Float(val)
        }
        if let arr = out.featureValue(for: "adhd_indicator_prob")?.multiArrayValue, arr.count > 0 {
            return arr[0].floatValue
        }
        return nil
    }
}

@_cdecl("attune_screening_model_loaded")
public func attune_screening_model_loaded() -> Bool {
    AttuneScreeningPredictor.shared.isLoaded
}

@_cdecl("attune_screening_predict")
public func attune_screening_predict(
    features: UnsafePointer<Float>?,
    feature_count: Int32,
    out_prob: UnsafeMutablePointer<Float>?
) -> Bool {
    guard let features, feature_count > 0, let out_prob else { return false }
    let arr = (0..<Int(feature_count)).map { features[$0] }
    guard let prob = AttuneScreeningPredictor.shared.predict(features: arr) else { return false }
    out_prob.pointee = prob
    return true
}
