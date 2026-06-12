import CoreImage
import CoreVideo
import Vision

/// Crop and resize a face region from the camera frame for HSEmotion (224×224 RGB).
enum AttuneFaceCrop {
    private static let cropSize = 224
    private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private static var pixelBufferPool: CVPixelBufferPool?

    static func crop(pixelBuffer: CVPixelBuffer, observation: VNFaceObservation) -> CVPixelBuffer? {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard width > 0, height > 0 else { return nil }

        let bbox = observation.boundingBox
        var rect = CGRect(
            x: bbox.origin.x * CGFloat(width),
            y: (1.0 - bbox.origin.y - bbox.size.height) * CGFloat(height),
            width: bbox.size.width * CGFloat(width),
            height: bbox.size.height * CGFloat(height)
        )
        let padX = rect.width * 0.10
        let padY = rect.height * 0.10
        rect = rect.insetBy(dx: -padX, dy: -padY)
        rect = rect.intersection(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        guard rect.width > 8, rect.height > 8 else { return nil }

        var ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        ciImage = ciImage.cropped(to: rect)
        let scale = CGFloat(cropSize) / max(rect.width, rect.height)
        ciImage = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        guard let pool = pool() else { return nil }
        var outBuffer: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outBuffer)
        guard status == kCVReturnSuccess, let outBuffer else { return nil }

        ciContext.render(
            ciImage,
            to: outBuffer,
            bounds: CGRect(x: 0, y: 0, width: cropSize, height: cropSize),
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )
        return outBuffer
    }

    private static func pool() -> CVPixelBufferPool? {
        if let pixelBufferPool { return pixelBufferPool }
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: cropSize,
            kCVPixelBufferHeightKey as String: cropSize,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ]
        var pool: CVPixelBufferPool?
        let status = CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
        guard status == kCVReturnSuccess else { return nil }
        pixelBufferPool = pool
        return pool
    }
}
