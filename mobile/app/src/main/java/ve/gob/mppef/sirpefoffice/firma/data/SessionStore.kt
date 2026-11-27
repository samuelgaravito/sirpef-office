package ve.gob.mppef.sirpefoffice.firma.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Guarda la sesión cifrada con una clave AES del Android Keystore. El access
 * token se mantiene en memoria y el refresh queda cifrado en disco.
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val json = ApiFactory.json

    @Volatile
    private var cached: StoredSession? = readFromDisk()

    val current: StoredSession?
        get() = cached

    val deviceId: String
        get() {
            val existing = prefs.getString(KEY_DEVICE_ID, null)
            if (existing != null) return existing
            val created = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, created).apply()
            return created
        }

    /** El teléfono ya fue vinculado; el próximo arranque pide login diario. */
    val enrolled: Boolean
        get() = prefs.getBoolean(KEY_ENROLLED, false)

    /** Correo o cédula que se muestra precargado en el login. */
    val identifier: String
        get() = prefs.getString(KEY_IDENTIFIER, "") ?: ""

    fun saveEnrollment(user: PublicUser) {
        val identifier = user.cedula?.takeIf { it.isNotBlank() } ?: user.email
        prefs.edit()
            .putBoolean(KEY_ENROLLED, true)
            .putString(KEY_IDENTIFIER, identifier)
            .apply()
    }

    /** La web revocó el teléfono: hay que empezar el alta desde cero. */
    fun clearEnrollment() {
        prefs.edit()
            .remove(KEY_ENROLLED)
            .remove(KEY_IDENTIFIER)
            .apply()
    }

    fun save(session: StoredSession) {
        cached = session
        val plain = json.encodeToString(session)
        prefs.edit().putString(KEY_SESSION, encrypt(plain)).apply()
    }

    fun clear() {
        cached = null
        prefs.edit().remove(KEY_SESSION).apply()
    }

    private fun readFromDisk(): StoredSession? {
        val stored = prefs.getString(KEY_SESSION, null) ?: return null
        return try {
            json.decodeFromString<StoredSession>(decrypt(stored))
        } catch (_: Exception) {
            prefs.edit().remove(KEY_SESSION).apply()
            null
        }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val bytes = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size > 12) { "Sesión cifrada inválida" }
        val iv = bytes.copyOfRange(0, 12)
        val ciphertext = bytes.copyOfRange(12, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    private companion object {
        const val PREFS = "sirpefoffice_firma_session"
        const val KEY_SESSION = "session"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_ENROLLED = "enrolled"
        const val KEY_IDENTIFIER = "identifier"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "sirpefoffice_session_aes"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
