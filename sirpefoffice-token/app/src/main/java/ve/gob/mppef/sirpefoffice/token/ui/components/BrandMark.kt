package ve.gob.mppef.sirpefoffice.token.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ve.gob.mppef.sirpefoffice.token.R
import ve.gob.mppef.sirpefoffice.token.ui.theme.BrandNavy
import ve.gob.mppef.sirpefoffice.token.ui.theme.White

/**
 * Logo de SirpefOffice Token: caja fuerte con cerradura.
 */
@Composable
fun BrandMark(
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(size * 0.28f)
    Box(
        modifier = modifier
            .requiredSize(size)
            .clip(shape)
            .background(BrandNavy)
            .border(1.dp, White.copy(alpha = 0.18f), shape),
    ) {
        Image(
            painter = painterResource(R.drawable.brand_token),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
