package ve.gob.mppef.sirpefoffice.firma.ui

import android.os.Build
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
import ve.gob.mppef.sirpefoffice.firma.data.ApproveAndSignRequest
import ve.gob.mppef.sirpefoffice.firma.data.BiometricException
import ve.gob.mppef.sirpefoffice.firma.data.BootstrapResponse
import ve.gob.mppef.sirpefoffice.firma.data.CertificateDto
import ve.gob.mppef.sirpefoffice.firma.data.ChallengeRequest
import ve.gob.mppef.sirpefoffice.firma.data.ChallengeResponse
import ve.gob.mppef.sirpefoffice.firma.data.CountsDto
import ve.gob.mppef.sirpefoffice.firma.data.DeviceKeyInvalidatedException
import ve.gob.mppef.sirpefoffice.firma.data.LocalLoginRequest
import ve.gob.mppef.sirpefoffice.firma.data.DeviceRequest
import ve.gob.mppef.sirpefoffice.firma.data.MobileDocument
import ve.gob.mppef.sirpefoffice.firma.data.MobileSvaRequest
import ve.gob.mppef.sirpefoffice.firma.data.PublicUser
import ve.gob.mppef.sirpefoffice.firma.data.PushSubscriptionRequest
import ve.gob.mppef.sirpefoffice.firma.data.RefreshRequest
import ve.gob.mppef.sirpefoffice.firma.data.RejectRequest
import ve.gob.mppef.sirpefoffice.firma.data.SignRequest
import ve.gob.mppef.sirpefoffice.firma.data.SignatureCapture
import ve.gob.mppef.sirpefoffice.firma.data.StoredSession
import ve.gob.mppef.sirpefoffice.firma.data.SvaLoginRequest
import ve.gob.mppef.sirpefoffice.firma.data.buildSigningPayload
import ve.gob.mppef.sirpefoffice.firma.data.toUserMessage

enum class Screen { LOGIN, HOME, DOCUMENT, CERTIFICATE, PROFILE }

/** Decisión que el jefe toma antes de firmar un envío pendiente. */
enum class DocumentDecision { NONE, APPROVE, REJECT }

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

    private data class PendingRetry(
        val document: MobileDocument,
        val challenge: ChallengeResponse,
        val capture: SignatureCapture,
    )

    init {
        restoreSession()
    }

    private fun restoreSession() {
        viewModelScope.launch {
            val stored = container.sessionStore.current
            if (stored == null) {
                container.pdfCache.clear()
                _state.update { it.copy(initialized = true, screen = Screen.LOGIN) }
                return@launch
            }

            val session = try {
                container.sirpefApi.refresh(RefreshRequest(stored.refreshToken)).also {
                    container.sessionStore.save(it)
                }
            } catch (error: HttpException) {
                if (error.code() == 401) {
                    container.sessionStore.clear()
                    container.pdfCache.clear()
                    _state.update {
                        it.copy(initialized = true, screen = Screen.LOGIN)
                    }
                    return@launch
                }
                stored
            } catch (_: Exception) {
                stored
            }

            try {
                registerDevice(session)
                loadHome(session)
            } catch (error: Exception) {
                _state.update {
                    it.copy(
                        initialized = true,
                        screen = Screen.LOGIN,
                        error = error.toUserMessage(),
                    )
                }
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
        val bootstrap = container.sirpefApi.bootstrap()
        val updated = session.copy(user = bootstrap.user)
        container.sessionStore.save(updated)

        val documents = container.sirpefApi.documents(
            scope = _state.value.filter.scope,
            query = _state.value.search.ifBlank { null },
            page = 1,
            pageSize = PAGE_SIZE,
        )

        _state.update {
            it.copy(
                initialized = true,
                screen = Screen.HOME,
                session = updated,
                bootstrap = bootstrap,
                documents = documents.items,
                counts = bootstrap.counts,
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
        _state.update { it.copy(screen = Screen.PROFILE) }
    }

    fun selectDocument(document: MobileDocument) {
        retry = null
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
        val snapshot = _state.value
        val document = snapshot.selected ?: return
        if (snapshot.decision != DocumentDecision.APPROVE) {
            _state.update { it.copy(error = "Confirma primero que deseas aprobar el envío.") }
            return
        }
        val capture = snapshot.signature ?: run {
            _state.update { it.copy(error = "Dibuja tu firma antes de continuar.") }
            return
        }
        val session = snapshot.session ?: return
        if (snapshot.signing) return

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

                val response = container.sirpefApi.approveAndSign(
                    messageId = document.id,
                    body = ApproveAndSignRequest(
                        expectedVersion = document.version,
                        challengeId = challenge.challengeId,
                        signaturePng = capture.base64,
                        strokes = capture.strokes,
                        method = capture.method,
                        deviceAssertion = android.util.Base64.encodeToString(
                            assertion,
                            android.util.Base64.NO_WRAP,
                        ),
                    ),
                    deviceId = container.sessionStore.deviceId,
                )

                val certificate = response.certificate
                if (certificate != null) {
                    _state.update {
                        it.copy(
                            signing = false,
                            screen = Screen.CERTIFICATE,
                            certificate = certificate.copy(signaturePng = capture.base64),
                            selected = document.copy(
                                signed = true,
                                status = "sent",
                                docNumber = response.docNumber ?: document.docNumber,
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
        container.sessionStore.clear()
        container.pdfCache.clear()
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
