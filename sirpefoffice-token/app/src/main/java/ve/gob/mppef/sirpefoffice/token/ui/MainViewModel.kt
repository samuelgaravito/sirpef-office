package ve.gob.mppef.sirpefoffice.token.ui

import android.os.Build
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import retrofit2.HttpException
import ve.gob.mppef.sirpefoffice.token.BuildConfig
import ve.gob.mppef.sirpefoffice.token.data.ApiFactory
import ve.gob.mppef.sirpefoffice.token.data.AppContainer
import ve.gob.mppef.sirpefoffice.token.data.LocalLoginRequest
import ve.gob.mppef.sirpefoffice.token.data.MobileSvaRequest
import ve.gob.mppef.sirpefoffice.token.data.PairRequest
import ve.gob.mppef.sirpefoffice.token.data.PublicUser
import ve.gob.mppef.sirpefoffice.token.data.RefreshRequest
import ve.gob.mppef.sirpefoffice.token.data.ResetRequest
import ve.gob.mppef.sirpefoffice.token.data.SvaLoginRequest
import ve.gob.mppef.sirpefoffice.token.data.StoredSession
import ve.gob.mppef.sirpefoffice.token.data.TokenKeyInvalidatedException
import ve.gob.mppef.sirpefoffice.token.data.TokenMaterial
import ve.gob.mppef.sirpefoffice.token.data.TokenStatus
import ve.gob.mppef.sirpefoffice.token.data.UnpairRequest
import ve.gob.mppef.sirpefoffice.token.data.Totp
import ve.gob.mppef.sirpefoffice.token.data.toUserMessage

enum class Screen { LOGIN, LINK, TOKEN, PROFILE }

data class UiState(
    val initialized: Boolean = false,
    val screen: Screen = Screen.LOGIN,
    val session: StoredSession? = null,
    val status: TokenStatus? = null,
    val material: TokenMaterial? = null,
    val code: String? = null,
    val remainingSeconds: Int = 30,
    val clockOffsetSeconds: Long = 0,
    val loading: Boolean = false,
    val pairing: Boolean = false,
    val confirmReplace: Boolean = false,
    val pendingCode: String = "",
    val pendingMode: String = "pairing",
    val error: String? = null,
    val info: String? = null,
) {
    val user: PublicUser?
        get() = session?.user
}

class MainViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var ticker: Job? = null
    private var statusJob: Job? = null

    init {
        restoreSession()
    }

    private fun restoreSession() {
        viewModelScope.launch {
            val stored = container.sessionStore.current
            if (stored == null) {
                _state.update {
                    it.copy(
                        initialized = true,
                        screen = Screen.LOGIN,
                    )
                }
                return@launch
            }

            val session = try {
                container.sirpefApi.refresh(RefreshRequest(stored.refreshToken)).also {
                    container.sessionStore.save(it)
                }
            } catch (error: HttpException) {
                if (error.code() == 401) {
                    container.sessionStore.clear()
                    _state.update {
                        it.copy(
                            initialized = true,
                            screen = Screen.LOGIN,
                            session = null,
                            error = "La sesión expiró. Vuelve a iniciar sesión.",
                        )
                    }
                    return@launch
                }
                stored
            } catch (_: Exception) {
                stored
            }

            _state.update { it.copy(session = session, initialized = true) }
            loadStatus(showErrors = false)
        }
    }

    fun login(cedula: String, password: String) {
        if (cedula.isBlank() || password.isBlank()) {
            _state.update { it.copy(error = "Escribe tu cédula y tu contraseña.") }
            return
        }
        if (_state.value.loading) return

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val sva = container.svaApi.loginMobile(
                    SvaLoginRequest(userCedula = cedula.trim(), password = password),
                )
                val svaToken = extractSvaToken(sva.token)
                    ?: throw IllegalStateException(
                        sva.message ?: sva.msg ?: "SVA no devolvió una sesión válida.",
                    )
                val session = container.sirpefApi.exchange(MobileSvaRequest(svaToken))
                container.sessionStore.save(session)
                _state.update { it.copy(session = session, loading = false, error = null) }
                loadStatus(showErrors = true)
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.toUserMessage()) }
            }
        }
    }

    /** Acceso local solo en builds de depuración, para probar sin SVA. */
    fun loginLocal(email: String, password: String) {
        if (!BuildConfig.DEBUG) return
        if (email.isBlank() || password.isBlank()) {
            _state.update { it.copy(error = "Escribe el correo y la contraseña local.") }
            return
        }
        if (_state.value.loading) return

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val session = container.sirpefApi.localLogin(
                    LocalLoginRequest(email = email.trim(), password = password),
                )
                container.sessionStore.save(session)
                _state.update { it.copy(session = session, loading = false, error = null) }
                loadStatus(showErrors = true)
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.toUserMessage()) }
            }
        }
    }

    fun refreshStatus() {
        if (_state.value.session == null) return
        loadStatus(showErrors = true)
    }

    private fun loadStatus(showErrors: Boolean) {
        statusJob?.cancel()
        statusJob = viewModelScope.launch {
            try {
                val status = container.sirpefApi.tokenStatus()
                container.secretStore.saveClock(status.serverTime)
                val savedUpdatedAt = container.secretStore.savedSecretUpdatedAt()
                val savedUserId = container.secretStore.savedUserId()
                val otherUser =
                    container.secretStore.hasSecret() &&
                        !savedUserId.isNullOrBlank() &&
                        savedUserId != _state.value.session?.user?.id
                val localStale =
                    status.paired &&
                        container.secretStore.hasSecret() &&
                        !status.secretUpdatedAt.isNullOrBlank() &&
                        !savedUpdatedAt.isNullOrBlank() &&
                        status.secretUpdatedAt != savedUpdatedAt

                val cleared = !status.paired || otherUser || localStale
                if (cleared) {
                    container.secretStore.clear()
                    ticker?.cancel()
                    ticker = null
                }

                val screen = when {
                    !status.paired -> Screen.LINK
                    otherUser -> Screen.LINK
                    localStale -> Screen.LINK
                    container.secretStore.hasSecret() -> Screen.TOKEN
                    else -> Screen.LINK
                }

                val message = when {
                    otherUser -> "Este teléfono estaba vinculado a otra cuenta. Vincula el Token de esta cuenta."
                    localStale -> "Este teléfono fue reemplazado por otro Token. Vuelve a vincularlo."
                    !status.paired -> null
                    else -> null
                }

                _state.update {
                    it.copy(
                        initialized = true,
                        screen = screen,
                        status = status,
                        material = if (cleared) null else it.material,
                        code = if (cleared) null else it.code,
                        clockOffsetSeconds = container.secretStore.clockOffsetSeconds(),
                        error = message ?: if (showErrors) it.error else null,
                    )
                }
                if (screen == Screen.TOKEN && _state.value.material != null) startTicker()
            } catch (error: HttpException) {
                if (error.code() == 401) {
                    container.sessionStore.clear()
                    _state.update {
                        it.copy(
                            initialized = true,
                            screen = Screen.LOGIN,
                            session = null,
                            error = "La sesión expiró. Vuelve a iniciar sesión.",
                        )
                    }
                    return@launch
                }
                if (showErrors) {
                    _state.update { it.copy(error = error.toUserMessage()) }
                } else {
                    _state.update {
                        it.copy(
                            initialized = true,
                            screen = if (container.secretStore.hasSecret()) Screen.TOKEN else Screen.LINK,
                        )
                    }
                }
            } catch (error: Exception) {
                if (showErrors) {
                    _state.update { it.copy(error = error.toUserMessage()) }
                } else {
                    _state.update {
                        it.copy(
                            initialized = true,
                            screen = if (container.secretStore.hasSecret()) Screen.TOKEN else Screen.LINK,
                        )
                    }
                }
            }
        }
    }

    fun pair(code: String, mode: String, replace: Boolean, activity: FragmentActivity) {
        if (code.isBlank()) {
            _state.update { it.copy(error = "Escribe el código de vinculación.") }
            return
        }
        if (_state.value.pairing) return

        _state.update { it.copy(pairing = true, error = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.pair(
                    PairRequest(
                        mode = mode,
                        code = code.trim(),
                        deviceId = container.sessionStore.deviceId,
                        deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        replace = replace,
                    ),
                )
                val status = response.status ?: _state.value.status
                val material = TokenMaterial(
                    secret = response.secret,
                    userId = _state.value.session?.user?.id.orEmpty(),
                    account = status?.account ?: _state.value.session?.user?.email.orEmpty(),
                    issuer = status?.issuer ?: "SirpefOffice",
                    digits = status?.digits ?: 6,
                    period = status?.period ?: 30,
                    algorithm = status?.algorithm ?: "SHA1",
                    secretUpdatedAt = response.secretUpdatedAt,
                    serverTime = status?.serverTime,
                )
                container.secretStore.save(activity, material)
                container.secretStore.saveClock(status?.serverTime)
                _state.update {
                    it.copy(
                        pairing = false,
                        confirmReplace = false,
                        pendingCode = "",
                        material = material,
                        status = status,
                        screen = Screen.TOKEN,
                        info = "Teléfono vinculado. El código ya está disponible.",
                        error = null,
                    )
                }
                startTicker()
            } catch (error: HttpException) {
                val body = parseError(error)
                if (error.code() == 409 && body?.error == "TOTP_ALREADY_PAIRED") {
                    _state.update {
                        it.copy(
                            pairing = false,
                            confirmReplace = true,
                            pendingCode = code.trim(),
                            pendingMode = mode,
                            error = body?.message
                                ?: "Ya hay un teléfono vinculado. Confirma si deseas reemplazarlo.",
                        )
                    }
                } else {
                    _state.update { it.copy(pairing = false, error = error.toUserMessage()) }
                }
            } catch (error: Exception) {
                _state.update { it.copy(pairing = false, error = error.toUserMessage()) }
            }
        }
    }

    /**
     * Vinculación inicial sin SVA ni contraseña: la app Firma genera el
     * código, aquí se canjea por el secreto y una sesión limitada.
     */
    fun pairWithoutSession(code: String, activity: FragmentActivity, replace: Boolean = false) {
        if (code.isBlank()) {
            _state.update { it.copy(error = "Escribe el código de vinculación.") }
            return
        }
        if (_state.value.pairing) return

        _state.update { it.copy(pairing = true, error = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.pairWithCode(
                    PairRequest(
                        mode = "pairing",
                        code = code.trim(),
                        deviceId = container.sessionStore.deviceId,
                        deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        replace = replace,
                    ),
                )
                val user = response.user
                    ?: throw IllegalStateException("El servidor no devolvió el usuario.")
                val access = response.accessToken
                    ?: throw IllegalStateException("El servidor no devolvió la sesión.")
                val refresh = response.refreshToken
                    ?: throw IllegalStateException("El servidor no devolvió el refresh token.")
                val session = StoredSession(
                    user = user,
                    accessToken = access,
                    refreshToken = refresh,
                    refreshExpiresAt = response.refreshExpiresAt,
                )
                container.sessionStore.save(session)

                val status = response.status
                val material = TokenMaterial(
                    secret = response.secret,
                    userId = user.id,
                    account = status?.account ?: user.email,
                    issuer = status?.issuer ?: "SirpefOffice",
                    digits = status?.digits ?: 6,
                    period = status?.period ?: 30,
                    algorithm = status?.algorithm ?: "SHA1",
                    secretUpdatedAt = response.secretUpdatedAt,
                    serverTime = status?.serverTime,
                )
                container.secretStore.save(activity, material)
                container.secretStore.saveClock(status?.serverTime)

                _state.update {
                    it.copy(
                        pairing = false,
                        confirmReplace = false,
                        pendingCode = "",
                        session = session,
                        material = material,
                        status = status,
                        screen = Screen.TOKEN,
                        info = "Teléfono vinculado. El código ya está disponible.",
                        error = null,
                    )
                }
                startTicker()
            } catch (error: HttpException) {
                val body = parseError(error)
                if (error.code() == 409 && body?.error == "TOTP_ALREADY_PAIRED") {
                    _state.update {
                        it.copy(
                            pairing = false,
                            confirmReplace = true,
                            pendingCode = code.trim(),
                            pendingMode = "pairing",
                            error = body?.message
                                ?: "Ya hay un teléfono vinculado. Confirma si deseas reemplazarlo.",
                        )
                    }
                } else {
                    _state.update { it.copy(pairing = false, error = error.toUserMessage()) }
                }
            } catch (error: Exception) {
                _state.update { it.copy(pairing = false, error = error.toUserMessage()) }
            }
        }
    }

    fun confirmReplace(activity: FragmentActivity) {
        val snapshot = _state.value
        if (snapshot.pendingCode.isBlank()) return
        if (snapshot.session == null) {
            pairWithoutSession(snapshot.pendingCode, activity, replace = true)
        } else {
            pair(snapshot.pendingCode, snapshot.pendingMode, replace = true, activity = activity)
        }
    }

    fun cancelReplace() {
        _state.update {
            it.copy(confirmReplace = false, pendingCode = "", pairing = false, error = null)
        }
    }

    fun unlock(activity: FragmentActivity) {
        if (_state.value.material != null) return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val material = container.secretStore.unlock(activity)
                if (material == null) {
                    _state.update {
                        it.copy(
                            loading = false,
                            screen = Screen.LINK,
                            error = "No hay un Token guardado en este teléfono. Vincúlalo de nuevo.",
                        )
                    }
                    return@launch
                }
                _state.update {
                    it.copy(
                        loading = false,
                        material = material,
                        screen = Screen.TOKEN,
                        error = null,
                    )
                }
                startTicker()
            } catch (error: TokenKeyInvalidatedException) {
                container.secretStore.clear()
                _state.update {
                    it.copy(
                        loading = false,
                        material = null,
                        screen = Screen.LINK,
                        error = error.message,
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.toUserMessage()) }
            }
        }
    }

    /** Al pasar a segundo plano se borra el secreto de memoria. */
    fun lock() {
        ticker?.cancel()
        ticker = null
        _state.update { it.copy(material = null, code = null) }
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = viewModelScope.launch {
            while (isActive) {
                updateCode()
                delay(1_000)
            }
        }
    }

    private fun updateCode() {
        val material = _state.value.material ?: return
        val now = container.secretStore.now()
        val step = Totp.step(now, material.period)
        val code = Totp.code(material.secret, step, material.digits)
        _state.update {
            it.copy(
                code = code,
                remainingSeconds = Totp.remainingSeconds(now, material.period),
                clockOffsetSeconds = container.secretStore.clockOffsetSeconds(),
            )
        }
    }

    fun reset(activity: FragmentActivity) {
        if (_state.value.loading) return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.reset(
                    ResetRequest(
                        deviceId = container.sessionStore.deviceId,
                        deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                    ),
                )
                val previous = _state.value.material
                val material = TokenMaterial(
                    secret = response.secret,
                    userId = _state.value.session?.user?.id.orEmpty(),
                    account = previous?.account ?: _state.value.session?.user?.email.orEmpty(),
                    issuer = previous?.issuer ?: "SirpefOffice",
                    digits = previous?.digits ?: 6,
                    period = previous?.period ?: 30,
                    algorithm = previous?.algorithm ?: "SHA1",
                    secretUpdatedAt = response.secretUpdatedAt,
                    serverTime = _state.value.status?.serverTime,
                )
                try {
                    container.secretStore.save(activity, material)
                } catch (saveError: Exception) {
                    container.secretStore.clear()
                    ticker?.cancel()
                    ticker = null
                    _state.update {
                        it.copy(
                            loading = false,
                            screen = Screen.LINK,
                            material = null,
                            code = null,
                            error = "El Token se restableció en el servidor, pero no se pudo guardar en este teléfono. Vuelve a vincularlo.",
                        )
                    }
                    return@launch
                }
                _state.update {
                    it.copy(
                        loading = false,
                        material = material,
                        info = "Token restablecido. Los códigos anteriores ya no sirven.",
                        error = null,
                    )
                }
                startTicker()
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.toUserMessage()) }
            }
        }
    }

    fun unpair() {
        if (_state.value.loading) return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                container.sirpefApi.unpair(UnpairRequest(container.sessionStore.deviceId))
                container.secretStore.clear()
                lock()
                _state.update {
                    it.copy(
                        loading = false,
                        screen = Screen.LINK,
                        material = null,
                        status = it.status?.copy(paired = false),
                        info = "Teléfono desvinculado. Puedes vincular otro cuando quieras.",
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.toUserMessage()) }
            }
        }
    }

    fun openProfile() {
        _state.update { it.copy(screen = Screen.PROFILE) }
    }

    fun back() {
        if (_state.value.screen == Screen.PROFILE) {
            _state.update {
                it.copy(screen = if (container.secretStore.hasSecret()) Screen.TOKEN else Screen.LINK)
            }
        }
    }

    fun logout() {
        val session = _state.value.session
        statusJob?.cancel()
        lock()
        container.sessionStore.clear()
        _state.value = UiState(initialized = true, screen = Screen.LOGIN)
        if (session != null) {
            viewModelScope.launch {
                runCatching {
                    container.sirpefApi.logout(RefreshRequest(session.refreshToken))
                }
            }
        }
    }

    fun clearMessages() {
        _state.update { it.copy(error = null, info = null) }
    }

    private fun parseError(error: HttpException): ve.gob.mppef.sirpefoffice.token.data.ApiErrorBody? {
        return try {
            val raw = error.response()?.errorBody()?.string() ?: return null
            ApiFactory.json.decodeFromString<ve.gob.mppef.sirpefoffice.token.data.ApiErrorBody>(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun extractSvaToken(element: JsonElement?): String? {
        return when (element) {
            null -> null
            is JsonPrimitive -> element.contentOrNull
            is JsonObject -> {
                element["token"]?.let { return extractSvaToken(it) }
                (element["data"] as? JsonObject)?.get("token")?.let { return extractSvaToken(it) }
                null
            }
            else -> null
        }
    }

    class Factory(private val container: AppContainer) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return MainViewModel(container) as T
        }
    }
}
