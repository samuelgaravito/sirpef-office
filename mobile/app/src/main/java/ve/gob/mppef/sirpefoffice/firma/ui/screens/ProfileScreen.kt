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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
}
