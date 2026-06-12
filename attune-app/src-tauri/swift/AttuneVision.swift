import AVFoundation
import Vision
import Foundation

public typealias AttentionCallback = @convention(c) (
    Float, Bool, Double, Float, Float, Float, Int32, Float,
    Float, Float, Float, Float, Float, Float, Float,
    Float, Float,
    UnsafePointer<CChar>?
) -> Void

private var attentionCallback: AttentionCallback?
private let visionQueue = DispatchQueue(label: "ai.attune.vision", qos: .userInitiated)
private var captureSession: AVCaptureSession?
private var isRunning = false
private var frameCounter: Int = 0
private var modelVersionCString: [CChar] = Array("heuristic-v0.1".utf8CString)
/// Minimum seconds between processed frames: 0.25 (~4 Hz) learning, 0.1 (~10 Hz) screening.
private var captureIntervalSeconds: TimeInterval = 0.25

private enum EmotionCode: Int32 {
    case unknown = 0
    case engaged = 1
    case bored = 2
    case confused = 3
    case frustrated = 4
}

private struct AttentionSignals {
    let score: Float
    let faceQuality: Float
    let eyeOpenness: Float
    let headPosePenalty: Float
    let emotion: EmotionCode
    let emotionConfidence: Float
    let mlResult: AttuneMLResult
    let yaw: Float
    let pitch: Float
}

private func eyeOpenness(_ eye: VNFaceLandmarkRegion2D) -> Float {
    guard eye.pointCount >= 4 else { return 0.5 }
    let points = eye.normalizedPoints
    guard points.count >= 4 else { return 0.5 }

    var minY = points[0].y
    var maxY = points[0].y
    for p in points {
        minY = min(minY, p.y)
        maxY = max(maxY, p.y)
    }
    let height = maxY - minY
    return Float(min(1.0, max(0.1, height * 25)))
}

private func computeSignals(from observation: VNFaceObservation, pixelBuffer: CVPixelBuffer?) -> AttentionSignals {
    var faceQuality: Float = 80
    if let quality = observation.faceCaptureQuality, quality > 0 {
        faceQuality = quality * 100
    }

    var eyeOpen: Float = 0.55
    if let landmarks = observation.landmarks {
        if let leftEye = landmarks.leftEye, let rightEye = landmarks.rightEye {
            eyeOpen = (eyeOpenness(leftEye) + eyeOpenness(rightEye)) / 2
        } else {
            eyeOpen = 0.35
        }
    }

    let yaw = Float(abs(observation.yaw?.doubleValue ?? 0))
    let pitch = Float(abs(observation.pitch?.doubleValue ?? 0))
    var headPenalty: Float = 100
    if yaw > 0.35 || pitch > 0.35 {
        headPenalty = 35
    } else if yaw > 0.2 || pitch > 0.2 {
        headPenalty = 55
    }

    let mlResult = AttuneInferenceEngine.shared.infer(
        from: observation,
        pixelBuffer: pixelBuffer,
        faceQuality: faceQuality,
        eyeOpen: eyeOpen,
        headPenalty: headPenalty
    )

    modelVersionCString = Array(mlResult.modelVersion.utf8CString)

    let emotion = EmotionCode(rawValue: mlResult.dominantEmotionCode) ?? .unknown

    return AttentionSignals(
        score: mlResult.attentionScore,
        faceQuality: faceQuality,
        eyeOpenness: eyeOpen * 100,
        headPosePenalty: headPenalty,
        emotion: emotion,
        emotionConfidence: mlResult.emotionConfidence,
        mlResult: mlResult,
        yaw: yaw,
        pitch: pitch
    )
}

private func emitSample(score: Float, facePresent: Bool, signals: AttentionSignals?, timestamp: Double) {
    let versionPtr = modelVersionCString.withUnsafeBufferPointer { $0.baseAddress }

    if let signals {
        attentionCallback?(
            signals.score,
            facePresent,
            timestamp,
            signals.faceQuality,
            signals.eyeOpenness,
            signals.headPosePenalty,
            signals.emotion.rawValue,
            signals.emotionConfidence,
            signals.mlResult.engagementProb,
            signals.mlResult.gazeAwayProb,
            signals.mlResult.probEngaged,
            signals.mlResult.probBored,
            signals.mlResult.probConfused,
            signals.mlResult.probFrustrated,
            signals.mlResult.probNeutral,
            signals.yaw,
            signals.pitch,
            versionPtr
        )
    } else {
        attentionCallback?(
            0, false, timestamp, 0, 0, 0,
            EmotionCode.unknown.rawValue, 0,
            0, 0, 0, 0, 0, 0, 1,
            0, 0,
            versionPtr
        )
    }
}

private func processSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    frameCounter += 1
    _ = frameCounter % 2 == 0

    let request = VNDetectFaceLandmarksRequest { request, _ in
        guard let observations = request.results as? [VNFaceObservation],
              let face = observations.first else {
            emitSample(score: 0, facePresent: false, signals: nil, timestamp: Date().timeIntervalSince1970)
            return
        }
        let signals = computeSignals(from: face, pixelBuffer: pixelBuffer)
        emitSample(score: signals.score, facePresent: true, signals: signals, timestamp: Date().timeIntervalSince1970)
    }

    request.revision = VNDetectFaceLandmarksRequestRevision3

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .leftMirrored, options: [:])
    try? handler.perform([request])
}

@_cdecl("attune_vision_set_callback")
public func attune_vision_set_callback(_ callback: AttentionCallback?) {
    attentionCallback = callback
}

/// 0 = learning session (~4 Hz), 1 = screening assessment (~10 Hz)
@_cdecl("attune_vision_set_capture_mode")
public func attune_vision_set_capture_mode(_ mode: Int32) {
    captureIntervalSeconds = mode == 1 ? 0.1 : 0.25
}

@_cdecl("attune_vision_check_camera_permission")
public func attune_vision_check_camera_permission() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return 2
    case .notDetermined: return 0
    case .denied, .restricted: return 1
    @unknown default: return 1
    }
}

@_cdecl("attune_vision_request_camera_permission")
public func attune_vision_request_camera_permission() -> Int32 {
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .video) { ok in
        granted = ok
        sem.signal()
    }
    sem.wait()
    return granted ? 2 : 1
}

@_cdecl("attune_vision_start")
public func attune_vision_start() -> Bool {
    guard !isRunning else { return true }

    let session = AVCaptureSession()
    session.sessionPreset = .medium

    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
          let input = try? AVCaptureDeviceInput(device: device) else {
        return false
    }

    if session.canAddInput(input) {
        session.addInput(input)
    } else {
        return false
    }

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(VideoDelegate.shared, queue: visionQueue)

    if session.canAddOutput(output) {
        session.addOutput(output)
    } else {
        return false
    }

    captureSession = session
    isRunning = true
    frameCounter = 0
    visionQueue.async {
        session.startRunning()
    }
    return true
}

@_cdecl("attune_vision_stop")
public func attune_vision_stop() {
    guard isRunning else { return }
    isRunning = false
    captureSession?.stopRunning()
    captureSession = nil
}

private final class VideoDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = VideoDelegate()
    private var lastProcessed: TimeInterval = 0

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date().timeIntervalSince1970
        let interval = captureIntervalSeconds
        guard now - lastProcessed >= interval else { return }
        lastProcessed = now
        processSampleBuffer(sampleBuffer)
    }
}
