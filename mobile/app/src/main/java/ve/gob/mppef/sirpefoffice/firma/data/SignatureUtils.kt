package ve.gob.mppef.sirpefoffice.firma.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

private fun ByteArray.toHex(): String =
    joinToString("") { "%02x".format(it) }

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

fun buildSigningPayload(
    challengeId: String,
    documentId: String,
    messageId: String?,
    version: Int,
    contentSha256: String,
    signatureSha256: String,
): String = listOf(
    "SIRPEF-SIGN",
    challengeId,
    documentId,
    messageId ?: "-",
    version.toString(),
    contentSha256,
    signatureSha256,
).joinToString("|")

/** Payload que firma la app de firma para vincular o recuperar Token. */
fun buildTotpDevicePayload(purpose: String, nonce: String): String =
    listOf("SIRPEF-TOKEN", purpose, nonce).joinToString("|")

/** Payload que demuestra la posesión de la clave durante el alta del teléfono. */
fun buildPairingPayload(pairToken: String, deviceId: String): String =
    listOf("SIRPEF-PAIR", pairToken, deviceId).joinToString("|")

/** Payload del login diario; debe coincidir con el backend. */
fun buildLoginPayload(nonce: String, deviceId: String, identifier: String): String =
    listOf("SIRPEF-LOGIN", nonce, deviceId, identifier).joinToString("|")

fun strokesToCapture(
    strokes: List<StrokePayload>,
    width: Int = 1000,
    height: Int = 400,
): SignatureCapture {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.TRANSPARENT)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    for (stroke in strokes) {
        if (stroke.points.isEmpty()) continue
        paint.color = stroke.color
        paint.strokeWidth = stroke.width.coerceAtLeast(2f) * (height / 400f)
        val path = Path()
        val first = stroke.points.first()
        path.moveTo(first.x * width, first.y * height)
        for (point in stroke.points.drop(1)) {
            path.lineTo(point.x * width, point.y * height)
        }
        canvas.drawPath(path, paint)
    }

    return bitmap.toCapture(strokes, "drawn")
}

fun typedSignatureCapture(
    text: String,
    color: Int = 0xFF041E42.toInt(),
    typeface: Typeface? = null,
): SignatureCapture {
    val width = 1000
    val height = 400
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.TRANSPARENT)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        this.typeface = typeface ?: Typeface.create("cursive", Typeface.ITALIC)
        textSize = 138f
    }
    val maxWidth = width - 80f
    val measured = paint.measureText(text)
    if (measured > maxWidth) {
        paint.textSize = paint.textSize * (maxWidth / measured)
    }
    val metrics = paint.fontMetrics
    val baseline = height / 2f - (metrics.ascent + metrics.descent) / 2f
    canvas.drawText(text, 40f, baseline, paint)
    return bitmap.toCapture(emptyList(), "typed")
}

private fun Bitmap.toCapture(
    strokes: List<StrokePayload>,
    method: String,
): SignatureCapture {
    val output = ByteArrayOutputStream()
    compress(Bitmap.CompressFormat.PNG, 100, output)
    val bytes = output.toByteArray()
    return SignatureCapture(
        pngBytes = bytes,
        base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
        sha256 = sha256Hex(bytes),
        strokes = strokes,
        method = method,
    )
}
