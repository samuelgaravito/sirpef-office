package ve.gob.mppef.sirpefoffice.firma.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import ve.gob.mppef.sirpefoffice.firma.MainActivity
import ve.gob.mppef.sirpefoffice.firma.R

/** Marca si hay una actividad visible; evita duplicar el aviso con el WebSocket. */
object AppForeground {
    @Volatile
    var visible: Boolean = false
}

object PushNotifications {
    const val CHANNEL_ID = "sirpef_documentos"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Documentos",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Documentos enviados, aprobaciones y devoluciones."
            },
        )
    }

    fun show(
        context: Context,
        title: String,
        body: String,
        documentId: String?,
        messageId: String?,
    ) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        ensureChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            documentId?.let { putExtra("documentId", it) }
            messageId?.let { putExtra("messageId", it) }
        }
        val pending = PendingIntent.getActivity(
            context,
            (messageId ?: documentId ?: title).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        context.getSystemService(NotificationManager::class.java)
            ?.notify((messageId ?: documentId ?: title).hashCode(), notification)
    }
}
