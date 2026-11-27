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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ve.gob.mppef.sirpefoffice.token.BuildConfig
import ve.gob.mppef.sirpefoffice.token.ui.UiState
import ve.gob.mppef.sirpefoffice.token.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.token.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.token.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.token.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.token.ui.theme.Success
import ve.gob.mppef.sirpefoffice.token.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.token.ui.theme.White

@Composable
fun ProfileScreen(
    state: UiState,
    onBack: () -> Unit,
    onReset: () -> Unit,
    onUnpair: () -> Unit,
    onLogout: () -> Unit,
) {
    var confirmReset by remember { mutableStateOf(false) }
    var confirmUnpair by remember { mutableStateOf(false) }
    val user = state.user
    val status = state.status

    Scaffold(
        containerColor = Color(0xFFF7F9FC),
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Volver")
                    }
                },
                title = { Text("Perfil y seguridad") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = White),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = White,
                shadowElevation = 2.dp,
            ) {
                Column {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(
                                Brush.linearGradient(listOf(Color(0xFF02152E), Ink)),
                                RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
                            )
                            .padding(20.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(56.dp)
                                    .background(
                                        Brush.linearGradient(listOf(Indigo, Color(0xFF1B3A66))),
                                        RoundedCornerShape(18.dp),
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    (user?.name ?: "U").take(1).uppercase(),
                                    color = White,
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.ExtraBold,
                                )
                            }
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(
                                    user?.name ?: "Usuario",
                                    color = White,
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    user?.email ?: "Sin correo",
                                    color = Color(0xFFB7CFE6),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(
                                    if (user?.role == "admin") "Administrador · SVA" else "Miembro · SVA",
                                    color = Color(0xFF9DB9D8),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                    Column(Modifier.padding(18.dp)) {
                        Text(
                            "Cédula",
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            user?.cedula ?: "No registrada en SVA",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Ink,
                        )
                    }
                }
            }

            Surface(
                shape = RoundedCornerShape(20.dp),
                color = White,
                shadowElevation = 1.dp,
            ) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.Security,
                            contentDescription = null,
                            tint = Indigo,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "SirpefOffice Token",
                            style = MaterialTheme.typography.titleMedium,
                            color = Ink,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when {
                            status?.paired == true -> "Vinculado en ${status.pairedDeviceLabel ?: "este teléfono"}"
                            else -> "Sin vincular"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (status?.paired == true) Success else Danger,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "El secreto se guarda cifrado y solo se descifra con tu biometría. " +
                            "La app de firma exige este código para sellar documentos.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(SuccessSoft.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.Smartphone,
                            contentDescription = null,
                            tint = Success,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Un solo teléfono activo por usuario",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF026B04),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = { confirmReset = true },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFE9F1FA),
                            contentColor = Ink,
                        ),
                        enabled = status?.paired == true && !state.loading,
                    ) {
                        Icon(Icons.Outlined.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Restablecer Token", fontWeight = FontWeight.Bold)
                    }
                }
            }

            Surface(
                shape = RoundedCornerShape(20.dp),
                color = White,
                shadowElevation = 1.dp,
            ) {
                Column(Modifier.padding(18.dp)) {
                    Text(
                        "Sesión",
                        style = MaterialTheme.typography.titleMedium,
                        color = Ink,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "El refresh de la sesión se guarda cifrado. Cerrar sesión no borra el Token; " +
                            "para quitarlo de este teléfono usa «Desvincular».",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = onLogout,
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFFDECEB),
                            contentColor = Danger,
                        ),
                    ) {
                        Icon(Icons.Outlined.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Cerrar sesión", fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { confirmUnpair = true },
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFFDECEB),
                            contentColor = Danger,
                        ),
                        enabled = status?.paired == true && !state.loading,
                    ) {
                        Icon(Icons.Outlined.DeleteForever, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Desvincular este teléfono", fontWeight = FontWeight.Bold)
                    }
                }
            }

            Text(
                "SirpefOffice Token ${BuildConfig.VERSION_NAME} · SIRPEF",
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Restablecer Token") },
            text = {
                Text(
                    "Se generará un secreto nuevo. Los códigos del Token actual dejarán de servir inmediatamente.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        onReset()
                    },
                ) { Text("Restablecer", color = Danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Cancelar") }
            },
        )
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Desvincular teléfono") },
            text = {
                Text(
                    "Este teléfono dejará de generar códigos válidos. Para volver a usarlo tendrás que vincularlo desde SirpefOffice Firma.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmUnpair = false
                        onUnpair()
                    },
                ) { Text("Desvincular", color = Danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmUnpair = false }) { Text("Cancelar") }
            },
        )
    }
}
