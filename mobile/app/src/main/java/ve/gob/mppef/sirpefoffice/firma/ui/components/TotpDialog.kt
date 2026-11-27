package ve.gob.mppef.sirpefoffice.firma.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink

private const val TOKEN_PACKAGE = "ve.gob.mppef.sirpefoffice.token"

/**
 * Diálogo que aparece después de la biometría y antes de sellar. El código lo
 * genera SirpefOffice Token; la app de firma no conoce el secreto TOTP.
 */
@Composable
fun TotpDialog(
    submitting: Boolean,
    error: String?,
    title: String = "Autoriza el sellado",
    message: String = "Abre SirpefOffice Token e introduce el código de 6 dígitos. " +
        "El código cambia cada 30 segundos.",
    prefill: String? = null,
    prefillRemaining: Int? = null,
    onPrefillConsumed: () -> Unit = {},
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var code by rememberSaveable { mutableStateOf("") }
    var receivedFromToken by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val focus = remember { FocusRequester() }
    val launchIntent = remember {
        context.packageManager.getLaunchIntentForPackage(TOKEN_PACKAGE)
    }

    LaunchedEffect(Unit) {
        runCatching { focus.requestFocus() }
    }

    LaunchedEffect(prefill) {
        val incoming = prefill?.filter { it.isDigit() }?.take(6).orEmpty()
        if (incoming.length == 6) {
            code = incoming
            receivedFromToken = true
            onPrefillConsumed()
            runCatching { focus.requestFocus() }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(title) },
        text = {
            Column {
                Icon(
                    Icons.Outlined.Key,
                    contentDescription = null,
                    tint = Ink,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    message,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (receivedFromToken) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Código recibido desde SirpefOffice Token.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink,
                    )
                    if (prefillRemaining != null && prefillRemaining <= 5) {
                        Text(
                            "Está por cambiar: si falla, vuelve a abrir Token.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Danger,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { value ->
                        code = value.filter { it.isDigit() }.take(6)
                    },
                    label = { Text("Código de 6 dígitos") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 6.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focus),
                    enabled = !submitting,
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        error,
                        color = Danger,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Spacer(Modifier.height(12.dp))
                if (launchIntent != null) {
                    TextButton(
                        onClick = {
                            runCatching { context.startActivity(launchIntent) }
                        },
                        enabled = !submitting,
                    ) {
                        Text("Abrir SirpefOffice Token")
                    }
                } else {
                    Text(
                        "SirpefOffice Token no está instalada en este teléfono.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Danger,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(code) },
                enabled = code.length == 6 && !submitting,
                colors = ButtonDefaults.buttonColors(containerColor = Ink),
            ) {
                Text(if (submitting) "Autorizando…" else "Autorizar y sellar")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !submitting) {
                Text("Cancelar")
            }
        },
    )
}
