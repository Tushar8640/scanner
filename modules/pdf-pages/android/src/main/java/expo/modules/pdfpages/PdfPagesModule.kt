package expo.modules.pdfpages

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Reads PDFs with Android's built-in PdfRenderer (no third-party code). */
class PdfPagesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfPages")

    // Number of pages in a local PDF file
    AsyncFunction("getPageCount") { uri: String ->
      openRenderer(uri).use { it.renderer.pageCount }
    }

    // Renders every page to a JPEG in the cache folder and returns the file URIs in page order.
    // maxSide caps the longer edge in pixels; quality is 30..100.
    AsyncFunction("renderPages") { uri: String, maxSide: Int, quality: Int ->
      val context = appContext.reactContext ?: throw CodedException("No context")
      val outDir = File(context.cacheDir, "pdf_pages").apply { mkdirs() }
      val stamp = System.currentTimeMillis()
      val result = mutableListOf<String>()
      openRenderer(uri).use { opened ->
        val renderer = opened.renderer
        for (i in 0 until renderer.pageCount) {
          renderer.openPage(i).use { page ->
            // Pages are measured in points (1/72 in)
            val scale = maxSide.toFloat() / max(page.width, page.height)
            val w = max(1, (page.width * scale).roundToInt())
            val h = max(1, (page.height * scale).roundToInt())
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE) // PDF pages are transparent by default
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            val file = File(outDir, "pdf_${stamp}_${i + 1}.jpg")
            FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 100), it) }
            bitmap.recycle()
            result.add(Uri.fromFile(file).toString())
          }
        }
      }
      result
    }
  }

  private class Opened(val renderer: PdfRenderer, private val fd: ParcelFileDescriptor) : AutoCloseable {
    override fun close() {
      renderer.close()
      fd.close()
    }
  }

  private fun openRenderer(uri: String): Opened {
    val context = appContext.reactContext ?: throw CodedException("No context")
    val parsed = Uri.parse(uri)
    val fd = when (parsed.scheme) {
      "content" -> context.contentResolver.openFileDescriptor(parsed, "r")
      else -> ParcelFileDescriptor.open(File(parsed.path ?: uri), ParcelFileDescriptor.MODE_READ_ONLY)
    } ?: throw CodedException("Could not open the PDF")
    return try {
      Opened(PdfRenderer(fd), fd)
    } catch (e: SecurityException) {
      fd.close()
      throw CodedException("PDF_PASSWORD", "This PDF is password protected", e)
    } catch (e: Exception) {
      fd.close()
      throw CodedException("PDF_INVALID", "This file is not a readable PDF", e)
    }
  }
}
