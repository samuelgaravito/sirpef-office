package ve.gob.mppef.sirpefoffice.token.data

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.floor

/**
 * Implementación pura de TOTP (RFC 6238) para poder probarla en JVM sin
 * depender de Android. El secreto se recibe en Base32.
 */
object Totp {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun decodeBase32(value: String): ByteArray {
        val clean = value.uppercase()
            .replace(Regex("[\\s=-]"), "")
            .replace('0', 'O')
            .replace('1', 'I')
        var bits = 0
        var current = 0
        val output = ArrayList<Byte>(clean.length * 5 / 8)
        for (char in clean) {
            val index = ALPHABET.indexOf(char)
            require(index >= 0) { "Secreto Base32 inválido" }
            current = (current shl 5) or index
            bits += 5
            if (bits >= 8) {
                output.add(((current ushr (bits - 8)) and 0xff).toByte())
                bits -= 8
            }
        }
        return output.toByteArray()
    }

    fun encodeBase32(bytes: ByteArray): String {
        var bits = 0
        var current = 0
        val output = StringBuilder()
        for (byte in bytes) {
            current = (current shl 8) or (byte.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                output.append(ALPHABET[(current ushr (bits - 5)) and 31])
                bits -= 5
            }
        }
        if (bits > 0) output.append(ALPHABET[(current shl (5 - bits)) and 31])
        return output.toString()
    }

    fun step(epochMillis: Long, period: Int = 30): Long =
        floor(epochMillis / 1000.0 / period).toLong()

    fun remainingSeconds(epochMillis: Long, period: Int = 30): Int {
        val elapsed = (epochMillis / 1000L) % period
        return (period - elapsed).toInt().coerceAtLeast(1)
    }

    fun code(secret: String, step: Long, digits: Int = 6): String {
        val key = SecretKeySpec(decodeBase32(secret), "HmacSHA1")
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(key)
        val counter = ByteArray(8)
        var value = step
        for (index in 7 downTo 0) {
            counter[index] = (value and 0xff).toByte()
            value = value ushr 8
        }
        val hmac = mac.doFinal(counter)
        val offset = hmac[hmac.size - 1].toInt() and 0x0f
        val binary =
            ((hmac[offset].toInt() and 0x7f) shl 24) or
                ((hmac[offset + 1].toInt() and 0xff) shl 16) or
                ((hmac[offset + 2].toInt() and 0xff) shl 8) or
                (hmac[offset + 3].toInt() and 0xff)
        return (binary % pow10(digits)).toString().padStart(digits, '0')
    }

    fun codeAt(secret: String, epochMillis: Long, period: Int = 30, digits: Int = 6): String =
        code(secret, step(epochMillis, period), digits)

    fun format(code: String): String =
        if (code.length == 6) "${code.substring(0, 3)} ${code.substring(3)}" else code

    private fun pow10(digits: Int): Int {
        var value = 1
        repeat(digits) { value *= 10 }
        return value
    }
}
