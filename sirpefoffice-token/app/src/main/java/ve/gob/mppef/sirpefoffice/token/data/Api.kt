package ve.gob.mppef.sirpefoffice.token.data

import android.os.Build
import kotlinx.serialization.json.JsonElement
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import ve.gob.mppef.sirpefoffice.token.BuildConfig
import java.util.concurrent.TimeUnit

interface SvaApi {
    @POST("auth/login/mobile")
    suspend fun loginMobile(@Body body: SvaLoginRequest): SvaLoginResponse
}

interface SirpefApi {
    @POST("auth/mobile/local")
    suspend fun localLogin(@Body body: LocalLoginRequest): StoredSession

    @POST("auth/mobile/sva")
    suspend fun exchange(@Body body: MobileSvaRequest): StoredSession

    @POST("auth/mobile/refresh")
    suspend fun refresh(@Body body: RefreshRequest): StoredSession

    @POST("auth/mobile/logout")
    suspend fun logout(@Body body: RefreshRequest): JsonElement

    @GET("mobile/token/status")
    suspend fun tokenStatus(): TokenStatus

    @POST("mobile/token/pair")
    suspend fun pair(@Body body: PairRequest): PairResponse

    /** Vinculación sin SVA: el código de Firma resuelve al usuario. */
    @POST("auth/token/pair")
    suspend fun pairWithCode(@Body body: PairRequest): PairResponse

    @POST("mobile/token/reset")
    suspend fun reset(@Body body: ResetRequest): ResetResponse

    @POST("mobile/token/unpair")
    suspend fun unpair(@Body body: UnpairRequest): JsonElement
}

private class SessionInterceptor(
    private val store: SessionStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Accept", "application/json")
            .header("X-Client", "sirpefoffice-token")
            .header("X-Device-Id", store.deviceId)
            .header("User-Agent", "SirpefOfficeToken/${BuildConfig.VERSION_NAME} (${Build.MODEL})")
            .apply {
                store.current?.let { header("Authorization", "Bearer ${it.accessToken}") }
            }
            .build()
        return chain.proceed(request)
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

    fun sirpef(baseUrl: String, store: SessionStore): SirpefApi {
        val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(SessionInterceptor(store))
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
