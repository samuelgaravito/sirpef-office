package ve.gob.mppef.sirpefoffice.firma.ui.screens

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.widget.Toast
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.QrCode2
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ve.gob.mppef.sirpefoffice.firma.ui.UiState
import ve.gob.mppef.sirpefoffice.firma.ui.components.BrandMark
import ve.gob.mppef.sirpefoffice.firma.ui.components.generateQrCode
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Indigo
import ve.gob.mppef.sirpefoffice.firma.ui.theme.BrandMint
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Ink
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Slate
import ve.gob.mppef.sirpefoffice.firma.ui.theme.Success
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SuccessSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.SurfaceSoft
import ve.gob.mppef.sirpefoffice.firma.ui.theme.White

@Composable
fun CertificateScreen(
    state: UiState,
    onBack: () -> Unit,
) {
    val certificate = state.certificate
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

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
                title = {
                    Column {
                        Text("Certificado digital", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Comprobante criptográfico verificable",
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = White),
            )
        },
        bottomBar = {
            if (certificate != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(White)
                        .navigationBarsPadding()
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            clipboard.setText(AnnotatedString(certificate.verificationUrl))
                            Toast.makeText(context, "Enlace copiado", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFF6F5F7),
                            contentColor = Ink,
                        ),
                    ) {
                        Icon(Icons.Outlined.ContentCopy, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Copiar enlace", fontWeight = FontWeight.Bold)
                    }
                    Button(
                        onClick = {
                            try {
                                context.startActivity(
                                    Intent(Intent.ACTION_VIEW, Uri.parse(certificate.verificationUrl)),
                                )
                            } catch (_: Exception) {
                                Toast.makeText(
                                    context,
                                    "No hay un navegador disponible",
                                    Toast.LENGTH_SHORT,
                                ).show()
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Indigo),
                    ) {
                        Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Verificar", fontWeight = FontWeight.Bold)
                    }
                }
            }
        },
    ) { padding ->
        if (certificate == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text("Certificado no disponible", color = Slate)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(18.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = White,
                    shadowElevation = 3.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    Brush.linearGradient(listOf(Color(0xFF02152E), Ink)),
                                    RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                                )
                                .padding(18.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                BrandMark(size = 38.dp)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        "SIRPEFOFFICE",
                                        color = White,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.ExtraBold,
                                    )
                                    Text(
                                        "Autoridad de sellado interno",
                                        color = Color(0xFF9DB9D8),
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                                Surface(
                                    color = BrandMint.copy(alpha = 0.18f),
                                    shape = RoundedCornerShape(7.dp),
                                ) {
                                    Text(
                                        "VERIFICADO",
                                        color = Color(0xFF026B04),
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.ExtraBold,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    )
                                }
                            }
                        }

                        Column(Modifier.padding(18.dp)) {
                            Text(
                                certificate.document?.title ?: "Documento firmado",
                                style = MaterialTheme.typography.titleLarge,
                                color = Ink,
                                fontWeight = FontWeight.ExtraBold,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Serie ${certificate.serial}",
                                style = MaterialTheme.typography.labelSmall,
                                color = Indigo,
                                fontFamily = FontFamily.Monospace,
                            )
                            Spacer(Modifier.height(16.dp))

                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                InfoBox(
                                    "Titular",
                                    certificate.signer?.name ?: "—",
                                    certificate.signer?.cedula ?: "Cédula no registrada",
                                    Modifier.weight(1f),
                                )
                                InfoBox(
                                    "Fecha UTC",
                                    certificate.issuedAt?.take(10) ?: "—",
                                    "Firma electrónica",
                                    Modifier.weight(1f),
                                )
                            }

                            val signatureBitmap = remember(certificate.signaturePng) {
                                certificate.signaturePng?.let { encoded ->
                                    runCatching {
                                        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                                    }.getOrNull()
                                }
                            }
                            if (signatureBitmap != null) {
                                Spacer(Modifier.height(14.dp))
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(16.dp),
                                    color = SurfaceSoft,
                                ) {
                                    Image(
                                        bitmap = signatureBitmap,
                                        contentDescription = "Rúbrica registrada",
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(96.dp)
                                            .padding(10.dp),
                                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                                    )
                                }
                            }

                            Spacer(Modifier.height(16.dp))
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(SurfaceSoft, RoundedCornerShape(16.dp))
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val qr = remember(certificate.verificationUrl) {
                                    generateQrCode(certificate.verificationUrl, 520)
                                }
                                if (qr != null) {
                                    Image(
                                        bitmap = qr,
                                        contentDescription = "QR de verificación",
                                        modifier = Modifier
                                            .size(108.dp)
                                            .background(White, RoundedCornerShape(10.dp))
                                            .padding(6.dp),
                                    )
                                } else {
                                    Icon(
                                        Icons.Outlined.QrCode2,
                                        contentDescription = null,
                                        tint = Indigo,
                                        modifier = Modifier.size(80.dp),
                                    )
                                }
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text(
                                        "Rúbrica registrada",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Slate,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text(
                                        certificate.signature?.method
                                            ?.replace("drawn", "Trazo táctil")
                                            ?.replace("typed", "Firma tipográfica")
                                            ?: "Firma electrónica",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Ink,
                                    )
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        "Escanea el QR para validar la integridad.",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Slate,
                                    )
                                }
                            }

                            Spacer(Modifier.height(16.dp))
                            HashBox(
                                "SHA-256 del contenido",
                                certificate.signature?.contentSha256,
                            )
                            Spacer(Modifier.height(8.dp))
                            HashBox(
                                "SHA-256 del PDF sellado",
                                certificate.sealedPdfSha256,
                            )

                            Spacer(Modifier.height(14.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Success,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    "Constancia de firma electrónica simple auditada.",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Slate,
                                )
                            }
                            Text(
                                certificate.legalNotice
                                    ?: "La validez jurídica depende del marco legal aplicable.",
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
                Text(
                    "El QR abre una página pública de verificación. No revela el contenido del memorándum.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun InfoBox(title: String, value: String, caption: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(SurfaceSoft, RoundedCornerShape(12.dp))
            .padding(10.dp),
    ) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = Slate,
            fontWeight = FontWeight.Bold,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = Ink,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
        Text(
            caption,
            style = MaterialTheme.typography.labelSmall,
            color = Slate,
        )
    }
}

@Composable
private fun HashBox(title: String, hash: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink, RoundedCornerShape(12.dp))
            .padding(10.dp),
    ) {
        Text(
            "$title:",
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFF9DB9D8),
            fontWeight = FontWeight.Bold,
        )
        Text(
            hash ?: "No disponible",
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFE3E4E8),
            fontFamily = FontFamily.Monospace,
        )
    }
}
