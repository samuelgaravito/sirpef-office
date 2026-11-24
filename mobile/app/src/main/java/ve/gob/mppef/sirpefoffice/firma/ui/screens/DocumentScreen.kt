package ve.gob.mppef.sirpefoffice.firma.ui.screens

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import ve.gob.mppef.sirpefoffice.firma.data.SignatureCapture
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.components.SignatureDialog
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Background
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Danger
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SlateLight
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Success
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SurfaceSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

@Composable
fun DocumentScreen(
    state: UiState,
    activity: FragmentActivity,
    onBack: () -> Unit,
    onSignature: (SignatureCapture) -> Unit,
    onApprove: (FragmentActivity) -> Unit,
    onRetry: (FragmentActivity) -> Unit,
    onCertificate: () -> Unit,
) {
    val document = state.selected
    var showSignature by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = Color(0xFFEFF3F8),
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Volver")
                    }
                },
                title = {
                    Column {
                        Text(
                            document?.title ?: "Documento",
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.Lock,
                                contentDescription = null,
                                tint = Success,
                                modifier = Modifier.size(11.dp),
                            )
                            Spacer(Modifier.width(3.dp))
                            Text(
                                if (document?.signed == true) "Firma verificada" else "Sesión autenticada",
                                style = MaterialTheme.typography.labelSmall,
                                color = Success,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            if (document?.signed == true) onCertificate()
                        },
                    ) {
                        Icon(
                            Icons.Outlined.VerifiedUser,
                            contentDescription = "Certificado",
                            tint = if (document?.signed == true) Indigo else SlateLight,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = White),
            )
        },
        bottomBar = {
            DocumentBottomBar(
                state = state,
                onSign = { showSignature = true },
                onApprove = { onApprove(activity) },
                onRetry = { onRetry(activity) },
                onCertificate = onCertificate,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { VerificationCard(state) }

            if (state.pdfLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(260.dp)
                            .background(White, RoundedCornerShape(18.dp)),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator(color = Indigo) }
                }
            } else if (state.pdfPages.isEmpty()) {
                item { PdfPlaceholder() }
            } else {
                itemsIndexed(state.pdfPages) { index, page ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = White,
                        shadowElevation = 3.dp,
                    ) {
                        Column {
                            Image(
                                bitmap = page,
                                contentDescription = "Página ${index + 1}",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp)),
                                contentScale = ContentScale.FillWidth,
                            )
                            Text(
                                "Página ${index + 1}",
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate,
                                modifier = Modifier.padding(8.dp),
                            )
                        }
                    }
                }
            }

            item {
                SignatureSection(
                    state = state,
                    onOpen = { showSignature = true },
                    onCertificate = onCertificate,
                )
            }
        }
    }

    if (showSignature) {
        SignatureDialog(
            userName = state.user?.name ?: "Firma",
            onDismiss = { showSignature = false },
            onConfirm = { capture ->
                onSignature(capture)
                showSignature = false
                onApprove(activity)
            },
        )
    }
}

@Composable
private fun VerificationCard(state: UiState) {
    val document = state.selected ?: return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = White,
        shadowElevation = 1.dp,
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(8.dp)
                        .background(if (document.signed) Success else Indigo, RoundedCornerShape(50)),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    if (document.signed) "Documento firmado y sellado" else "Contenido listo para revisión",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    document.docNumber ?: "Sin número",
                    style = MaterialTheme.typography.labelSmall,
                    color = Indigo,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Badge("Remitente", document.senderName.ifBlank { "—" })
                Badge("Versión", "v${document.version}")
            }
            if (document.certificateSerial != null) {
                Spacer(Modifier.height(8.dp))
                Badge("Certificado", document.certificateSerial)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                document.subject.ifBlank { "Sin asunto" },
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
    }
}

@Composable
private fun Badge(label: String, value: String) {
    Surface(
        color = SurfaceSoft,
        shape = RoundedCornerShape(9.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "$label: ",
                style = MaterialTheme.typography.labelSmall,
                color = Slate,
            )
            Text(
                value,
                style = MaterialTheme.typography.labelSmall,
                color = Ink,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PdfPlaceholder() {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .height(240.dp),
        shape = RoundedCornerShape(18.dp),
        color = White,
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                Icons.Outlined.Description,
                contentDescription = null,
                tint = SlateLight,
                modifier = Modifier.size(38.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Vista previa no disponible",
                style = MaterialTheme.typography.bodySmall,
                color = Slate,
            )
        }
    }
}

@Composable
private fun SignatureSection(
    state: UiState,
    onOpen: () -> Unit,
    onCertificate: () -> Unit,
) {
    val document = state.selected ?: return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = White,
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "FIRMA DEL TITULAR",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    state.user?.name ?: "",
                    style = MaterialTheme.typography.labelSmall,
                    color = Indigo,
                )
            }
            Spacer(Modifier.height(10.dp))

            when {
                document.signed -> {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(SuccessSoft.copy(alpha = 0.55f), RoundedCornerShape(16.dp))
                            .border(1.dp, Success.copy(alpha = 0.25f), RoundedCornerShape(16.dp))
                            .padding(14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.CheckCircle,
                                contentDescription = null,
                                tint = Success,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Firma estampada",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF026B04),
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "El certificado incluye la huella SHA-256 del contenido y del PDF sellado.",
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate,
                        )
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = onCertificate,
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                        ) {
                            Icon(Icons.Outlined.QrCode2, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Ver certificado")
                        }
                    }
                }

                state.signature != null -> {
                    val preview = remember(state.signature) {
                        BitmapFactory.decodeByteArray(
                            state.signature!!.pngBytes,
                            0,
                            state.signature!!.pngBytes.size,
                        )?.asImageBitmap()
                    }
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(SuccessSoft.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
                            .padding(12.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Firma lista para estampar",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF026B04),
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "Cambiar",
                                style = MaterialTheme.typography.labelSmall,
                                color = Indigo,
                                modifier = Modifier.clickable(onClick = onOpen),
                            )
                        }
                        if (preview != null) {
                            Image(
                                bitmap = preview,
                                contentDescription = "Firma",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(90.dp)
                                    .padding(top = 6.dp),
                                contentScale = ContentScale.Fit,
                            )
                        }
                    }
                }

                document.canSign -> {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFE9F1FA), RoundedCornerShape(16.dp))
                            .border(1.dp, Indigo.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
                            .clickable(onClick = onOpen)
                            .padding(18.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(
                            Modifier
                                .size(42.dp)
                                .background(Indigo, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Outlined.Fingerprint,
                                contentDescription = null,
                                tint = White,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Toca para firmar aquí",
                            style = MaterialTheme.typography.bodySmall,
                            color = Ink,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "Trazo táctil o firma automática",
                            style = MaterialTheme.typography.labelSmall,
                            color = Indigo,
                        )
                    }
                }

                else -> {
                    Text(
                        "Este documento no está pendiente de tu firma.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }
        }
    }
}

@Composable
private fun DocumentBottomBar(
    state: UiState,
    onSign: () -> Unit,
    onApprove: () -> Unit,
    onRetry: () -> Unit,
    onCertificate: () -> Unit,
) {
    val document = state.selected
    Surface(color = White, shadowElevation = 8.dp) {
        Column(
            Modifier
                .navigationBarsPadding()
                .padding(14.dp),
        ) {
            if (state.pendingRetry) {
                Button(
                    onClick = onRetry,
                    enabled = !state.signing,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(15.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Danger),
                ) {
                    Text("Reintentar sellado", fontWeight = FontWeight.Bold)
                }
            } else {
                Button(
                    onClick = {
                        when {
                            document?.signed == true -> onCertificate()
                            state.signature == null -> onSign()
                            else -> onApprove()
                        }
                    },
                    enabled = document != null &&
                        (document.signed || document.canSign) &&
                        !state.signing,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(15.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (document?.signed == true) Indigo else Ink,
                        disabledContainerColor = Color(0xFFE3E4E8),
                    ),
                ) {
                    if (state.signing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            when {
                                document?.signed == true -> "Ver certificado"
                                state.signature == null -> "Firmar y aprobar"
                                else -> "Confirmar y sellar firma"
                            },
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "La firma se valida con biometría y se sella en el servidor.",
                style = MaterialTheme.typography.labelSmall,
                color = Slate,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
