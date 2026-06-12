import CoreImage
import CoreVideo
import Vision

enum AttuneGazePreprocess {
    private static let gazeSize = 448
    private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    /// Build 1×3×448×448 RGB float tensor in [0, 1] from a face bounding box.
    static func faceCropTensor(
        pixelBuffer: CVPixelBuffer,
        observation: VNFaceObservation
    ) -> [Float]? {
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
        let padX = rect.width * 0.15
        let padY = rect.height * 0.15
        rect = rect.insetBy(dx: -padX, dy: -padY)
        rect = rect.intersection(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        guard rect.width > 8, rect.height > 8 else { return nil }

        var ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        ciImage = ciImage.cropped(to: rect)
        let scale = CGFloat(gazeSize) / max(rect.width, rect.height)
        ciImage = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        var rgba = [UInt8](repeating: 0, count: gazeSize * gazeSize * 4)
        guard let cg = ciContext.createCGImage(ciImage, from: CGRect(x: 0, y: 0, width: gazeSize, height: gazeSize)) else {
            return nil
        }
        guard let ctx = CGContext(
            data: &rgba,
            width: gazeSize,
            height: gazeSize,
            bitsPerComponent: 8,
            bytesPerRow: gazeSize * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: gazeSize, height: gazeSize))

        var tensor = [Float](repeating: 0, count: 3 * gazeSize * gazeSize)
        let plane = gazeSize * gazeSize
        for y in 0..<gazeSize {
            for x in 0..<gazeSize {
                let i = (y * gazeSize + x) * 4
                let r = Float(rgba[i]) / 255.0
                let g = Float(rgba[i + 1]) / 255.0
                let b = Float(rgba[i + 2]) / 255.0
                let idx = y * gazeSize + x
                tensor[idx] = r
                tensor[plane + idx] = g
                tensor[2 * plane + idx] = b
            }
        }
        return tensor
    }
}
