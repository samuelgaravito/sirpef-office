package ve.gob.mppef.sirpefoffice.token.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SvaLoginRequest(
    val userCedula: String,
    val password: String,
)

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
data class PairRequest(
    val mode: String = "pairing",
    val code: String,
    val deviceId: String,
    val deviceLabel: String = "",
    val replace: Boolean = false,
)

@Serializable
data class PairResponse(
    val secret: String,
    val secretUpdatedAt: String? = null,
    val status: TokenStatus? = null,
    val user: PublicUser? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val refreshExpiresAt: String? = null,
)

@Serializable
data class UnpairRequest(val deviceId: String)

@Serializable
data class ResetRequest(
    val deviceId: String,
    val deviceLabel: String = "",
)

@Serializable
data class ResetResponse(
    val secret: String,
    val secretUpdatedAt: String? = null,
)

@Serializable
data class TokenMaterial(
    val secret: String,
    val userId: String = "",
    val account: String = "",
    val issuer: String = "SirpefOffice",
    val digits: Int = 6,
    val period: Int = 30,
    val algorithm: String = "SHA1",
    val secretUpdatedAt: String? = null,
    val serverTime: String? = null,
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null,
    val msg: String? = null,
    val details: JsonElement? = null,
    val reference: String? = null,
)
