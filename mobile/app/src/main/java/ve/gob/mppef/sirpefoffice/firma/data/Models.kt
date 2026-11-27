package ve.gob.mppef.sirpefoffice.firma.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SvaLoginRequest(
    val userCedula: String,
    val password: String,
)

/**
 * SVA devuelve `{ token: "jwt" }` en /auth/login/mobile, pero algunas
 * versiones lo envuelven como `{ token: { token, expiresIn } }`. El
 * ViewModel acepta ambas formas.
 */
@Serializable
data class SvaLoginResponse(
    val status: Int? = null,
    val message: String? = null,
    val msg: String? = null,
    val token: JsonElement? = null,
)

@Serializable
data class MobileSvaRequest(val token: String)

@Serializable
data class LocalLoginRequest(
    val email: String,
    val password: String,
)

/** Código de alta que genera la web para vincular este teléfono. */
@Serializable
data class MobilePairRequest(
    val code: String,
    val deviceId: String,
)

@Serializable
data class PairPreviewResponse(
    val user: PublicUser,
    val pairToken: String,
    val expiresAt: String? = null,
)

@Serializable
data class MobilePairConfirmRequest(
    val pairToken: String,
    val deviceId: String,
    val publicKey: String,
    val deviceAssertion: String,
    val model: String = "",
    val appVersion: String = "",
)

@Serializable
data class MobileLoginChallengeRequest(
    val identifier: String,
    val deviceId: String,
)

@Serializable
data class MobileLoginChallengeResponse(
    val challengeToken: String,
    val nonce: String,
    val expiresAt: String? = null,
    val requiresTotp: Boolean = false,
    val hasToken: Boolean = false,
    val identifier: String,
    val user: PublicUser,
)

@Serializable
data class MobileLoginRequest(
    val challengeToken: String,
    val deviceId: String,
    val identifier: String,
    val deviceAssertion: String,
    val code: String? = null,
    val recoveryCode: String? = null,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class PublicUser(
    val id: String,
    val email: String = "",
    val name: String = "",
    val role: String = "member",
    val avatarUrl: String? = null,
    val cedula: String? = null,
    val authProvider: String = "sva",
    val isActive: Boolean = true,
    val menus: List<String> = emptyList(),
    val createdAt: String? = null,
)

@Serializable
data class StoredSession(
    val user: PublicUser,
    val accessToken: String,
    val refreshToken: String,
    val refreshExpiresAt: String? = null,
)

@Serializable
data class CountsDto(
    val pending: Int = 0,
    val received: Int = 0,
    val signed: Int = 0,
    val sent: Int = 0,
)

@Serializable
data class CapabilitiesDto(
    val signApproval: Boolean = false,
    val deviceBinding: Boolean = false,
)

@Serializable
data class BootstrapResponse(
    val user: PublicUser,
    val counts: CountsDto = CountsDto(),
    val capabilities: CapabilitiesDto = CapabilitiesDto(),
    val serverTime: String? = null,
)

@Serializable
data class MobileDocument(
    val id: String,
    val documentId: String,
    val title: String = "",
    val subject: String = "",
    val senderName: String = "",
    val status: String = "",
    val documentStatus: String = "",
    val docNumber: String? = null,
    val version: Int = 1,
    val createdAt: String? = null,
    val approvedAt: String? = null,
    val signedAt: String? = null,
    val signed: Boolean = false,
    val certificateSerial: String? = null,
    val canSign: Boolean = false,
    val needsSignature: Boolean = false,
    val canAnnul: Boolean = false,
    val annulled: Boolean = false,
    val annulledAt: String? = null,
    val annulledReason: String? = null,
    val canEmergencyEdit: Boolean = false,
)

@Serializable
data class DocumentsResponse(
    val items: List<MobileDocument> = emptyList(),
    val page: Int? = null,
    val pageSize: Int? = null,
    val total: Int? = null,
)

@Serializable
data class DeviceRequest(
    val deviceId: String,
    val publicKey: String,
    val algorithm: String = "ES256",
    val platform: String = "android",
    val model: String = "",
    val appVersion: String = "",
)

@Serializable
data class DeviceInfo(
    val id: String,
    val deviceId: String,
    val status: String = "active",
    val createdAt: String? = null,
    val model: String? = null,
    val platform: String? = null,
    val appVersion: String? = null,
    val lastSeenAt: String? = null,
    val revokedAt: String? = null,
)

@Serializable
data class DeviceResponse(val device: DeviceInfo)

@Serializable
data class DevicesResponse(val items: List<DeviceInfo> = emptyList())

@Serializable
data class ChallengeRequest(val messageId: String)

@Serializable
data class ChallengeResponse(
    val challengeId: String,
    val nonce: String,
    val documentId: String,
    val messageId: String,
    val version: Int,
    val contentSha256: String,
    val purpose: String = "approval",
    val expiresAt: String,
)

@Serializable
data class SignAuthorizationRequest(
    val messageId: String,
    val challengeId: String,
    val code: String,
    val signatureSha256: String,
    val deviceAssertion: String,
)

@Serializable
data class SignAuthorizationResponse(
    val authorized: Boolean = false,
    val challengeId: String? = null,
    val expiresAt: String? = null,
    val step: Int? = null,
    val serverTime: String? = null,
)

@Serializable
data class TokenStatus(
    val paired: Boolean = false,
    val account: String = "",
    val issuer: String = "SirpefOffice",
    val digits: Int = 6,
    val period: Int = 30,
    val algorithm: String = "SHA1",
    val secretUpdatedAt: String? = null,
    val pairedDeviceId: String? = null,
    val pairedDeviceLabel: String? = null,
    val pairedAt: String? = null,
    val requiredForSigning: Boolean = true,
    val serverTime: String? = null,
)

@Serializable
data class TokenPurposeRequest(val purpose: String)

@Serializable
data class DeviceChallengeResponse(
    val nonce: String,
    val expiresAt: String,
)

@Serializable
data class DeviceProofRequest(
    val nonce: String,
    val deviceAssertion: String,
)

@Serializable
data class PairingCodeResponse(
    val code: String,
    val expiresAt: String,
)

@Serializable
data class RecoveryCodesResponse(
    val codes: List<String> = emptyList(),
    val generatedAt: String? = null,
)

@Serializable
data class PointPayload(val x: Float, val y: Float)

@Serializable
data class StrokePayload(
    val points: List<PointPayload>,
    val color: Int,
    val width: Float = 4f,
)

@Serializable
data class ApproveAndSignRequest(
    val expectedVersion: Int,
    val challengeId: String,
    val signaturePng: String,
    val strokes: List<StrokePayload> = emptyList(),
    val method: String = "drawn",
    val deviceAssertion: String,
    val allowSenderExport: Boolean = false,
    val subject: String? = null,
    val body: String? = null,
)

@Serializable
data class SignRequest(
    val messageId: String,
    val challengeId: String,
    val signaturePng: String,
    val strokes: List<StrokePayload> = emptyList(),
    val method: String = "drawn",
    val deviceAssertion: String,
)

@Serializable
data class CertificateDocument(
    val id: String? = null,
    val title: String? = null,
    val docNumber: String? = null,
    val version: Int? = null,
)

@Serializable
data class CertificateSigner(
    val id: String? = null,
    val name: String? = null,
    val cedula: String? = null,
    val role: String? = null,
)

@Serializable
data class CertificateSignature(
    val id: String? = null,
    val method: String? = null,
    val signedAt: String? = null,
    val ip: String? = null,
    val contentSha256: String? = null,
    val signatureSha256: String? = null,
)

@Serializable
data class CertificateDto(
    val status: String? = null,
    val serial: String,
    val verificationUrl: String,
    val issuedAt: String? = null,
    val document: CertificateDocument? = null,
    val signer: CertificateSigner? = null,
    val signature: CertificateSignature? = null,
    val sealedPdfSha256: String? = null,
    val legalNotice: String? = null,
    val signaturePng: String? = null,
)

@Serializable
data class CertificateResponse(
    val certificate: CertificateDto,
    val signaturePng: String? = null,
    val issuedAt: String? = null,
    val sealedPdfSha256: String? = null,
)

@Serializable
data class ApproveAndSignResponse(
    val ok: Boolean? = null,
    val id: String? = null,
    val status: String? = null,
    val docNumber: String? = null,
    val approved: Boolean = false,
    val signed: Boolean = false,
    val signatureId: String? = null,
    val certificate: CertificateDto? = null,
)

@Serializable
data class RejectRequest(
    val reason: String,
    val allowEdit: Boolean = true,
)

@Serializable
data class RejectResponse(
    val ok: Boolean = true,
    val id: String? = null,
    val status: String? = null,
    val allowEdit: Boolean = true,
)

@Serializable
data class AnnulRequest(
    val reason: String? = null,
    val expectedVersion: Int,
    val code: String,
)

@Serializable
data class AnnulResponse(
    val ok: Boolean = true,
    val id: String? = null,
    val status: String? = null,
)

@Serializable
data class EmergencyEditRequest(
    val reason: String,
    val expectedVersion: Int,
    val code: String,
)

@Serializable
data class EmergencyEditResponse(
    val emergencyEditId: String,
    val expiresAt: String,
    val version: Int,
)

@Serializable
data class PushSubscriptionRequest(
    val platform: String = "android",
    val endpoint: String,
    val deviceId: String? = null,
    val appVersion: String = "",
)

@Serializable
data class SignResponse(
    val ok: Boolean? = null,
    val documentId: String? = null,
    val signatureId: String? = null,
    val certificate: CertificateDto? = null,
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null,
    val msg: String? = null,
    val details: JsonElement? = null,
    val reference: String? = null,
)

data class SignatureCapture(
    val pngBytes: ByteArray,
    val base64: String,
    val sha256: String,
    val strokes: List<StrokePayload>,
    val method: String,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SignatureCapture) return false
        return sha256 == other.sha256 && method == other.method
    }

    override fun hashCode(): Int = 31 * sha256.hashCode() + method.hashCode()
}
