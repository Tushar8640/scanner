import ExpoModulesCore
import PDFKit
import UIKit

/// Reads PDFs with Apple's built-in PDFKit (no third-party code).
public class PdfPagesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfPages")

    AsyncFunction("getPageCount") { (uri: String) -> Int in
      let doc = try Self.open(uri)
      return doc.pageCount
    }

    AsyncFunction("renderPages") { (uri: String, maxSide: Int, quality: Int) -> [String] in
      let doc = try Self.open(uri)
      let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pdf_pages", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let stamp = Int(Date().timeIntervalSince1970 * 1000)
      var out: [String] = []
      for i in 0..<doc.pageCount {
        guard let page = doc.page(at: i) else { continue }
        let box = page.bounds(for: .mediaBox)
        let scale = CGFloat(maxSide) / max(box.width, box.height)
        let size = CGSize(width: max(1, box.width * scale), height: max(1, box.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
          UIColor.white.setFill()
          ctx.fill(CGRect(origin: .zero, size: size))
          ctx.cgContext.translateBy(x: 0, y: size.height)
          ctx.cgContext.scaleBy(x: scale, y: -scale)
          page.draw(with: .mediaBox, to: ctx.cgContext)
        }
        let file = dir.appendingPathComponent("pdf_\(stamp)_\(i + 1).jpg")
        let q = CGFloat(min(max(quality, 30), 100)) / 100
        try image.jpegData(compressionQuality: q)?.write(to: file)
        out.append(file.absoluteString)
      }
      return out
    }
  }

  private static func open(_ uri: String) throws -> PDFDocument {
    let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
    guard let doc = PDFDocument(url: url) else {
      throw Exception(name: "PDF_INVALID", description: "This file is not a readable PDF")
    }
    if doc.isLocked {
      throw Exception(name: "PDF_PASSWORD", description: "This PDF is password protected")
    }
    return doc
  }
}
