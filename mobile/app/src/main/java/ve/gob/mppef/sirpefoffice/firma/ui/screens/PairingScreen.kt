package ve.gob.mppef.sirpefoffice.firma.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Shield
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ve.gob.mppef.sirpefoffice.firma.BuildConfig
import ve.gob.mppef.sirpefoffice.firma.ui.PairingStep
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Warning
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

/**
 * Alta del teléfono sin contraseña: la web entrega un código, la app muestra
 * la identidad de SVA y el usuario confirma con su huella.
 */
@Composable
fun PairingScreen(
    state: UiState,
    onPair: (String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onDebugLocalLogin: () -> Unit,
) {
    var code by rememberSaveable { mutableStateOf("") }

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
                        "Vincula este teléfono una sola vez. Después entrarás con tu huella.",
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
                    StepIndicator(state.pairingStep)

                    AnimatedContent(
                        targetState = state.pairingStep,
                        transitionSpec = {
                            if (targetState.ordinal > initialState.ordinal) {
                                (slideInHorizontally(tween(280)) { it / 4 } + fadeIn(tween(220))) togetherWith
                                    (slideOutHorizontally(tween(220)) { -it / 4 } + fadeOut(tween(160)))
                            } else {
                                (slideInHorizontally(tween(280)) { -it / 4 } + fadeIn(tween(220))) togetherWith
                                    (slideOutHorizontally(tween(220)) { it / 4 } + fadeOut(tween(160)))
                            }.using(SizeTransform(clip = false))
                        },
                        label = "paso-vinculacion",
                    ) { step ->
                        when (step) {
                            PairingStep.CODE -> CodeStep(
                                code = code,
                                onCodeChange = {
                                    code = it.uppercase()
                                        .filter { ch -> ch.isLetterOrDigit() || ch == '-' }
                                        .take(12)
                                },
                                loading = state.loading,
                                error = state.error,
                                onSubmit = { onPair(code) },
                                onDebugLocalLogin = onDebugLocalLogin,
                            )

                            PairingStep.CONFIRM -> ConfirmStep(
                                state = state,
                                loading = state.loading,
                                onConfirm = onConfirm,
                                onCancel = onCancel,
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
private fun StepIndicator(step: PairingStep) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepDot(number = 1, active = true, done = step == PairingStep.CONFIRM)
        Box(
            modifier = Modifier
                .weight(1f)
                .height(2.dp)
                .background(if (step == PairingStep.CONFIRM) BrandMint else Color(0xFFE3E4E8)),
        )
        StepDot(number = 2, active = step == PairingStep.CONFIRM, done = false)
        Spacer(Modifier.width(12.dp))
        Text(
            if (step == PairingStep.CODE) "Paso 1 de 2" else "Paso 2 de 2",
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
        if (done) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = null,
                tint = Ink,
                modifier = Modifier.size(18.dp),
            )
        } else {
            Text(
                number.toString(),
                color = if (active) White else Slate,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun CodeStep(
    code: String,
    onCodeChange: (String) -> Unit,
    loading: Boolean,
    error: String?,
    onSubmit: () -> Unit,
    onDebugLocalLogin: () -> Unit,
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
            "Vincula este teléfono",
            style = MaterialTheme.typography.titleLarge,
            color = Ink,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "En la web entra en Ajustes → Dispositivos de firma → Vincular teléfono. " +
                "Copia el código y escríbelo aquí.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
        Spacer(Modifier.height(18.dp))

        OutlinedTextField(
            value = code,
            onValueChange = onCodeChange,
            label = { Text("Código de vinculación") },
            placeholder = { Text("XXXX-XXXX") },
            leadingIcon = {
                Icon(Icons.Outlined.Lock, contentDescription = null)
            },
            singleLine = true,
            shape = RoundedCornerShape(16.dp),
            colors = pairingFieldColors(),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { if (code.isNotBlank()) submit() }),
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
            Text(
                error,
                color = Warning,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Spacer(Modifier.height(18.dp))
        Button(
            onClick = submit,
            enabled = !loading && code.isNotBlank(),
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
                Text("Vincular teléfono", fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(12.dp))
        Text(
            "El código caduca en 15 minutos y solo se puede usar una vez.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )

        if (BuildConfig.DEBUG) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onDebugLocalLogin, modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Acceso local (debug)",
                    color = Indigo,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun ConfirmStep(
    state: UiState,
    loading: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val user = state.pairingPreview?.user
    Column {
        Text(
            "Confirma tu identidad",
            style = MaterialTheme.typography.titleLarge,
            color = Ink,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Estos datos vienen de SVA. Si algo no coincide, no continúes.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
        Spacer(Modifier.height(16.dp))

        if (user == null) {
            Text(
                "No se recibieron los datos de la cuenta. Vuelve a intentarlo.",
                color = Warning,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onCancel) { Text("Volver") }
            return@Column
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(54.dp)
                    .background(Indigo, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    user.name.trim().take(1).uppercase().ifBlank { "?" },
                    color = White,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    user.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = Ink,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    user.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
                Text(
                    if (user.role == "admin") "Administrador" else "Miembro",
                    style = MaterialTheme.typography.labelSmall,
                    color = Indigo,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        IdentityRow("Cédula", user.cedula ?: "No registrada en SVA")
        IdentityRow("Cuenta", user.email)
        IdentityRow("Rol", if (user.role == "admin") "Administrador" else "Miembro")

        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFFE9F1FA), RoundedCornerShape(14.dp))
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.PhoneAndroid,
                contentDescription = null,
                tint = Indigo,
            )
            Spacer(Modifier.width(10.dp))
            Column {
                Text(
                    "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ink,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Será el único teléfono autorizado para firmar. Si ya tenías otro, se desactivará.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFFE7F4E8), RoundedCornerShape(14.dp))
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Shield,
                contentDescription = null,
                tint = Color(0xFF028D05),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "La clave privada se guarda en este teléfono y solo se abre con tu huella.",
                style = MaterialTheme.typography.bodySmall,
                color = Ink,
            )
        }

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                state.error,
                color = Warning,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Spacer(Modifier.height(18.dp))
        Button(
            onClick = onConfirm,
            enabled = !loading,
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
                Text("Confirmar y vincular", fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onCancel,
            enabled = !loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Volver", color = Slate)
        }
    }
}

@Composable
private fun IdentityRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Slate)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = Ink,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun pairingFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Indigo,
    unfocusedBorderColor = Color(0xFFE3E4E8),
    focusedLabelColor = Indigo,
    cursorColor = Indigo,
    focusedContainerColor = Color(0xFFF7F9FC),
    unfocusedContainerColor = Color(0xFFF7F9FC),
)
