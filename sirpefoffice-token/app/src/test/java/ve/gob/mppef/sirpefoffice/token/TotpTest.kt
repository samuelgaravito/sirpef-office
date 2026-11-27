package ve.gob.mppef.sirpefoffice.token

import org.junit.Assert.assertEquals
import org.junit.Test
import ve.gob.mppef.sirpefoffice.token.data.Totp

class TotpTest {
    private val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    @Test
    fun `vectores oficiales RFC 6238 con SHA-1 y 8 digitos`() {
        val vectors = listOf(
            59L to "94287082",
            1_111_111_109L to "07081804",
            1_111_111_111L to "14050471",
            1_234_567_890L to "89005924",
            2_000_000_000L to "69279037",
        )
        for ((at, expected) in vectors) {
            assertEquals(expected, Totp.codeAt(secret, at * 1000, digits = 8))
        }
    }

    @Test
    fun `codigo de seis digitos`() {
        assertEquals("287082", Totp.codeAt(secret, 59_000))
    }

    @Test
    fun `formato de tres y tres`() {
        assertEquals("287 082", Totp.format("287082"))
    }

    @Test
    fun `base32 conserva los bytes`() {
        val bytes = "12345678901234567890".toByteArray()
        val encoded = Totp.encodeBase32(bytes)
        assertEquals("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", encoded)
        assertEquals(bytes.toList(), Totp.decodeBase32(encoded).toList())
    }
}
