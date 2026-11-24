package ve.gob.mppef.sirpefoffice.firma.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File

class PdfCache(private val context: Context) {

    suspend fun download(
        api: SirpefApi,
        documentId: String,
        sealed: Boolean,
    ): File {
        val file = File(context.cacheDir, "documento-$documentId-${if (sealed) "sellado" else "actual"}.pdf")
        val body = api.documentPdf(documentId, if (sealed) 1 else 0)
        body.byteStream().use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        body.close()
        return file
    }

    suspend fun downloadCertificatePdf(api: SirpefApi, documentId: String): File {
        val file = File(context.cacheDir, "certificado-$documentId.pdf")
        val body = api.certificatePdf(documentId)
        body.byteStream().use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        body.close()
        return file
    }

    fun clear() {
        context.cacheDir.listFiles()?.forEach { file ->
            if (file.name.startsWith("documento-") || file.name.startsWith("certificado-")) {
                file.delete()
            }
        }
    }

    fun render(file: File, maxWidth: Int = 1000, maxPages: Int = 8): List<ImageBitmap> {
        if (!file.exists() || file.length() == 0L) return emptyList()
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        val renderer = PdfRenderer(descriptor)
        val pages = mutableListOf<ImageBitmap>()
        try {
            val count = minOf(renderer.pageCount, maxPages)
            for (index in 0 until count) {
                val page = renderer.openPage(index)
                try {
                    if (page.width <= 0 || page.height <= 0) continue
                    val width = maxWidth
                    val height = (width.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    pages.add(bitmap.asImageBitmap())
                } finally {
                    page.close()
                }
            }
        } finally {
            renderer.close()
            descriptor.close()
        }
        return pages
    }
}
