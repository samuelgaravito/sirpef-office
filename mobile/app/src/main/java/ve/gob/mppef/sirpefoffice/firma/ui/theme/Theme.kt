package ve.gob.mppef.sirpefoffice.firma.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ve.gob.mppef.sirpefoffice.firma.R

/** Source Sans 3: tipografía de la interfaz de SirpefOffice. */
val SourceSans = FontFamily(
    Font(R.font.source_sans_3_regular, FontWeight.Normal),
    Font(R.font.source_sans_3_medium, FontWeight.Medium),
    Font(R.font.source_sans_3_semibold, FontWeight.SemiBold),
    Font(R.font.source_sans_3_bold, FontWeight.Bold),
    Font(R.font.source_sans_3_black, FontWeight.ExtraBold),
)

/** Caveat: solo para la firma tipográfica. */
val Caveat = FontFamily(
    Font(R.font.caveat, FontWeight.SemiBold),
)

private val colors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = White,
    primaryContainer = BrandSoft,
    onPrimaryContainer = BrandNavy,
    secondary = BrandNavySoft,
    onSecondary = White,
    secondaryContainer = BrandSoft,
    onSecondaryContainer = BrandNavy,
    tertiary = BrandMint,
    onTertiary = BrandNavy,
    background = Background,
    onBackground = Ink,
    surface = White,
    onSurface = Ink,
    surfaceVariant = SurfaceSoft,
    onSurfaceVariant = Slate,
    outline = Hairline,
    outlineVariant = SlateLight,
    error = Danger,
    onError = White,
    errorContainer = DangerSoft,
    onErrorContainer = Danger,
)

private val typography = Typography(
    displaySmall = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 16.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = SourceSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
    ),
)

@Composable
fun SirpefTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = colors,
        typography = typography,
        content = content,
    )
}
