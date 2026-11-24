package ve.gob.mppef.sirpefoffice.firma.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class BiometricException(message: String) : Exception(message)
class DeviceKeyInvalidatedException : Exception(
    "La clave del dispositivo se invalidó. Vuelve a iniciar sesión para vincularlo de nuevo.",
)

/**
 * Clave EC P-256 por usuario, generada en el Android Keystore y protegida por
 * biometría. La clave privada nunca sale del dispositivo.
 */
class DeviceKeyManager(private val context: Context) {

    fun aliasFor(userId: String): String =
        "sirpef_sign_${userId.replace("-", "").take(16)}"

    fun ensureKeyPair(alias: String): KeyPair {
        val store = loadKeyStore()
        val entry = store.getEntry(alias, null)
        if (entry is KeyStore.PrivateKeyEntry) {
            return KeyPair(entry.certificate.publicKey, entry.privateKey)
        }
        requireStrongBiometric()
        return generate(alias, preferStrongBox = true)
    }

    /**
     * Sin biometría fuerte enrolada el Keystore rechaza crear la clave. Se
     * comprueba antes para dar un mensaje en español en vez del error del sistema.
     */
    private fun requireStrongBiometric() {
        val canUse = BiometricManager.from(context)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        if (canUse != BiometricManager.BIOMETRIC_SUCCESS) {
            throw BiometricException(
                "Este dispositivo no tiene huella ni rostro enrolado. " +
                    "Regístralo en Ajustes para poder firmar.",
            )
        }
    }

    fun publicKeyPem(alias: String): String {
        val publicKey = ensureKeyPair(alias).public
        val encoded = Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
        val wrapped = encoded.chunked(64).joinToString("\n")
        return "-----BEGIN PUBLIC KEY-----\n$wrapped\n-----END PUBLIC KEY-----\n"
    }

    fun delete(alias: String) {
        val store = loadKeyStore()
        if (store.containsAlias(alias)) store.deleteEntry(alias)
    }

    suspend fun signWithBiometric(
        activity: FragmentActivity,
        alias: String,
        payload: ByteArray,
    ): ByteArray {
        requireStrongBiometric()

        val privateKey = try {
            loadKeyStore().getKey(alias, null) as? PrivateKey
                ?: throw DeviceKeyInvalidatedException()
        } catch (_: java.security.UnrecoverableKeyException) {
            throw DeviceKeyInvalidatedException()
        }

        val signature = try {
            Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
        } catch (error: KeyPermanentlyInvalidatedException) {
            throw DeviceKeyInvalidatedException()
        }

        return suspendCancellableCoroutine { continuation ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence,
                    ) {
                        if (!continuation.isCompleted) {
                            continuation.resumeWithException(
                                BiometricException(errString.toString()),
                            )
                        }
                    }

                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult,
                    ) {
                        try {
                            val unlocked = result.cryptoObject?.signature
                                ?: throw BiometricException("No se pudo desbloquear la clave de firma")
                            unlocked.update(payload)
                            val bytes = unlocked.sign()
                            if (!continuation.isCompleted) continuation.resume(bytes)
                        } catch (error: Exception) {
                            if (!continuation.isCompleted) {
                                continuation.resumeWithException(error)
                            }
                        }
                    }

                    override fun onAuthenticationFailed() {
                        // El prompt permite reintentar; no se cierra la corrutina.
                    }
                },
            )

            continuation.invokeOnCancellation { prompt.cancelAuthentication() }

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Confirma tu identidad")
                .setSubtitle("Tu huella desbloquea la clave de firma de SirpefOffice")
                .setNegativeButtonText("Cancelar")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()

            prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
        }
    }

    private fun generate(alias: String, preferStrongBox: Boolean): KeyPair {
        return try {
            val generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                ANDROID_KEYSTORE,
            )
            generator.initialize(spec(alias, preferStrongBox))
            generator.generateKeyPair()
        } catch (error: Exception) {
            val strongBoxFailure = Build.VERSION.SDK_INT >= 28 && (
                error is StrongBoxUnavailableException ||
                    error.cause is StrongBoxUnavailableException
                )
            if (preferStrongBox && strongBoxFailure) {
                generate(alias, preferStrongBox = false)
            } else if (preferStrongBox && Build.VERSION.SDK_INT >= 28) {
                // Algunos fabricantes lanzan ProviderException aunque StrongBox
                // no esté disponible. Se reintenta en TEE antes de fallar.
                try {
                    generate(alias, preferStrongBox = false)
                } catch (_: Exception) {
                    throw error
                }
            } else {
                throw error
            }
        }
    }

    private fun spec(alias: String, strongBox: Boolean): KeyGenParameterSpec {
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= 30) {
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        if (Build.VERSION.SDK_INT >= 28 && strongBox) {
            builder.setIsStrongBoxBacked(true)
        }
        return builder.build()
    }

    private fun loadKeyStore(): KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
    }
}
