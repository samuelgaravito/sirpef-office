package ve.gob.mppef.sirpefoffice.firma.data

import android.os.Build
import kotlinx.serialization.json.JsonElement
import ve.gob.mppef.sirpefoffice.firma.BuildConfig
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import java.util.concurrent.TimeUnit

interface SvaApi {
    @POST("auth/login/mobile")
    suspend fun loginMobile(@Body body: SvaLoginRequest): SvaLoginResponse
}

interface SirpefApi {
    @POST("auth/mobile/local")
    suspend fun localLogin(@Body body: LocalLoginRequest): StoredSession

    @POST("auth/mobile/pair")
    suspend fun pairPreview(@Body body: MobilePairRequest): PairPreviewResponse

    @POST("auth/mobile/pair/confirm")
    suspend fun pairConfirm(@Body body: MobilePairConfirmRequest): StoredSession

    @POST("auth/mobile/login-challenge")
    suspend fun loginChallenge(@Body body: MobileLoginChallengeRequest): MobileLoginChallengeResponse

    @POST("auth/mobile/login")
    suspend fun login(@Body body: MobileLoginRequest): StoredSession

    @POST("auth/mobile/sva")
    suspend fun exchange(@Body body: MobileSvaRequest): StoredSession

    @POST("auth/mobile/refresh")
    suspend fun refresh(@Body body: RefreshRequest): StoredSession

    @POST("auth/mobile/logout")
    suspend fun logout(@Body body: RefreshRequest): JsonElement

    @GET("mobile/bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    @GET("mobile/documents")
    suspend fun documents(
        @Query("scope") scope: String,
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20,
    ): DocumentsResponse

    @GET("documents/{id}/pdf")
    @Streaming
    suspend fun documentPdf(
        @Path("id") documentId: String,
        @Query("sealed") sealed: Int = 0,
    ): okhttp3.ResponseBody

    @POST("mobile/devices")
    suspend fun registerDevice(@Body body: DeviceRequest): DeviceResponse

    @GET("mobile/devices")
    suspend fun devices(): DevicesResponse

    @DELETE("mobile/devices/{id}")
    suspend fun revokeDevice(@Path("id") id: String): JsonElement

    @POST("documents/{id}/sign-challenge")
    suspend fun signChallenge(
        @Path("id") documentId: String,
        @Body body: ChallengeRequest,
    ): ChallengeResponse

    @GET("mobile/token/status")
    suspend fun tokenStatus(): TokenStatus

    @POST("mobile/token/device-challenge")
    suspend fun tokenDeviceChallenge(@Body body: TokenPurposeRequest): DeviceChallengeResponse

    @POST("mobile/token/pairing")
    suspend fun createTokenPairing(@Body body: DeviceProofRequest): PairingCodeResponse

    @POST("mobile/token/recovery-codes")
    suspend fun createRecoveryCodes(@Body body: DeviceProofRequest): RecoveryCodesResponse

    @POST("documents/{id}/sign-authorization")
    suspend fun signAuthorization(
        @Path("id") documentId: String,
        @Body body: SignAuthorizationRequest,
    ): SignAuthorizationResponse

    @POST("mobile/inbox/{id}/reject")
    suspend fun rejectMessage(
        @Path("id") messageId: String,
        @Body body: RejectRequest,
    ): RejectResponse

    @POST("mobile/inbox/{id}/annul")
    suspend fun annulMessage(
        @Path("id") messageId: String,
        @Body body: AnnulRequest,
    ): AnnulResponse

    @POST("documents/{id}/emergency-edit")
    suspend fun startEmergencyEdit(
        @Path("id") documentId: String,
        @Body body: EmergencyEditRequest,
    ): EmergencyEditResponse

    @POST("notifications/subscribe")
    suspend fun registerPushSubscription(
        @Body body: PushSubscriptionRequest,
    ): JsonElement

    @POST("notifications/unsubscribe")
    suspend fun unregisterPushSubscription(
        @Body body: Map<String, String>,
    ): JsonElement

    @POST("inbox/{id}/approve-and-sign")
    suspend fun approveAndSign(
        @Path("id") messageId: String,
        @Body body: ApproveAndSignRequest,
        @Header("X-Device-Id") deviceId: String,
    ): ApproveAndSignResponse

    @POST("documents/{id}/sign")
    suspend fun sign(
        @Path("id") documentId: String,
        @Body body: SignRequest,
        @Header("X-Device-Id") deviceId: String,
    ): SignResponse

    @GET("documents/{id}/certificate")
    suspend fun certificate(@Path("id") documentId: String): CertificateResponse

    @GET("documents/{id}/certificate.pdf")
    @Streaming
    suspend fun certificatePdf(@Path("id") documentId: String): okhttp3.ResponseBody
}

private class SessionInterceptor(
    private val store: SessionStore,
    private val onDeviceRevoked: () -> Unit,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Accept", "application/json")
            .header("X-Client", "sirpefoffice-android")
            .header("X-Device-Id", store.deviceId)
            .header("User-Agent", "SirpefOfficeFirma/${BuildConfig.VERSION_NAME} (${Build.MODEL})")
            .apply {
                store.current?.let { header("Authorization", "Bearer ${it.accessToken}") }
            }
            .build()
        val response = chain.proceed(request)
        if (response.code == 401) {
            val body = runCatching { response.peekBody(4096).string() }.getOrNull()
            if (body?.contains("DEVICE_REVOKED") == true) onDeviceRevoked()
        }
        return response
    }
}

object ApiFactory {
    val json = kotlinx.serialization.json.Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        encodeDefaults = true
    }

    private val contentType = "application/json".toMediaType()

    fun sva(baseUrl: String): SvaApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(logging())
            .build()
        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(SvaApi::class.java)
    }

    fun sirpef(
        baseUrl: String,
        store: SessionStore,
        onDeviceRevoked: () -> Unit = {},
    ): SirpefApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(SessionInterceptor(store, onDeviceRevoked))
            .addInterceptor(logging())
            .build()
        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(SirpefApi::class.java)
    }

    private fun normalizeBaseUrl(value: String): String =
        if (value.endsWith("/")) value else "$value/"

    private fun logging(): HttpLoggingInterceptor =
        HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
}
