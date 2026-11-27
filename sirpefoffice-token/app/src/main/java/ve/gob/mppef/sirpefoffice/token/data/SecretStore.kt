package ve.gob.mppef.sirpefoffice.token.data

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.security.UnrecoverableKeyException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class BiometricException(message: String) : Exception(message)

class TokenKeyInvalidatedException : Exception(
    "La protección biométrica cambió. Vuelve a vincular SirpefOffice Token.",
)

/**
 * Guarda el secreto TOTP con una clave AES del Keystore que exige biometría
 * fuerte o credencial del dispositivo para cada operación. El secreto nunca
 * se escribe en claro ni se comparte entre aplicaciones.
 */
class SecretStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val json = ApiFactory.json

    fun hasSecret(): Boolean = prefs.getString(KEY_MATERIAL, null) != null

    fun savedSecretUpdatedAt(): String? = prefs.getString(KEY_SECRET_UPDATED, null)

    fun savedUserId(): String? = prefs.getString(KEY_USER_ID, null)

    fun clear() {
        prefs.edit()
            .remove(KEY_MATERIAL)
            .remove(KEY_SECRET_UPDATED)
            .remove(KEY_USER_ID)
            .remove(KEY_SERVER_EPOCH_MS)
            .remove(KEY_ELAPSED_AT_SYNC)
            .apply()
        runCatching {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
        }
    }

    /** Guarda el secreto recién recibido y pide biometría para cifrarlo. */
    suspend fun save(activity: FragmentActivity, material: TokenMaterial) {
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.ENCRYPT_MODE, secretKey())
            }
        } catch (error: Exception) {
            if (error is KeyPermanentlyInvalidatedException || error is UnrecoverableKeyException) {
                clear()
                throw TokenKeyInvalidatedException()
            }
            throw error
        }
        val unlocked = authenticate(activity, cipher, "Protege tu SirpefOffice Token")
        val bytes = unlocked.iv + unlocked.doFinal(json.encodeToString(material).toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString(KEY_MATERIAL, Base64.encodeToString(bytes, Base64.NO_WRAP))
            .putString(KEY_SECRET_UPDATED, material.secretUpdatedAt ?: "")
            .putString(KEY_USER_ID, material.userId)
            .apply()
        saveClock(material.serverTime)
    }

    /** Descifra el secreto tras validar la biometría. */
    suspend fun unlock(activity: FragmentActivity): TokenMaterial? {
        val stored = prefs.getString(KEY_MATERIAL, null) ?: return null
        val bytes = try {
            Base64.decode(stored, Base64.NO_WRAP)
        } catch (_: Exception) {
            clear()
            return null
        }
        require(bytes.size > 12) { "Token almacenado inválido" }
        val iv = bytes.copyOfRange(0, 12)
        val ciphertext = bytes.copyOfRange(12, bytes.size)
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            }
        } catch (error: Exception) {
            if (error is KeyPermanentlyInvalidatedException || error is UnrecoverableKeyException) {
                clear()
                throw TokenKeyInvalidatedException()
            }
            throw error
        }
        val unlocked = authenticate(activity, cipher, "Desbloquea SirpefOffice Token")
        return try {
            json.decodeFromString<TokenMaterial>(
                String(unlocked.doFinal(ciphertext), Charsets.UTF_8),
            )
        } catch (_: Exception) {
            clear()
            throw TokenKeyInvalidatedException()
        }
    }

    /** Hora corregida con el ancla del servidor y el reloj monotónico. */
    fun now(): Long {
        val serverEpoch = prefs.getLong(KEY_SERVER_EPOCH_MS, 0L)
        val elapsed = prefs.getLong(KEY_ELAPSED_AT_SYNC, 0L)
        val currentElapsed = SystemClock.elapsedRealtime()
        // Si elapsedRealtime es menor, el teléfono se reinició: el ancla ya no sirve.
        if (serverEpoch <= 0L || elapsed <= 0L || currentElapsed < elapsed) {
            return System.currentTimeMillis()
        }
        return serverEpoch + (currentElapsed - elapsed)
    }

    fun saveClock(serverTime: String?) {
        val value = serverTime ?: return
        val epoch = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull() ?: return
        prefs.edit()
            .putLong(KEY_SERVER_EPOCH_MS, epoch)
            .putLong(KEY_ELAPSED_AT_SYNC, SystemClock.elapsedRealtime())
            .apply()
    }

    fun clockOffsetSeconds(): Long =
        (now() - System.currentTimeMillis()) / 1000

    private suspend fun authenticate(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
    ): Cipher = suspendCancellableCoroutine { continuation ->
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!continuation.isCompleted) {
                        continuation.resumeWithException(BiometricException(errString.toString()))
                    }
                }

                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val unlocked = result.cryptoObject?.cipher
                    if (unlocked == null) {
                        if (!continuation.isCompleted) {
                            continuation.resumeWithException(
                                BiometricException("No se pudo desbloquear el token"),
                            )
                        }
                    } else if (!continuation.isCompleted) {
                        continuation.resume(unlocked)
                    }
                }

                override fun onAuthenticationFailed() {
                    // El prompt permite reintentar; no se cierra la corrutina.
                }
            },
        )

        continuation.invokeOnCancellation { prompt.cancelAuthentication() }

        val builder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Tu identidad protege el código de autorización")
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL,
            )
        } else {
            builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            builder.setNegativeButtonText("Cancelar")
        }

        prompt.authenticate(builder.build(), BiometricPrompt.CryptoObject(cipher))
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= 30) {
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (Build.VERSION.SDK_INT >= 28) {
            builder.setUnlockedDeviceRequired(true)
        }

        generator.init(builder.build())
        return generator.generateKey()
    }

    private companion object {
        const val PREFS = "sirpefoffice_token_secret"
        const val KEY_MATERIAL = "material"
        const val KEY_SECRET_UPDATED = "secret_updated_at"
        const val KEY_USER_ID = "user_id"
        const val KEY_SERVER_EPOCH_MS = "server_epoch_ms"
        const val KEY_ELAPSED_AT_SYNC = "elapsed_at_sync"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "sirpefoffice_token_secret_aes"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
