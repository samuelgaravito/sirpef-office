package ve.gob.mppef.sirpefoffice.token.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ve.gob.mppef.sirpefoffice.token.ui.UiState
import ve.gob.mppef.sirpefoffice.token.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.token.ui.theme.Background
import ve.gob.mppef.sirpefoffice.token.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.token.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.token.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.token.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.token.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.token.ui.theme.White

/**
 * Primera pantalla de la app Token: se vincula con el código que muestra la
 * app Firma. No pide SVA, usuario ni contraseña.
 */
@Composable
fun TokenPairLoginScreen(
    state: UiState,
    onPair: (String) -> Unit,
    onConfirmReplace: () -> Unit,
    onCancelReplace: () -> Unit,
) {
    var code by rememberSaveable { mutableStateOf("") }
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = {
        keyboard?.hide()
        onPair(code)
    }

    Box(Modifier.fillMaxSize().background(Background)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(bottom = 28.dp),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF02152E), Ink, InkSoft)))
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 24.dp, vertical = 30.dp),
            ) {
                Column {
                    BrandMark(size = 100.dp)
                    Spacer(Modifier.height(18.dp))
                    Text(
                        "Vincula tu Token",
                        color = White,
                        style = MaterialTheme.typography.displaySmall,
                    )
                    Text(
                        "Token de autorización",
                        color = Color(0xFFB7CFE6),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "El código de 6 dígitos que autoriza el sellado de tus documentos.",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Card(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 20.dp),
                shape = RoundedCornerShape(26.dp),
                colors = CardDefaults.cardColors(containerColor = White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(Modifier.padding(22.dp)) {
                    Icon(
                        Icons.Outlined.Key,
                        contentDescription = null,
                        tint = Indigo,
                        modifier = Modifier.height(30.dp),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Este teléfono aún no está vinculado",
                        style = MaterialTheme.typography.titleLarge,
                        color = Ink,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Abre SirpefOffice Firma y continúa el onboarding. Allí verás un código de vinculación; escríbelo aquí.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(18.dp))

                    OutlinedTextField(
                        value = code,
                        onValueChange = {
                            code = it.uppercase()
                                .filter { ch -> ch.isLetterOrDigit() || ch == '-' }
                                .take(40)
                        },
                        label = { Text("Código de vinculación") },
                        placeholder = { Text("ABCD-EFGH") },
                        leadingIcon = {
                            Icon(Icons.Outlined.AutoAwesome, contentDescription = null)
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = { if (code.isNotBlank()) submit() },
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .bringIntoViewRequester(requester)
                            .onFocusChanged {
                                if (it.isFocused) {
                                    scope.launch { requester.bringIntoView() }
                                }
                            },
                        enabled = !state.pairing,
                    )
                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = submit,
                        enabled = !state.pairing && code.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                    ) {
                        if (state.pairing) {
                            CircularProgressIndicator(
                                modifier = Modifier.height(20.dp),
                                strokeWidth = 2.dp,
                                color = White,
                            )
                        } else {
                            Text("Vincular este teléfono", fontWeight = FontWeight.Bold)
                        }
                    }

                    if (state.error != null) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            state.error,
                            color = Danger,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }

                    Spacer(Modifier.height(12.dp))
                    Text(
                        "El código caduca en 5 minutos y solo se puede usar una vez.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }
        }
    }

    if (state.confirmReplace) {
        AlertDialog(
            onDismissRequest = onCancelReplace,
            title = { Text("Ya hay un Token vinculado") },
            text = {
                Text(
                    "Al vincular este teléfono, el Token anterior dejará de funcionar. ¿Deseas continuar?",
                )
            },
            confirmButton = {
                TextButton(onClick = onConfirmReplace) {
                    Text("Reemplazar Token", color = Indigo, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = onCancelReplace) {
                    Text("Cancelar", color = Slate)
                }
            },
        )
    }
}
