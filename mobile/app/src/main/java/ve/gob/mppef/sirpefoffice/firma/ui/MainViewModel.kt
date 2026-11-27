package ve.gob.mppef.sirpefoffice.firma.ui

import android.os.Build
import android.os.SystemClock
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import ve.gob.mppef.sirpefoffice.firma.BuildConfig
import ve.gob.mppef.sirpefoffice.firma.data.ApiErrorBody
import ve.gob.mppef.sirpefoffice.firma.data.ApiFactory
import ve.gob.mppef.sirpefoffice.firma.data.AppContainer
import ve.gob.mppef.sirpefoffice.firma.data.AnnulRequest
import ve.gob.mppef.sirpefoffice.firma.data.ApproveAndSignRequest
import ve.gob.mppef.sirpefoffice.firma.data.BiometricException
import ve.gob.mppef.sirpefoffice.firma.data.BootstrapResponse
import ve.gob.mppef.sirpefoffice.firma.data.CertificateDto
import ve.gob.mppef.sirpefoffice.firma.data.ChallengeRequest
import ve.gob.mppef.sirpefoffice.firma.data.ChallengeResponse
import ve.gob.mppef.sirpefoffice.firma.data.CountsDto
import ve.gob.mppef.sirpefoffice.firma.data.DeviceKeyInvalidatedException
import ve.gob.mppef.sirpefoffice.firma.data.DeviceChallengeResponse
import ve.gob.mppef.sirpefoffice.firma.data.DeviceProofRequest
import ve.gob.mppef.sirpefoffice.firma.data.LocalLoginRequest
import ve.gob.mppef.sirpefoffice.firma.data.DeviceRequest
import ve.gob.mppef.sirpefoffice.firma.data.EmergencyEditRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobileDocument
import ve.gob.mppef.sirpefoffice.firma.data.MobileLoginChallengeRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobileLoginChallengeResponse
import ve.gob.mppef.sirpefoffice.firma.data.MobileLoginRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobilePairConfirmRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobilePairRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobileSvaRequest
import ve.gob.mppef.sirpefoffice.firma.data.PairPreviewResponse
import ve.gob.mppef.sirpefoffice.firma.data.PairingCodeResponse
import ve.gob.mppef.sirpefoffice.firma.data.PublicUser
import ve.gob.mppef.sirpefoffice.firma.data.PushSubscriptionRequest
import ve.gob.mppef.sirpefoffice.firma.data.RecoveryCodesResponse
import ve.gob.mppef.sirpefoffice.firma.data.RefreshRequest
import ve.gob.mppef.sirpefoffice.firma.data.RejectRequest
import ve.gob.mppef.sirpefoffice.firma.data.SignAuthorizationRequest
import ve.gob.mppef.sirpefoffice.firma.data.SignRequest
import ve.gob.mppef.sirpefoffice.firma.data.SignatureCapture
import ve.gob.mppef.sirpefoffice.firma.data.StoredSession
import ve.gob.mppef.sirpefoffice.firma.data.SvaLoginRequest
import ve.gob.mppef.sirpefoffice.firma.data.TokenPurposeRequest
import ve.gob.mppef.sirpefoffice.firma.data.TokenStatus
import ve.gob.mppef.sirpefoffice.firma.data.buildLoginPayload
import ve.gob.mppef.sirpefoffice.firma.data.buildPairingPayload
import ve.gob.mppef.sirpefoffice.firma.data.buildSigningPayload
import ve.gob.mppef.sirpefoffice.firma.data.buildTotpDevicePayload
import ve.gob.mppef.sirpefoffice.firma.data.toUserMessage

enum class Screen { LOGIN, POST_PAIRING, HOME, DOCUMENT, CERTIFICATE, PROFILE }

/** Pasos del alta sin contraseña: código de la web y confirmación de identidad. */
enum class PairingStep { CODE, CONFIRM }

/** Pasos del login diario: identificador y código TOTP. */
enum class LoginStep { IDENTIFIER, TOTP }

/** Decisión que el jefe toma antes de firmar un envío pendiente. */
enum class DocumentDecision { NONE, APPROVE, REJECT }

/** Acción que se está autorizando con el código de SirpefOffice Token. */
enum class TotpAction { SIGN, ANNUL, EMERGENCY }

/** Documentos por página en la bandeja móvil. */
private const val PAGE_SIZE = 20

enum class DocumentFilter(val label: String, val scope: String) {
    ALL("Todos", "all"),
    PENDING("Por firmar", "pending"),
    RECEIVED("Recibidos", "received"),
    SIGNED("Listos", "signed"),
}

data class UiState(
    val initialized: Boolean = false,
    val screen: Screen = Screen.LOGIN,
    val vaultOpening: Boolean = false,
    val enrolled: Boolean = false,
    val loginStep: LoginStep = LoginStep.IDENTIFIER,
    val loginIdentifier: String = "",
    val loginChallenge: MobileLoginChallengeResponse? = null,
    val loginAssertion: String? = null,
    val loginRecoveryMode: Boolean = false,
    val pairingStep: PairingStep = PairingStep.CODE,
    val pairingPreview: PairPreviewResponse? = null,
    val session: StoredSession? = null,
    val bootstrap: BootstrapResponse? = null,
    val documents: List<MobileDocument> = emptyList(),
    val counts: CountsDto = CountsDto(),
    val filter: DocumentFilter = DocumentFilter.ALL,
    val search: String = "",
    val page: Int = 1,
    val pageSize: Int = PAGE_SIZE,
    val total: Int = 0,
    val loading: Boolean = false,
    val pageLoading: Boolean = false,
    val signing: Boolean = false,
    val selected: MobileDocument? = null,
    val pdfPages: List<ImageBitmap> = emptyList(),
    val pdfLoading: Boolean = false,
    val signature: SignatureCapture? = null,
    val certificate: CertificateDto? = null,
    val pendingRetry: Boolean = false,
    val decision: DocumentDecision = DocumentDecision.NONE,
    val rejectReason: String = "",
    val allowEdit: Boolean = true,
    val annulReason: String = "",
    val emergencyReason: String = "",
    val tokenStatus: TokenStatus? = null,
    val awaitingTotp: Boolean = false,
    val totpAction: TotpAction = TotpAction.SIGN,
    val totpSubmitting: Boolean = false,
    val totpError: String? = null,
    val totpPrefill: String? = null,
    val totpPrefillRemaining: Int? = null,
    val pairingCode: String? = null,
    val pairingExpiresAt: String? = null,
    val recoveryCodes: List<String> = emptyList(),
    val tokenBusy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
) {
    val user: PublicUser?
        get() = session?.user ?: bootstrap?.user

    val pageCount: Int
        get() = maxOf(1, (total + pageSize - 1) / pageSize)
}

class MainViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var searchJob: Job? = null
    private var retry: PendingRetry? = null
    private var pdfRequestId = 0
    private var documentsRequestId = 0
    private var realtimeRefreshJob: Job? = null
    private var pendingMessageId: String? = null
    private var pendingDocumentId: String? = null
    private var pendingLookupTried = false
    private var pendingApproval: PendingApproval? = null
    private var pendingAnnulReason: String? = null
    private var pendingEmergencyReason: String? = null
    private var deferredTotp: DeferredTotp? = null

    private data class PendingRetry(
        val document: MobileDocument,
        val challenge: ChallengeResponse,
        val capture: SignatureCapture,
        val authorized: Boolean = true,
    )

    private data class PendingApproval(
        val document: MobileDocument,
        val challenge: ChallengeResponse,
        val capture: SignatureCapture,
        val deviceAssertion: String,
        val signOnly: Boolean = false,
    )

    private data class DeferredTotp(
        val code: String,
        val receivedAtElapsed: Long,
        val remainingSeconds: Int,
    )

    init {
        restoreSession()
        viewModelScope.launch {
            container.deviceRevoked.collect { handleDeviceRevoked() }
        }
    }

    /** La web revocó el teléfono: se borra la sesión y vuelve el alta. */
    private fun handleDeviceRevoked() {
        if (!_state.value.enrolled && _state.value.session == null) return
        container.realtimeClient.close()
        container.sessionStore.clear()
        container.sessionStore.clearEnrollment()
        container.pdfCache.clear()
        _state.value = UiState(
            initialized = true,
            screen = Screen.LOGIN,
            enrolled = false,
            error = "Este teléfono fue desvinculado. Pide un nuevo código en la web.",
        )
    }

    private fun isDeviceRevoked(error: Exception): Boolean {
        val http = error as? HttpException ?: return false
        if (http.code() != 401) return false
        return parseError(http)?.error == "DEVICE_REVOKED"
    }

    private fun restoreSession() {
        viewModelScope.launch {
            container.pdfCache.clear()
            val enrolled = container.sessionStore.enrolled
            val identifier = container.sessionStore.identifier
            _state.update {
                it.copy(
                    initialized = true,
                    screen = Screen.LOGIN,
                    enrolled = enrolled,
                    loginStep = LoginStep.IDENTIFIER,
                    loginIdentifier = identifier,
                    pairingStep = PairingStep.CODE,
                    pairingPreview = null,
                )
            }
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
                registerDevice(session)
                loadHome(session)
            } catch (error: Exception) {
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
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
                registerDevice(session)
                loadHome(session)
            } catch (error: Exception) {
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
            }
        }
    }

    /**
     * Alta sin contraseña: canjea el código que generó la web por el perfil
     * del usuario. El código todavía no se consume; eso ocurre al confirmar.
     */
    fun pair(code: String) {
        if (code.isBlank()) {
            _state.update { it.copy(error = "Escribe el código de vinculación.") }
            return
        }
        if (_state.value.loading) return

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val preview = container.sirpefApi.pairPreview(
                    MobilePairRequest(
                        code = code.trim(),
                        deviceId = container.sessionStore.deviceId,
                    ),
                )
                _state.update {
                    it.copy(
                        loading = false,
                        pairingStep = PairingStep.CONFIRM,
                        pairingPreview = preview,
                        error = null,
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(
                        loading = false,
                        pairingStep = PairingStep.CODE,
                        pairingPreview = null,
                        error = error.toUserMessage(),
                    )
                }
            }
        }
    }

    /**
     * Confirma el alta: crea la clave EC del teléfono, la desbloquea con
     * biometría, firma el payload de vinculación y registra el dispositivo.
     */
    fun confirmPairing(activity: FragmentActivity) {
        val preview = _state.value.pairingPreview ?: return
        if (_state.value.loading) return

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val alias = container.deviceKeyManager.aliasFor(preview.user.id)
                val publicKey = container.deviceKeyManager.publicKeyPem(alias)
                val payload = buildPairingPayload(
                    preview.pairToken,
                    container.sessionStore.deviceId,
                )
                val signature = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(Charsets.UTF_8),
                )
                val session = container.sirpefApi.pairConfirm(
                    MobilePairConfirmRequest(
                        pairToken = preview.pairToken,
                        deviceId = container.sessionStore.deviceId,
                        publicKey = publicKey,
                        deviceAssertion = Base64.encodeToString(signature, Base64.NO_WRAP),
                        model = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
                container.sessionStore.save(session)
                container.sessionStore.saveEnrollment(session.user)
                _state.update {
                    it.copy(
                        initialized = true,
                        screen = Screen.POST_PAIRING,
                        session = session,
                        enrolled = true,
                        loading = false,
                        error = null,
                        pairingStep = PairingStep.CODE,
                        pairingPreview = null,
                        pairingCode = null,
                        pairingExpiresAt = null,
                        recoveryCodes = emptyList(),
                        tokenStatus = null,
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(
                        loading = false,
                        error = error.toUserMessage(),
                    )
                }
            }
        }
    }

    fun cancelPairing() {
        _state.update {
            it.copy(
                pairingStep = PairingStep.CODE,
                pairingPreview = null,
                loading = false,
                error = null,
            )
        }
    }

    /** Atajo de desarrollo para no quedar bloqueado si falla la vinculación. */
    fun debugLocalLogin() {
        if (!BuildConfig.DEBUG) return
        loginLocal("admin@sirpefoffice.local", "sirpefoffice")
    }

    /**
     * Login diario, paso 1: valida el identificador y firma el desafío con la
     * clave del teléfono. Después la UI pide el código TOTP.
     */
    fun startDailyLogin(identifier: String, activity: FragmentActivity) {
        val trimmed = identifier.trim()
        if (trimmed.isBlank()) {
            _state.update { it.copy(error = "Escribe tu cédula o correo.") }
            return
        }
        if (_state.value.loading) return

        _state.update {
            it.copy(
                loading = true,
                error = null,
                loginIdentifier = trimmed,
                loginRecoveryMode = false,
            )
        }
        viewModelScope.launch {
            try {
                val challenge = container.sirpefApi.loginChallenge(
                    MobileLoginChallengeRequest(
                        identifier = trimmed,
                        deviceId = container.sessionStore.deviceId,
                    ),
                )
                val alias = container.deviceKeyManager.aliasFor(challenge.user.id)
                val payload = buildLoginPayload(
                    challenge.nonce,
                    container.sessionStore.deviceId,
                    challenge.identifier,
                )
                val signature = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(Charsets.UTF_8),
                )
                _state.update {
                    it.copy(
                        loading = false,
                        loginStep = LoginStep.TOTP,
                        loginChallenge = challenge,
                        loginAssertion = Base64.encodeToString(signature, Base64.NO_WRAP),
                        loginIdentifier = challenge.identifier,
                        error = null,
                    )
                }
                if (!challenge.requiresTotp) {
                    submitDailyLogin(null, null)
                }
            } catch (error: Exception) {
                if (isDeviceRevoked(error)) {
                    handleDeviceRevoked()
                    return@launch
                }
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
            }
        }
    }

    /** Login diario, paso 2: TOTP o código de recuperación. */
    fun submitDailyLogin(code: String?, recoveryCode: String? = null) {
        val challenge = _state.value.loginChallenge ?: return
        val assertion = _state.value.loginAssertion ?: return
        if (_state.value.loading) return
        if (
            challenge.requiresTotp &&
            code.isNullOrBlank() &&
            recoveryCode.isNullOrBlank()
        ) {
            _state.update { it.copy(error = "Escribe el código de SirpefOffice Token.") }
            return
        }

        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val session = container.sirpefApi.login(
                    MobileLoginRequest(
                        challengeToken = challenge.challengeToken,
                        deviceId = container.sessionStore.deviceId,
                        identifier = challenge.identifier,
                        deviceAssertion = assertion,
                        code = code?.trim()?.takeIf { it.isNotBlank() },
                        recoveryCode = recoveryCode?.trim()?.takeIf { it.isNotBlank() },
                    ),
                )
                container.sessionStore.save(session)
                loadHome(session)
            } catch (error: Exception) {
                if (isDeviceRevoked(error)) {
                    handleDeviceRevoked()
                    return@launch
                }
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
            }
        }
    }

    fun setLoginRecoveryMode(enabled: Boolean) {
        _state.update { it.copy(loginRecoveryMode = enabled, error = null) }
    }

    fun cancelDailyLogin() {
        _state.update {
            it.copy(
                loginStep = LoginStep.IDENTIFIER,
                loginChallenge = null,
                loginAssertion = null,
                loginRecoveryMode = false,
                error = null,
            )
        }
    }

    /** Cierra la animación de la puerta de la bóveda. */
    fun onVaultOpened() {
        _state.update { it.copy(vaultOpening = false) }
    }

    /** Sale del onboarding de Token y carga la bandeja. */
    fun finishPostPairing() {
        val session = _state.value.session ?: return
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            try {
                loadHome(session)
            } catch (error: Exception) {
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
            }
        }
    }

    private suspend fun registerDevice(session: StoredSession): Boolean {
        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        val publicKey = try {
            container.deviceKeyManager.publicKeyPem(alias)
        } catch (error: BiometricException) {
            // Sin biometría enrolada no se puede crear la clave de firma, pero la
            // sesión sigue siendo válida: se puede consultar y falta enrolarla.
            _state.update { it.copy(info = error.toUserMessage()) }
            return false
        }
        container.sirpefApi.registerDevice(
            DeviceRequest(
                deviceId = container.sessionStore.deviceId,
                publicKey = publicKey,
                model = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        return true
    }

    private suspend fun loadHome(session: StoredSession) {
        container.sessionStore.saveEnrollment(session.user)
        val bootstrap = container.sirpefApi.bootstrap()
        val updated = session.copy(user = bootstrap.user)
        container.sessionStore.save(updated)

        val documents = container.sirpefApi.documents(
            scope = _state.value.filter.scope,
            query = _state.value.search.ifBlank { null },
            page = 1,
            pageSize = PAGE_SIZE,
        )
        val tokenStatus = runCatching { container.sirpefApi.tokenStatus() }.getOrNull()

        _state.update {
            it.copy(
                initialized = true,
                screen = Screen.HOME,
                vaultOpening = true,
                enrolled = true,
                loginStep = LoginStep.IDENTIFIER,
                loginChallenge = null,
                loginAssertion = null,
                loginRecoveryMode = false,
                pairingStep = PairingStep.CODE,
                pairingPreview = null,
                pairingCode = null,
                pairingExpiresAt = null,
                recoveryCodes = emptyList(),
                session = updated,
                bootstrap = bootstrap,
                documents = documents.items,
                counts = bootstrap.counts,
                tokenStatus = tokenStatus ?: it.tokenStatus,
                page = 1,
                pageSize = documents.pageSize ?: PAGE_SIZE,
                total = documents.total ?: documents.items.size,
                loading = false,
                pageLoading = false,
                error = null,
            )
        }

        startRealtime()
        registerPushToken()
        openPendingIfReady()
    }

    /** Registra el token FCM; sin google-services.json falla en silencio. */
    private fun registerPushToken() {
        viewModelScope.launch(Dispatchers.IO) {
            val token = runCatching {
                Tasks.await(FirebaseMessaging.getInstance().token)
            }.getOrNull() ?: return@launch
            runCatching {
                container.sirpefApi.registerPushSubscription(
                    PushSubscriptionRequest(
                        endpoint = token,
                        deviceId = container.sessionStore.deviceId,
                        appVersion = BuildConfig.VERSION_NAME,
                    ),
                )
            }
        }
    }

    /** Al volver del segundo plano: reconecta el canal y refresca la bandeja. */
    fun onAppResume() {
        if (_state.value.session == null) return
        refreshTokenStatus()
        container.realtimeClient.close()
        startRealtime()
        viewModelScope.launch {
            refreshDocumentsQuiet()
            refreshBootstrapQuiet()
        }
    }

    /** Abre un documento tras pulsar una notificación (app cerrada o segundo plano). */
    fun openFromNotification(documentId: String?, messageId: String?) {
        pendingDocumentId = documentId
        pendingMessageId = messageId
        pendingLookupTried = false
        openPendingIfReady()
    }

    private fun openPendingIfReady() {
        val messageId = pendingMessageId
        val documentId = pendingDocumentId
        if (messageId == null && documentId == null) return
        val item = _state.value.documents.firstOrNull {
            (messageId != null && it.id == messageId) ||
                (documentId != null && it.documentId == documentId)
        }
        if (item != null) {
            pendingMessageId = null
            pendingDocumentId = null
            pendingLookupTried = false
            selectDocument(item)
            return
        }
        if (!pendingLookupTried && _state.value.session != null) {
            pendingLookupTried = true
            // La notificación puede ser de un recibido mientras el filtro
            // estaba en «Por firmar»: se vuelve a «Todos» antes de buscar.
            _state.update { it.copy(filter = DocumentFilter.ALL, page = 1) }
            loadDocuments(1, fullLoading = true, refreshCounts = true)
        }
    }

    /**
     * Escucha la bandeja mientras la app está abierta. Los documentos nuevos
     * aparecen sin pulsar «actualizar»; con la app cerrada el aviso llega por FCM.
     */
    private fun startRealtime() {
        container.realtimeClient.connect { text ->
            val type = runCatching {
                ApiFactory.json.parseToJsonElement(text)
                    .jsonObject["type"]
                    ?.jsonPrimitive
                    ?.contentOrNull
            }.getOrNull() ?: return@connect

            if (type == "mobile.device.revoked") {
                viewModelScope.launch { handleDeviceRevoked() }
                return@connect
            }

            val relevant = type == "connection.ready" ||
                type.startsWith("inbox.") ||
                type.startsWith("document.")
            if (!relevant) return@connect

            realtimeRefreshJob?.cancel()
            realtimeRefreshJob = viewModelScope.launch {
                if (type != "connection.ready") delay(250)
                refreshDocumentsQuiet()
                refreshBootstrapQuiet()
                if (type == "inbox.message.created" || type == "inbox.message.pending") {
                    _state.update {
                        if (it.info == null) it.copy(info = "Tienes un documento nuevo en la bandeja.") else it
                    }
                }
            }
        }
    }

    private suspend fun refreshBootstrapQuiet() {
        runCatching { container.sirpefApi.bootstrap() }.getOrNull()?.let { bootstrap ->
            container.sessionStore.save(
                (_state.value.session ?: return@let).copy(user = bootstrap.user),
            )
            _state.update { it.copy(counts = bootstrap.counts) }
        }
    }

    fun setFilter(filter: DocumentFilter) {
        if (_state.value.filter == filter) return
        _state.update { it.copy(filter = filter, page = 1) }
        loadDocuments(1, fullLoading = true, refreshCounts = true)
    }

    fun setSearch(value: String) {
        _state.update { it.copy(search = value, page = 1) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(350)
            loadDocuments(1, fullLoading = true, refreshCounts = true)
        }
    }

    /** Recarga la página actual (botón de actualizar). */
    fun refreshDocuments() {
        loadDocuments(_state.value.page, fullLoading = true, refreshCounts = true)
    }

    /** Navegación numerada: carga una página concreta sin recargar los contadores. */
    fun goToPage(page: Int) {
        val snapshot = _state.value
        val target = page.coerceIn(1, snapshot.pageCount)
        if (target == snapshot.page && !snapshot.pageLoading) return
        loadDocuments(target, fullLoading = false)
    }

    private fun loadDocuments(
        page: Int,
        fullLoading: Boolean,
        refreshCounts: Boolean = false,
    ) {
        val requestId = ++documentsRequestId
        val previousPage = _state.value.page
        _state.update {
            it.copy(
                page = page,
                loading = fullLoading,
                pageLoading = !fullLoading,
                error = null,
            )
        }

        viewModelScope.launch {
            try {
                val snapshot = _state.value
                val response = container.sirpefApi.documents(
                    scope = snapshot.filter.scope,
                    query = snapshot.search.ifBlank { null },
                    page = page,
                    pageSize = snapshot.pageSize,
                )
                if (requestId != documentsRequestId) return@launch

                val bootstrap = if (refreshCounts) {
                    runCatching { container.sirpefApi.bootstrap() }.getOrNull()
                } else {
                    null
                }
                if (requestId != documentsRequestId) return@launch

                val pageSize = response.pageSize ?: snapshot.pageSize
                val total = response.total
                    ?: ((page - 1) * pageSize + response.items.size)

                _state.update {
                    it.copy(
                        documents = response.items,
                        page = page,
                        pageSize = pageSize,
                        total = total,
                        counts = bootstrap?.counts ?: it.counts,
                        loading = false,
                        pageLoading = false,
                    )
                }
            } catch (error: Exception) {
                if (requestId != documentsRequestId) return@launch
                _state.update {
                    it.copy(
                        page = previousPage,
                        loading = false,
                        pageLoading = false,
                        error = error.toUserMessage(),
                    )
                }
            }
        }
    }

    fun openProfile() {
        refreshTokenStatus()
        _state.update { it.copy(screen = Screen.PROFILE) }
    }

    fun refreshTokenStatus() {
        if (_state.value.session == null) return
        viewModelScope.launch {
            runCatching { container.sirpefApi.tokenStatus() }
                .onSuccess { status -> _state.update { it.copy(tokenStatus = status) } }
        }
    }

    /** La app Firma genera el código de vinculación para la app Token. */
    fun startTokenPairing(activity: FragmentActivity) {
        val session = _state.value.session ?: return
        if (_state.value.tokenBusy) return
        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        _state.update { it.copy(tokenBusy = true, error = null, info = null) }
        viewModelScope.launch {
            try {
                val challenge = container.sirpefApi.tokenDeviceChallenge(
                    TokenPurposeRequest("pairing"),
                )
                val payload = buildTotpDevicePayload("pairing", challenge.nonce)
                val assertion = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(),
                )
                val response: PairingCodeResponse = container.sirpefApi.createTokenPairing(
                    DeviceProofRequest(
                        nonce = challenge.nonce,
                        deviceAssertion = android.util.Base64.encodeToString(
                            assertion,
                            android.util.Base64.NO_WRAP,
                        ),
                    ),
                )
                _state.update {
                    it.copy(
                        tokenBusy = false,
                        pairingCode = response.code,
                        pairingExpiresAt = response.expiresAt,
                        recoveryCodes = emptyList(),
                        info = "Código de vinculación generado.",
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(tokenBusy = false, error = error.toUserMessage()) }
            }
        }
    }

    /** Genera los códigos de recuperación; se muestran una sola vez. */
    fun generateRecoveryCodes(activity: FragmentActivity) {
        val session = _state.value.session ?: return
        if (_state.value.tokenBusy) return
        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        _state.update { it.copy(tokenBusy = true, error = null, info = null) }
        viewModelScope.launch {
            try {
                val challenge = container.sirpefApi.tokenDeviceChallenge(
                    TokenPurposeRequest("recovery"),
                )
                val payload = buildTotpDevicePayload("recovery", challenge.nonce)
                val assertion = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(),
                )
                val response: RecoveryCodesResponse = container.sirpefApi.createRecoveryCodes(
                    DeviceProofRequest(
                        nonce = challenge.nonce,
                        deviceAssertion = android.util.Base64.encodeToString(
                            assertion,
                            android.util.Base64.NO_WRAP,
                        ),
                    ),
                )
                _state.update {
                    it.copy(
                        tokenBusy = false,
                        pairingCode = null,
                        pairingExpiresAt = null,
                        recoveryCodes = response.codes,
                        info = "Códigos de recuperación generados. Guárdalos en un lugar seguro.",
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(tokenBusy = false, error = error.toUserMessage()) }
            }
        }
    }

    fun clearTokenDialogs() {
        _state.update {
            it.copy(pairingCode = null, pairingExpiresAt = null, recoveryCodes = emptyList())
        }
    }

    fun selectDocument(document: MobileDocument) {
        retry = null
        pendingApproval = null
        refreshTokenStatus()
        val requestId = ++pdfRequestId
        _state.update {
            it.copy(
                screen = Screen.DOCUMENT,
                selected = document,
                pdfPages = emptyList(),
                pdfLoading = true,
                signature = null,
                certificate = null,
                pendingRetry = false,
                decision = DocumentDecision.NONE,
                rejectReason = "",
                allowEdit = true,
                awaitingTotp = false,
                totpSubmitting = false,
                totpError = null,
                totpPrefill = null,
                totpPrefillRemaining = null,
                error = null,
            )
        }

        viewModelScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    container.pdfCache.download(
                        container.sirpefApi,
                        document.documentId,
                        document.signed,
                    )
                }
                val pages = withContext(Dispatchers.IO) {
                    container.pdfCache.render(file)
                }
                if (requestId == pdfRequestId) {
                    _state.update { it.copy(pdfPages = pages, pdfLoading = false) }
                }
            } catch (error: Exception) {
                if (requestId == pdfRequestId) {
                    _state.update {
                        it.copy(pdfLoading = false, error = error.toUserMessage())
                    }
                }
            }
        }
    }

    fun openCertificate() {
        val document = _state.value.selected ?: return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.certificate(document.documentId)
                _state.update {
                    it.copy(
                        screen = Screen.CERTIFICATE,
                        certificate = response.certificate.copy(signaturePng = response.signaturePng),
                        loading = false,
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(loading = false, error = error.toUserMessage())
                }
            }
        }
    }

    fun setSignature(capture: SignatureCapture) {
        _state.update { it.copy(signature = capture) }
    }

    fun clearSignature() {
        _state.update { it.copy(signature = null) }
    }

    /** El usuario decide si aprueba (y firma) o rechaza antes de ver la firma. */
    fun chooseDecision(decision: DocumentDecision) {
        _state.update {
            it.copy(
                decision = decision,
                signature = if (decision == DocumentDecision.APPROVE) it.signature else null,
                error = null,
            )
        }
    }

    fun setRejectReason(value: String) {
        _state.update { it.copy(rejectReason = value, error = null) }
    }

    fun setAllowEdit(value: Boolean) {
        _state.update { it.copy(allowEdit = value) }
    }

    /** Devuelve el envío al asistente con el mismo flujo que la web. */
    fun rejectDocument() {
        val snapshot = _state.value
        val document = snapshot.selected ?: return
        val reason = snapshot.rejectReason.trim()
        if (reason.isEmpty()) {
            _state.update { it.copy(error = "Escribe el motivo del rechazo.") }
            return
        }
        if (snapshot.signing) return

        _state.update { it.copy(signing = true, error = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.rejectMessage(
                    messageId = document.id,
                    body = RejectRequest(reason = reason, allowEdit = snapshot.allowEdit),
                )
                _state.update {
                    it.copy(
                        signing = false,
                        screen = Screen.HOME,
                        selected = null,
                        decision = DocumentDecision.NONE,
                        rejectReason = "",
                        info = if (response.allowEdit) {
                            "Envío devuelto. El asistente podrá corregirlo y reenviarlo."
                        } else {
                            "Envío rechazado. El documento quedó bloqueado."
                        },
                    )
                }
                refreshDocumentsQuiet()
            } catch (error: HttpException) {
                val body = parseError(error)
                _state.update {
                    it.copy(
                        signing = false,
                        error = body?.message ?: body?.msg ?: error.toUserMessage(),
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(signing = false, error = error.toUserMessage()) }
            }
        }
    }

    fun approveAndSign(activity: FragmentActivity) {
        if (_state.value.decision != DocumentDecision.APPROVE) {
            _state.update { it.copy(error = "Confirma primero que deseas aprobar el envío.") }
            return
        }
        startSigning(activity, signOnly = false)
    }

    /** Completa la firma de un documento ya aprobado que quedó sin certificado. */
    fun signApproved(activity: FragmentActivity) {
        startSigning(activity, signOnly = true)
    }

    private fun startSigning(activity: FragmentActivity, signOnly: Boolean) {
        val snapshot = _state.value
        val document = snapshot.selected ?: return
        val capture = snapshot.signature ?: run {
            _state.update { it.copy(error = "Dibuja tu firma antes de continuar.") }
            return
        }
        val session = snapshot.session ?: return
        if (snapshot.signing) return
        if (snapshot.tokenStatus?.paired == false) {
            _state.update {
                it.copy(
                    error = "Configura SirpefOffice Token desde Identidad y dispositivo antes de firmar.",
                )
            }
            return
        }

        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        _state.update { it.copy(signing = true, error = null) }

        viewModelScope.launch {
            var currentChallenge: ChallengeResponse? = null
            try {
                val challenge = container.sirpefApi.signChallenge(
                    document.documentId,
                    ChallengeRequest(document.id),
                )
                currentChallenge = challenge
                val payload = buildSigningPayload(
                    challengeId = challenge.challengeId,
                    documentId = document.documentId,
                    messageId = document.id,
                    version = challenge.version,
                    contentSha256 = challenge.contentSha256,
                    signatureSha256 = capture.sha256,
                )
                val assertion = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(),
                )
                pendingApproval = PendingApproval(
                    document = document,
                    challenge = challenge,
                    capture = capture,
                    deviceAssertion = android.util.Base64.encodeToString(
                        assertion,
                        android.util.Base64.NO_WRAP,
                    ),
                    signOnly = signOnly,
                )
                val deferred = takeDeferredTotp()
                _state.update {
                    it.copy(
                        signing = false,
                        awaitingTotp = true,
                        totpAction = TotpAction.SIGN,
                        totpSubmitting = false,
                        totpError = null,
                        totpPrefill = deferred?.first,
                        totpPrefillRemaining = deferred?.second,
                        error = null,
                    )
                }
            } catch (error: HttpException) {
                val body = parseError(error)
                val approved = isApprovedButUnsigned(body)
                if (approved && currentChallenge != null) {
                    retry = PendingRetry(document, currentChallenge, capture)
                }
                _state.update {
                    it.copy(
                        signing = false,
                        pendingRetry = approved && currentChallenge != null,
                        error = if (approved) {
                            "El documento quedó aprobado, pero no se pudo estampar la firma. Reintenta el sellado."
                        } else {
                            body?.message ?: body?.msg ?: error.toUserMessage()
                        },
                    )
                }
            } catch (error: DeviceKeyInvalidatedException) {
                recoverDeviceKey(session)
                _state.update {
                    it.copy(
                        signing = false,
                        error = "La clave del dispositivo se renovó. Confirma la firma otra vez.",
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(signing = false, error = error.toUserMessage())
                }
            }
        }
    }

    /** Segundo paso: el usuario introduce el código de SirpefOffice Token. */
    fun submitTotp(code: String) {
        when (_state.value.totpAction) {
            TotpAction.SIGN -> submitSignTotp(code)
            TotpAction.ANNUL -> submitAnnulTotp(code)
            TotpAction.EMERGENCY -> submitEmergencyTotp(code)
        }
    }

    private fun submitSignTotp(code: String) {
        val pending = pendingApproval ?: return
        val clean = code.filter { it.isDigit() }
        if (clean.length != 6) {
            _state.update { it.copy(totpError = "Escribe los 6 dígitos de SirpefOffice Token.") }
            return
        }
        if (_state.value.totpSubmitting) return

        _state.update { it.copy(totpSubmitting = true, totpError = null) }
        viewModelScope.launch {
            try {
                val authorization = container.sirpefApi.signAuthorization(
                    documentId = pending.document.documentId,
                    body = SignAuthorizationRequest(
                        messageId = pending.document.id,
                        challengeId = pending.challenge.challengeId,
                        code = clean,
                        signatureSha256 = pending.capture.sha256,
                        deviceAssertion = pending.deviceAssertion,
                    ),
                )
                if (!authorization.authorized) {
                    throw IllegalStateException("El servidor no autorizó la firma.")
                }
                pendingApproval = null
                _state.update {
                    it.copy(
                        awaitingTotp = false,
                        totpSubmitting = false,
                        totpError = null,
                        signing = true,
                    )
                }
                completeApproval(pending)
            } catch (error: HttpException) {
                val body = parseError(error)
                val message = body?.message ?: body?.msg ?: error.toUserMessage()
                val retryable = body?.error in setOf(
                    "TOTP_INVALID",
                    "TOTP_REPLAY",
                    "TOTP_LOCKED",
                )
                if (retryable) {
                    _state.update {
                        it.copy(totpSubmitting = false, totpError = message)
                    }
                } else {
                    pendingApproval = null
                    _state.update {
                        it.copy(
                            awaitingTotp = false,
                            totpSubmitting = false,
                            totpError = null,
                            error = message,
                        )
                    }
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(totpSubmitting = false, totpError = error.toUserMessage())
                }
            }
        }
    }

    fun cancelTotp() {
        pendingApproval = null
        pendingAnnulReason = null
        pendingEmergencyReason = null
        deferredTotp = null
        _state.update {
            it.copy(
                awaitingTotp = false,
                totpAction = TotpAction.SIGN,
                totpSubmitting = false,
                totpError = null,
                totpPrefill = null,
                totpPrefillRemaining = null,
            )
        }
    }

    fun setAnnulReason(value: String) {
        _state.update { it.copy(annulReason = value, error = null) }
    }

    fun setEmergencyReason(value: String) {
        _state.update { it.copy(emergencyReason = value, error = null) }
    }

    /** Abre el diálogo de Token para anular un documento aprobado. */
    fun startAnnul() {
        val document = _state.value.selected ?: return
        if (!document.canAnnul) {
            _state.update { it.copy(error = "Este documento no se puede anular.") }
            return
        }
        val reason = _state.value.annulReason.trim()
        pendingAnnulReason = reason.ifEmpty { null }
        pendingApproval = null
        pendingEmergencyReason = null
        val deferred = takeDeferredTotp()
        _state.update {
            it.copy(
                awaitingTotp = true,
                totpAction = TotpAction.ANNUL,
                totpSubmitting = false,
                totpError = null,
                totpPrefill = deferred?.first,
                totpPrefillRemaining = deferred?.second,
                error = null,
            )
        }
    }

    /** Abre el diálogo de Token para autorizar una edición de emergencia. */
    fun startEmergencyEdit() {
        val document = _state.value.selected ?: return
        if (!document.canEmergencyEdit) {
            _state.update { it.copy(error = "No puedes autorizar una edición de emergencia.") }
            return
        }
        val reason = _state.value.emergencyReason.trim()
        if (reason.length < 10) {
            _state.update {
                it.copy(error = "Explica el motivo de la edición de emergencia (mínimo 10 caracteres).")
            }
            return
        }
        pendingEmergencyReason = reason
        pendingApproval = null
        pendingAnnulReason = null
        val deferred = takeDeferredTotp()
        _state.update {
            it.copy(
                awaitingTotp = true,
                totpAction = TotpAction.EMERGENCY,
                totpSubmitting = false,
                totpError = null,
                totpPrefill = deferred?.first,
                totpPrefillRemaining = deferred?.second,
                error = null,
            )
        }
    }

    private fun submitAnnulTotp(code: String) {
        val document = _state.value.selected ?: return
        val reason = pendingAnnulReason
        val clean = code.filter { it.isDigit() }
        if (clean.length != 6) {
            _state.update { it.copy(totpError = "Escribe los 6 dígitos de SirpefOffice Token.") }
            return
        }
        if (_state.value.totpSubmitting) return

        _state.update { it.copy(totpSubmitting = true, totpError = null) }
        viewModelScope.launch {
            try {
                container.sirpefApi.annulMessage(
                    messageId = document.id,
                    body = AnnulRequest(
                        reason = reason,
                        expectedVersion = document.version,
                        code = clean,
                    ),
                )
                pendingAnnulReason = null
                _state.update {
                    it.copy(
                        awaitingTotp = false,
                        totpAction = TotpAction.SIGN,
                        totpSubmitting = false,
                        totpError = null,
                        annulReason = "",
                        selected = it.selected?.copy(
                            status = "cancelled",
                            documentStatus = "cancelled",
                            annulled = true,
                            canAnnul = false,
                            canSign = false,
                            canEmergencyEdit = false,
                        ),
                        info = "Documento anulado. Conserva su número y su sello.",
                    )
                }
                refreshDocumentsQuiet()
            } catch (error: HttpException) {
                val body = parseError(error)
                _state.update {
                    it.copy(
                        totpSubmitting = false,
                        totpError = body?.message ?: body?.msg ?: error.toUserMessage(),
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(totpSubmitting = false, totpError = error.toUserMessage())
                }
            }
        }
    }

    private fun submitEmergencyTotp(code: String) {
        val document = _state.value.selected ?: return
        val reason = pendingEmergencyReason ?: return
        val clean = code.filter { it.isDigit() }
        if (clean.length != 6) {
            _state.update { it.copy(totpError = "Escribe los 6 dígitos de SirpefOffice Token.") }
            return
        }
        if (_state.value.totpSubmitting) return

        _state.update { it.copy(totpSubmitting = true, totpError = null) }
        viewModelScope.launch {
            try {
                val response = container.sirpefApi.startEmergencyEdit(
                    documentId = document.documentId,
                    body = EmergencyEditRequest(
                        reason = reason,
                        expectedVersion = document.version,
                        code = clean,
                    ),
                )
                pendingEmergencyReason = null
                _state.update {
                    it.copy(
                        awaitingTotp = false,
                        totpAction = TotpAction.SIGN,
                        totpSubmitting = false,
                        totpError = null,
                        emergencyReason = "",
                        selected = it.selected?.copy(canEmergencyEdit = false),
                        info = "Edición autorizada hasta ${response.expiresAt}. Abre la web para editar el documento.",
                    )
                }
            } catch (error: HttpException) {
                val body = parseError(error)
                _state.update {
                    it.copy(
                        totpSubmitting = false,
                        totpError = body?.message ?: body?.msg ?: error.toUserMessage(),
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(totpSubmitting = false, totpError = error.toUserMessage())
                }
            }
        }
    }

    /**
     * Código recibido desde SirpefOffice Token por Intent. Solo rellena el
     * campo: la autorización real la sigue validando el backend.
     */
    fun receiveExternalTotp(code: String, remainingSeconds: Int) {
        val clean = code.filter { it.isDigit() }.take(6)
        if (clean.length != 6) return
        val remaining = remainingSeconds.coerceIn(0, 300)
        if (_state.value.awaitingTotp) {
            _state.update {
                it.copy(
                    totpPrefill = clean,
                    totpPrefillRemaining = remaining,
                    totpError = null,
                )
            }
        } else {
            deferredTotp = DeferredTotp(
                code = clean,
                receivedAtElapsed = SystemClock.elapsedRealtime(),
                remainingSeconds = remaining,
            )
            _state.update {
                it.copy(info = "Código recibido desde SirpefOffice Token. Se usará al firmar.")
            }
        }
    }

    fun clearTotpPrefill() {
        _state.update { it.copy(totpPrefill = null, totpPrefillRemaining = null) }
    }

    private fun takeDeferredTotp(): Pair<String, Int>? {
        val deferred = deferredTotp ?: return null
        deferredTotp = null
        val ageMs = SystemClock.elapsedRealtime() - deferred.receivedAtElapsed
        if (ageMs > 25_000) return null
        val remaining = (deferred.remainingSeconds - ageMs / 1000).toInt().coerceAtLeast(0)
        if (remaining <= 1) return null
        return deferred.code to remaining
    }

    private suspend fun completeApproval(pending: PendingApproval) {
        try {
            val certificate: CertificateDto?
            val docNumber: String?
            if (pending.signOnly) {
                val response = container.sirpefApi.sign(
                    documentId = pending.document.documentId,
                    body = SignRequest(
                        messageId = pending.document.id,
                        challengeId = pending.challenge.challengeId,
                        signaturePng = pending.capture.base64,
                        strokes = pending.capture.strokes,
                        method = pending.capture.method,
                        deviceAssertion = pending.deviceAssertion,
                    ),
                    deviceId = container.sessionStore.deviceId,
                )
                certificate = response.certificate
                docNumber = pending.document.docNumber
            } else {
                val response = container.sirpefApi.approveAndSign(
                    messageId = pending.document.id,
                    body = ApproveAndSignRequest(
                        expectedVersion = pending.document.version,
                        challengeId = pending.challenge.challengeId,
                        signaturePng = pending.capture.base64,
                        strokes = pending.capture.strokes,
                        method = pending.capture.method,
                        deviceAssertion = pending.deviceAssertion,
                    ),
                    deviceId = container.sessionStore.deviceId,
                )
                certificate = response.certificate
                docNumber = response.docNumber ?: pending.document.docNumber
            }

            if (certificate != null) {
                _state.update {
                    it.copy(
                        signing = false,
                        screen = Screen.CERTIFICATE,
                        certificate = certificate.copy(signaturePng = pending.capture.base64),
                        selected = pending.document.copy(
                            signed = true,
                            status = "sent",
                            needsSignature = false,
                            docNumber = docNumber,
                            certificateSerial = certificate.serial,
                        ),
                        info = "Firma estampada y documento sellado.",
                    )
                }
                refreshDocumentsQuiet()
            } else {
                _state.update {
                    it.copy(
                        signing = false,
                        error = "El servidor no devolvió el certificado de la firma.",
                    )
                }
            }
        } catch (error: HttpException) {
            val body = parseError(error)
            val approved = isApprovedButUnsigned(body)
            if (approved) {
                retry = PendingRetry(
                    pending.document,
                    pending.challenge,
                    pending.capture,
                    authorized = true,
                )
            }
            _state.update {
                it.copy(
                    signing = false,
                    pendingRetry = approved,
                    error = if (approved) {
                        "El documento quedó aprobado, pero no se pudo estampar la firma. Reintenta el sellado."
                    } else {
                        body?.message ?: body?.msg ?: error.toUserMessage()
                    },
                )
            }
        } catch (error: Exception) {
            _state.update { it.copy(signing = false, error = error.toUserMessage()) }
        }
    }

    private suspend fun recoverDeviceKey(session: StoredSession) {
        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        container.deviceKeyManager.delete(alias)
        runCatching { registerDevice(session) }
    }

    fun retrySign(activity: FragmentActivity) {
        val pending = retry ?: return
        val session = _state.value.session ?: return
        if (_state.value.signing) return
        val alias = container.deviceKeyManager.aliasFor(session.user.id)
        _state.update { it.copy(signing = true, error = null) }

        viewModelScope.launch {
            try {
                val payload = buildSigningPayload(
                    challengeId = pending.challenge.challengeId,
                    documentId = pending.document.documentId,
                    messageId = pending.document.id,
                    version = pending.challenge.version,
                    contentSha256 = pending.challenge.contentSha256,
                    signatureSha256 = pending.capture.sha256,
                )
                val assertion = container.deviceKeyManager.signWithBiometric(
                    activity,
                    alias,
                    payload.toByteArray(),
                )
                val response = container.sirpefApi.sign(
                    documentId = pending.document.documentId,
                    body = SignRequest(
                        messageId = pending.document.id,
                        challengeId = pending.challenge.challengeId,
                        signaturePng = pending.capture.base64,
                        strokes = pending.capture.strokes,
                        method = pending.capture.method,
                        deviceAssertion = android.util.Base64.encodeToString(
                            assertion,
                            android.util.Base64.NO_WRAP,
                        ),
                    ),
                    deviceId = container.sessionStore.deviceId,
                )
                val certificate = response.certificate
                if (certificate != null) {
                    retry = null
                    _state.update {
                        it.copy(
                            signing = false,
                            screen = Screen.CERTIFICATE,
                            certificate = certificate.copy(signaturePng = pending.capture.base64),
                            selected = pending.document.copy(
                                signed = true,
                                status = "sent",
                                certificateSerial = certificate.serial,
                            ),
                            info = "Firma completada.",
                        )
                    }
                    refreshDocumentsQuiet()
                } else {
                    _state.update {
                        it.copy(signing = false, error = "No se pudo completar la firma.")
                    }
                }
            } catch (error: HttpException) {
                if (error.code() == 409) {
                    retry = null
                }
                _state.update {
                    it.copy(
                        signing = false,
                        pendingRetry = retry != null,
                        error = if (error.code() == 409) {
                            "El desafío expiró o el documento cambió. Vuelve a abrir el documento y firma de nuevo."
                        } else {
                            error.toUserMessage()
                        },
                    )
                }
            } catch (error: DeviceKeyInvalidatedException) {
                recoverDeviceKey(session)
                _state.update {
                    it.copy(
                        signing = false,
                        error = "La clave del dispositivo se renovó. Confirma la firma otra vez.",
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(signing = false, error = error.toUserMessage())
                }
            }
        }
    }

    private fun refreshDocumentsQuiet() {
        val requestId = ++documentsRequestId
        viewModelScope.launch {
            try {
                val snapshot = _state.value
                var page = snapshot.page
                var response = container.sirpefApi.documents(
                    scope = snapshot.filter.scope,
                    query = snapshot.search.ifBlank { null },
                    page = page,
                    pageSize = snapshot.pageSize,
                )
                if (requestId != documentsRequestId) return@launch

                val pageSize = response.pageSize ?: snapshot.pageSize
                var total = response.total
                    ?: ((page - 1) * pageSize + response.items.size)
                val pageCount = maxOf(1, (total + pageSize - 1) / pageSize)

                // Si la firma vació la última página, se retrocede una.
                if (page > pageCount) {
                    page = pageCount
                    response = container.sirpefApi.documents(
                        scope = snapshot.filter.scope,
                        query = snapshot.search.ifBlank { null },
                        page = page,
                        pageSize = pageSize,
                    )
                    if (requestId != documentsRequestId) return@launch
                    total = response.total ?: total
                }

                val bootstrap = runCatching { container.sirpefApi.bootstrap() }.getOrNull()
                if (requestId != documentsRequestId) return@launch

                _state.update {
                    it.copy(
                        documents = response.items,
                        page = page,
                        pageSize = pageSize,
                        total = total,
                        counts = bootstrap?.counts ?: it.counts,
                    )
                }
            } catch (_: Exception) {
                // La lista se actualizará al volver al inicio.
            }
        }
    }

    fun back() {
        retry = null
        pendingApproval = null
        pdfRequestId++
        when (_state.value.screen) {
            Screen.CERTIFICATE -> {
                _state.update {
                    it.copy(
                        screen = if (it.selected != null) Screen.DOCUMENT else Screen.HOME,
                        certificate = null,
                    )
                }
            }
            Screen.DOCUMENT, Screen.PROFILE -> {
                _state.update {
                    it.copy(
                        screen = Screen.HOME,
                        selected = null,
                        certificate = null,
                        pdfPages = emptyList(),
                        signature = null,
                        pendingRetry = false,
                        awaitingTotp = false,
                        totpError = null,
                        totpPrefill = null,
                        totpPrefillRemaining = null,
                    )
                }
            }
            else -> Unit
        }
    }

    fun logout() {
        searchJob?.cancel()
        pdfRequestId++
        documentsRequestId++
        val session = _state.value.session
        retry = null
        val enrolled = container.sessionStore.enrolled
        val identifier = container.sessionStore.identifier
        container.sessionStore.clear()
        container.pdfCache.clear()
        _state.value = UiState(
            initialized = true,
            screen = Screen.LOGIN,
            enrolled = enrolled,
            loginStep = LoginStep.IDENTIFIER,
            loginIdentifier = identifier,
        )
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

    private fun isApprovedButUnsigned(body: ApiErrorBody?): Boolean {
        val details = body?.details?.jsonObject ?: return false
        return details["approved"]?.jsonPrimitive?.booleanOrNull == true
    }

    private fun parseError(error: HttpException): ApiErrorBody? {
        return try {
            val raw = error.response()?.errorBody()?.string() ?: return null
            ApiFactory.json.decodeFromString<ApiErrorBody>(raw)
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
