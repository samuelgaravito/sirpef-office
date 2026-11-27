package ve.gob.mppef.sirpefoffice.firma.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ve.gob.mppef.sirpefoffice.firma.BuildConfig
import ve.gob.mppef.sirpefoffice.firma.ui.LoginStep
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

/**
 * Login diario: cédula/correo, huella (la abre el ViewModel) y TOTP.
 * La cuenta ya está asociada al teléfono, por lo que no se piden contraseñas.
 */
@Composable
fun DailyLoginScreen(
    state: UiState,
    onStart: (String) -> Unit,
    onSubmit: (String?, String?) -> Unit,
    onRecoveryMode: (Boolean) -> Unit,
    onBack: () -> Unit,
) {
    var identifier by rememberSaveable { mutableStateOf(state.loginIdentifier) }
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFF02152E), Ink, InkSoft),
                        ),
                    )
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 24.dp, vertical = 30.dp),
            ) {
                Column {
                    BrandMark(size = 100.dp)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "SirpefOffice",
                        color = White,
                        style = MaterialTheme.typography.displaySmall,
                    )
                    Text(
                        "Bóveda de Firmas",
                        color = Color(0xFFB7CFE6),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Tu teléfono ya está vinculado. Entra con tu cédula o correo, tu huella y el Token.",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 20.dp),
                shape = RoundedCornerShape(28.dp),
                colors = CardDefaults.cardColors(containerColor = White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(Modifier.padding(22.dp)) {
                    LoginStepIndicator(step = state.loginStep)

                    AnimatedContent(
                        targetState = state.loginStep,
                        transitionSpec = {
                            if (targetState.ordinal > initialState.ordinal) {
                                (slideInHorizontally(tween(280)) { it / 4 } + fadeIn(tween(220))) togetherWith
                                    (slideOutHorizontally(tween(220)) { -it / 4 } + fadeOut(tween(160)))
                            } else {
                                (slideInHorizontally(tween(280)) { -it / 4 } + fadeIn(tween(220))) togetherWith
                                    (slideOutHorizontally(tween(220)) { it / 4 } + fadeOut(tween(160)))
                            }
                        },
                        label = "login-diario",
                    ) { step ->
                        when (step) {
                            LoginStep.IDENTIFIER -> IdentifierStep(
                                identifier = identifier,
                                onIdentifierChange = { identifier = it },
                                loading = state.loading,
                                error = state.error,
                                onSubmit = { onStart(identifier) },
                            )

                            LoginStep.TOTP -> TotpStep(
                                state = state,
                                code = code,
                                onCodeChange = {
                                    code = it.filter { ch -> ch.isDigit() }.take(6)
                                },
                                recovery = recovery,
                                onRecoveryChange = {
                                    recovery = it.uppercase()
                                        .filter { ch ->
                                            ch.isLetterOrDigit() || ch == '-' || ch == ' '
                                        }
                                        .take(120)
                                },
                                onSubmit = {
                                    if (state.loginRecoveryMode) {
                                        onSubmit(null, recovery)
                                    } else {
                                        onSubmit(code, null)
                                    }
                                },
                                onBack = onBack,
                                onRecoveryMode = onRecoveryMode,
                            )
                        }
                    }

                }
            }

            Spacer(Modifier.height(18.dp))
            Text(
                "Firma electrónica simple auditada · v${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF667085),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 28.dp),
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun LoginStepIndicator(step: LoginStep) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepDot(number = 1, active = true, done = step == LoginStep.TOTP)
        Box(
            modifier = Modifier
                .weight(1f)
                .height(2.dp)
                .background(if (step == LoginStep.TOTP) BrandMint else Color(0xFFE3E4E8)),
        )
        StepDot(number = 2, active = step == LoginStep.TOTP, done = false)
        Spacer(Modifier.width(12.dp))
        Text(
            if (step == LoginStep.IDENTIFIER) "Paso 1 de 2" else "Paso 2 de 2",
            style = MaterialTheme.typography.labelSmall,
            color = Slate,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun StepDot(number: Int, active: Boolean, done: Boolean) {
    Box(
        modifier = Modifier
            .size(30.dp)
            .background(
                when {
                    done -> BrandMint
                    active -> Indigo
                    else -> Color(0xFFE3E4E8)
                },
                CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            number.toString(),
            color = if (active || done) White else Slate,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun IdentifierStep(
    identifier: String,
    onIdentifierChange: (String) -> Unit,
    loading: Boolean,
    error: String?,
    onSubmit: () -> Unit,
) {
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = {
        keyboard?.hide()
        onSubmit()
    }

    Column {
        Text(
            "Inicia sesión",
            style = MaterialTheme.typography.titleLarge,
            color = Ink,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Escribe la cédula o el correo con el que vinculaste este teléfono.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
        Spacer(Modifier.height(18.dp))

        OutlinedTextField(
            value = identifier,
            onValueChange = onIdentifierChange,
            label = { Text("Cédula o correo") },
            placeholder = { Text("V-12345678 o correo@dominio.com") },
            leadingIcon = {
                Icon(Icons.Outlined.Badge, contentDescription = null)
            },
            singleLine = true,
            shape = RoundedCornerShape(16.dp),
            colors = loginFieldColors(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (identifier.isNotBlank()) submit() }),
            modifier = Modifier
                .fillMaxWidth()
                .bringIntoViewRequester(requester)
                .onFocusChanged {
                    if (it.isFocused) {
                        scope.launch { requester.bringIntoView() }
                    }
                },
            enabled = !loading,
        )

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = Danger, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(18.dp))
        Button(
            onClick = submit,
            enabled = !loading && identifier.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Indigo),
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = White,
                )
            } else {
                Text("Continuar con la huella", fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(10.dp))
        Text(
            "Después de la huella te pediremos el código de 6 dígitos de SirpefOffice Token.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
    }
}

@Composable
private fun TotpStep(
    state: UiState,
    code: String,
    onCodeChange: (String) -> Unit,
    recovery: String,
    onRecoveryChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onRecoveryMode: (Boolean) -> Unit,
) {
    val user = state.loginChallenge?.user
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = {
        keyboard?.hide()
        onSubmit()
    }

    Column {
        Text(
            "Confirma con tu Token",
            style = MaterialTheme.typography.titleLarge,
            color = Ink,
        )
        Spacer(Modifier.height(6.dp))
        if (user != null) {
            Text(
                "Hola, ${user.name}",
                style = MaterialTheme.typography.bodyMedium,
                color = Ink,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                user.email,
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
        Spacer(Modifier.height(14.dp))

        if (state.loginRecoveryMode) {
            Text(
                "Escribe uno de tus códigos de recuperación.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = recovery,
                onValueChange = onRecoveryChange,
                label = { Text("Código de recuperación") },
                placeholder = { Text("perro luna azul sol mar cielo 47") },
                leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null) },
                singleLine = false,
                minLines = 2,
                maxLines = 3,
                shape = RoundedCornerShape(16.dp),
                colors = loginFieldColors(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (recovery.isNotBlank()) submit() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .bringIntoViewRequester(requester)
                    .onFocusChanged {
                        if (it.isFocused) {
                            scope.launch { requester.bringIntoView() }
                        }
                    },
                enabled = !state.loading,
            )
        } else {
            OutlinedTextField(
                value = code,
                onValueChange = onCodeChange,
                label = { Text("Código de 6 dígitos") },
                placeholder = { Text("000000") },
                leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                colors = loginFieldColors(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { if (code.length == 6) submit() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .bringIntoViewRequester(requester)
                    .onFocusChanged {
                        if (it.isFocused) {
                            scope.launch { requester.bringIntoView() }
                        }
                    },
                enabled = !state.loading,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Abre SirpefOffice Token, desbloquéalo con tu huella y copia el código.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(state.error, color = Danger, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(18.dp))
        Button(
            onClick = submit,
            enabled = !state.loading &&
                if (state.loginRecoveryMode) recovery.isNotBlank() else code.length == 6,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Indigo),
        ) {
            if (state.loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = White,
                )
            } else {
                Text("Entrar a la bóveda", fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = { onRecoveryMode(!state.loginRecoveryMode) },
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (state.loginRecoveryMode) {
                    "Usar el código de Token"
                } else {
                    "Usar un código de recuperación"
                },
                color = Indigo,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
            )
        }
        TextButton(
            onClick = onBack,
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Volver", color = Slate)
        }
    }
}

@Composable
private fun loginFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Indigo,
    unfocusedBorderColor = Color(0xFFE3E4E8),
    focusedLabelColor = Indigo,
    cursorColor = Indigo,
    focusedContainerColor = Color(0xFFF7F9FC),
    unfocusedContainerColor = Color(0xFFF7F9FC),
)
