import ExpoModulesCore
import PDFKit
import UIKit

/// PDF helpers using Apple's built-in PDFKit (no third-party code).
public class PdfPagesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfPages")

    AsyncFunction("getPageCount") { (uri: String) -> Int in
      let doc = try Self.open(uri, password: "")
      return doc.pageCount
    }

    AsyncFunction("renderPages") { (uri: String, maxSide: Int, quality: Int, password: String) -> [String] in
      let doc = try Self.open(uri, password: password)
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

    AsyncFunction("protectPdf") { (uri: String, password: String) -> String in
      if password.isEmpty {
        throw Exception(name: "PDF_PASSWORD_EMPTY", description: "Enter a password")
      }
      let doc = try Self.open(uri, password: "")
      let file = FileManager.default.temporaryDirectory.appendingPathComponent("protected_\(Int(Date().timeIntervalSince1970 * 1000)).pdf")
      let options: [PDFDocumentWriteOption: Any] = [.userPasswordOption: password, .ownerPasswordOption: password]
      if !doc.write(to: file, withOptions: options) {
        throw Exception(name: "PDF_WRITE", description: "Could not save the PDF")
      }
      return file.absoluteString
    }

    // iOS has no pinned home-screen shortcuts for apps
    AsyncFunction("pinShortcut") { (_: String, _: String, _: String, _: String) -> Bool in
      return false
    }
  }

  private static func open(_ uri: String, password: String) throws -> PDFDocument {
    let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
    guard let doc = PDFDocument(url: url) else {
      throw Exception(name: "PDF_INVALID", description: "This file is not a readable PDF")
    }
    if doc.isLocked {
      if password.isEmpty {
        throw Exception(name: "PDF_PASSWORD", description: "This PDF is password protected")
      }
      if !doc.unlock(withPassword: password) {
        throw Exception(name: "PDF_WRONG_PASSWORD", description: "Wrong password")
      }
    }
    return doc
  }
}
