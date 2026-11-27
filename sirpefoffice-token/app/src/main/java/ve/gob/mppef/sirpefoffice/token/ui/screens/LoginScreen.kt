package ve.gob.mppef.sirpefoffice.token.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.token.BuildConfig
import ve.gob.mppef.sirpefoffice.token.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.token.ui.theme.Background
import ve.gob.mppef.sirpefoffice.token.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.token.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.token.ui.theme.InkSoft
import ve.gob.mppef.sirpefoffice.token.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.token.ui.theme.Warning
import ve.gob.mppef.sirpefoffice.token.ui.theme.White

@Composable
fun LoginScreen(
    loading: Boolean,
    onLogin: (String, String) -> Unit,
    onLocalLogin: (String, String) -> Unit,
) {
    var cedula by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var visible by rememberSaveable { mutableStateOf(false) }
    var localMode by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Background)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding(),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF02152E), Ink, InkSoft)))
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 24.dp, vertical = 34.dp),
            ) {
                Column {
                    BrandMark(size = 54.dp)
                    Spacer(Modifier.height(20.dp))
                    Text("SirpefOffice", color = White, style = MaterialTheme.typography.displaySmall)
                    Text(
                        "Token de autorización",
                        color = Color(0xFFB7CFE6),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "SIRPEF · SEGUNDO FACTOR",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.labelSmall,
                        letterSpacing = 1.8.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "El código de 6 dígitos que autoriza el sellado de tus documentos.",
                        color = Color(0xFF9DB9D8),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Card(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 22.dp),
                shape = RoundedCornerShape(28.dp),
                colors = CardDefaults.cardColors(containerColor = White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(Modifier.padding(22.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (localMode) "Acceso local" else "Acceso con SVA",
                            style = MaterialTheme.typography.titleLarge,
                            color = Ink,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (localMode) "SOLO DEBUG" else "IDENTIDAD ÚNICA",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (localMode) Warning else Indigo,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        if (localMode) {
                            "Correo y contraseña del admin local. No uses esto en producción."
                        } else {
                            "Usa la cédula y la contraseña de tu cuenta SVA."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(18.dp))

                    OutlinedTextField(
                        value = cedula,
                        onValueChange = {
                            cedula = if (localMode) it else it.filter { ch ->
                                ch.isLetterOrDigit() || ch == '-' || ch == '.'
                            }
                        },
                        label = { Text(if (localMode) "Correo" else "Cédula") },
                        placeholder = {
                            Text(if (localMode) "admin@sirpefoffice.local" else "V-12345678")
                        },
                        leadingIcon = {
                            Icon(
                                if (localMode) Icons.Outlined.Email else Icons.Outlined.Badge,
                                contentDescription = null,
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !loading,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Contraseña") },
                        leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                        trailingIcon = {
                            IconButton(onClick = { visible = !visible }) {
                                Icon(
                                    if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                    contentDescription = if (visible) "Ocultar" else "Mostrar",
                                )
                            }
                        },
                        visualTransformation = if (visible) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !loading,
                    )
                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = {
                            if (localMode) {
                                onLocalLogin(cedula.trim(), password)
                            } else {
                                onLogin(cedula.trim(), password)
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Ink),
                        enabled = !loading,
                    ) {
                        if (loading) {
                            CircularProgressIndicator(
                                modifier = Modifier.height(20.dp),
                                color = White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Entrar", fontWeight = FontWeight.Bold)
                        }
                    }

                    if (BuildConfig.DEBUG) {
                        Spacer(Modifier.height(8.dp))
                        TextButton(
                            onClick = {
                                localMode = !localMode
                                cedula = ""
                                password = ""
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                if (localMode) "Volver al acceso SVA" else "Probar con cuenta local (debug)",
                                color = Indigo,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(22.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 28.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                Text(
                    "El token solo se muestra en este teléfono y requiere biometría.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
