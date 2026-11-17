package expo.modules.pdfpages

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.Icon
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * PDF helpers: rendering pages with Android's built-in PdfRenderer, PdfBox-Android for
 * password-protected files, and pinned home-screen shortcuts.
 */
class PdfPagesModule : Module() {
  private var pdfBoxReady = false

  override fun definition() = ModuleDefinition {
    Name("PdfPages")

    // Number of pages in a local PDF file
    AsyncFunction("getPageCount") { uri: String ->
      openRenderer(localFile(uri, null)).use { it.renderer.pageCount }
    }

    // Renders every page to a JPEG in the cache folder and returns the file URIs in page order.
    // maxSide caps the longer edge in pixels; quality is 30..100. password: for protected PDFs ("" if none).
    AsyncFunction("renderPages") { uri: String, maxSide: Int, quality: Int, password: String ->
      val context = appContext.reactContext ?: throw CodedException("No context")
      val outDir = File(context.cacheDir, "pdf_pages").apply { mkdirs() }
      val stamp = System.currentTimeMillis()
      val result = mutableListOf<String>()
      val file = localFile(uri, password.ifEmpty { null })
      openRenderer(file).use { opened ->
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
            val out = File(outDir, "pdf_${stamp}_${i + 1}.jpg")
            FileOutputStream(out).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 100), it) }
            bitmap.recycle()
            result.add(Uri.fromFile(out).toString())
          }
        }
      }
      result
    }

    // Writes a copy of the PDF that needs a password to open. Returns the new file URI.
    AsyncFunction("protectPdf") { uri: String, password: String ->
      if (password.isEmpty()) throw CodedException("PDF_PASSWORD_EMPTY", "Enter a password", null)
      ensurePdfBox()
      val context = appContext.reactContext ?: throw CodedException("No context")
      val src = File(Uri.parse(uri).path ?: uri)
      val out = File(context.cacheDir, "protected_${System.currentTimeMillis()}.pdf")
      PDDocument.load(src).use { doc ->
        val policy = StandardProtectionPolicy(password, password, AccessPermission())
        policy.encryptionKeyLength = 128
        doc.protect(policy)
        doc.save(out)
      }
      Uri.fromFile(out).toString()
    }

    // Asks the launcher to pin a shortcut that opens `url`. Returns false where pinning is not supported.
    AsyncFunction("pinShortcut") { id: String, label: String, imageUri: String, url: String ->
      val context = appContext.reactContext ?: throw CodedException("No context")
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
      val manager = context.getSystemService(ShortcutManager::class.java) ?: return@AsyncFunction false
      if (!manager.isRequestPinShortcutSupported) return@AsyncFunction false
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val bitmap = imageUri.takeIf { it.isNotEmpty() }?.let { BitmapFactory.decodeFile(Uri.parse(it).path ?: it) }
      val icon = if (bitmap != null) Icon.createWithAdaptiveBitmap(squareIcon(bitmap))
      else Icon.createWithResource(context, context.applicationInfo.icon)
      val info = ShortcutInfo.Builder(context, "doc_$id")
        .setShortLabel(label.take(24).ifEmpty { "Document" })
        .setLongLabel(label.take(48).ifEmpty { "Document" })
        .setIcon(icon)
        .setIntent(intent)
        .build()
      manager.requestPinShortcut(info, null)
    }
  }

  private fun ensurePdfBox() {
    if (pdfBoxReady) return
    val context = appContext.reactContext ?: throw CodedException("No context")
    PDFBoxResourceLoader.init(context.applicationContext)
    pdfBoxReady = true
  }

  /** Thumbnail cropped to a square with a white margin, for an adaptive launcher icon. */
  private fun squareIcon(src: Bitmap): Bitmap {
    val size = 432
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    out.eraseColor(Color.WHITE)
    val canvas = android.graphics.Canvas(out)
    val inner = (size * 0.6f)
    val s = inner / max(src.width, src.height)
    val w = src.width * s
    val h = src.height * s
    val dst = android.graphics.RectF((size - w) / 2, (size - h) / 2, (size + w) / 2, (size + h) / 2)
    canvas.drawBitmap(src, null, dst, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
    return out
  }

  /**
   * A local file PdfRenderer can open. Content URIs are copied to the cache; protected PDFs are
   * unlocked with the password into a temporary copy without encryption.
   */
  private fun localFile(uri: String, password: String?): File {
    val context = appContext.reactContext ?: throw CodedException("No context")
    val parsed = Uri.parse(uri)
    var file = if (parsed.scheme == "content") {
      val tmp = File(context.cacheDir, "pdf_in_${System.currentTimeMillis()}.pdf")
      context.contentResolver.openInputStream(parsed)?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } }
        ?: throw CodedException("Could not open the PDF")
      tmp
    } else File(parsed.path ?: uri)
    if (password != null) {
      ensurePdfBox()
      val unlocked = File(context.cacheDir, "pdf_unlocked_${System.currentTimeMillis()}.pdf")
      try {
        PDDocument.load(file, password).use { doc ->
          doc.isAllSecurityToBeRemoved = true
          doc.save(unlocked)
        }
      } catch (e: InvalidPasswordException) {
        throw CodedException("PDF_WRONG_PASSWORD", "Wrong password", e)
      }
      file = unlocked
    }
    return file
  }

  private class Opened(val renderer: PdfRenderer, private val fd: ParcelFileDescriptor) : AutoCloseable {
    override fun close() {
      renderer.close()
      fd.close()
    }
  }

  private fun openRenderer(file: File): Opened {
    val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
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
