package ve.gob.mppef.sirpefoffice.firma.ui.screens

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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Success
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SurfaceSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Violet
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

@Composable
fun ProfileScreen(
    state: UiState,
    onBack: () -> Unit,
    onLogout: () -> Unit,
    onStartTokenPairing: () -> Unit,
    onGenerateRecoveryCodes: () -> Unit,
    onClearTokenDialogs: () -> Unit,
) {
    val user = state.user
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
                title = { Text("Identidad y dispositivo") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = White),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
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
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                Brush.linearGradient(
                                    listOf(Color(0xFF02152E), Ink),
                                ),
                                RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
                            )
                            .padding(20.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(56.dp)
                                    .background(
                                        Brush.linearGradient(listOf(Indigo, Violet)),
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
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Proveedor de identidad",
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "SVA · sesión local de SirpefOffice",
                            style = MaterialTheme.typography.bodySmall,
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
                            Icons.Outlined.Fingerprint,
                            contentDescription = null,
                            tint = Indigo,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Dispositivo vinculado",
                            style = MaterialTheme.typography.titleMedium,
                            color = Ink,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Este teléfono tiene una clave EC P-256 en el Android Keystore. " +
                            "La clave privada nunca sale del dispositivo y se desbloquea con tu huella.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(SuccessSoft.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.Security,
                            contentDescription = null,
                            tint = Success,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Clave protegida por biometría fuerte",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF026B04),
                            fontWeight = FontWeight.SemiBold,
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
                            Icons.Outlined.Key,
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
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (state.tokenStatus?.paired == true) {
                            "Activo en ${state.tokenStatus.pairedDeviceLabel ?: "tu teléfono Token"}. " +
                                "La app Token genera el código que autoriza el sellado."
                        } else {
                            "Todavía no hay un teléfono Token vinculado. Actívalo antes de firmar."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.tokenStatus?.paired == true) Color(0xFF026B04) else Slate,
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = onStartTokenPairing,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFE9F1FA),
                            contentColor = Ink,
                        ),
                        enabled = !state.tokenBusy,
                    ) {
                        if (state.tokenBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Indigo,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (state.tokenStatus?.paired == true) {
                                    "Reemplazar Token"
                                } else {
                                    "Activar Token"
                                },
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = onGenerateRecoveryCodes,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceSoft,
                            contentColor = Ink,
                        ),
                        enabled = !state.tokenBusy,
                    ) {
                        Text("Generar códigos de recuperación", fontWeight = FontWeight.Bold)
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
                            Icons.Outlined.Smartphone,
                            contentDescription = null,
                            tint = Slate,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Sesión",
                            style = MaterialTheme.typography.titleMedium,
                            color = Ink,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "El token de acceso vive en memoria y el refresh se guarda cifrado. " +
                            "Cerrar sesión revoca el refresh en el servidor.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = onLogout,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
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
                }
            }
        }
    }

    if (state.pairingCode != null) {
        AlertDialog(
            onDismissRequest = onClearTokenDialogs,
            title = { Text("Código de vinculación") },
            text = {
                Column {
                    Text(
                        "En SirpefOffice Token, inicia sesión, elige «Vincular este teléfono» e introduce este código:",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(12.dp))
                    SelectionContainer {
                        Text(
                            state.pairingCode,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 28.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Ink,
                            letterSpacing = 2.sp,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Caduca en 5 minutos y solo se puede usar una vez. " +
                            "Si ya había un Token activo, quedará invalidado al vincular el nuevo.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = onClearTokenDialogs) { Text("Listo") }
            },
        )
    }

    if (state.recoveryCodes.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = onClearTokenDialogs,
            title = { Text("Códigos de recuperación") },
            text = {
                Column {
                    Text(
                        "Guárdalos en un lugar seguro. Se muestran una sola vez y sirven para vincular un teléfono nuevo si pierdes el Token.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                    Spacer(Modifier.height(12.dp))
                    SelectionContainer {
                        Column {
                            for (code in state.recoveryCodes) {
                                Text(
                                    code,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Ink,
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = onClearTokenDialogs) { Text("Entendido") }
            },
        )
    }
}
