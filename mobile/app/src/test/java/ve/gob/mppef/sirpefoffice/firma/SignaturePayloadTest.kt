package ve.gob.mppef.sirpefoffice.firma

import org.junit.Assert.assertEquals
import org.junit.Test
import ve.gob.mppef.sirpefoffice.firma.data.buildSigningPayload
import ve.gob.mppef.sirpefoffice.firma.data.sha256Hex

class SignaturePayloadTest {

    @Test
    fun `el payload coincide con el contrato del servidor`() {
        val payload = buildSigningPayload(
            challengeId = "11111111-1111-1111-1111-111111111111",
            documentId = "22222222-2222-2222-2222-222222222222",
            messageId = "33333333-3333-3333-3333-333333333333",
            version = 4,
            contentSha256 = "abc123",
            signatureSha256 = "def456",
        )

        assertEquals(
            "SIRPEF-SIGN|11111111-1111-1111-1111-111111111111|" +
                "22222222-2222-2222-2222-222222222222|" +
                "33333333-3333-3333-3333-333333333333|4|abc123|def456",
            payload,
        )
    }

    @Test
    fun `el payload sin mensaje usa guion`() {
        val payload = buildSigningPayload(
            challengeId = "c",
            documentId = "d",
            messageId = null,
            version = 1,
            contentSha256 = "h",
            signatureSha256 = "s",
        )
        assertEquals("SIRPEF-SIGN|c|d|-|1|h|s", payload)
    }

    @Test
    fun `el hash de bytes vacios es el sha256 conocido`() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sha256Hex(ByteArray(0)),
        )
    }
}
