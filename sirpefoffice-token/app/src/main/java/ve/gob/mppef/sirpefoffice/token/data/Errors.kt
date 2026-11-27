package ve.gob.mppef.sirpefoffice.token.data

import retrofit2.HttpException
import java.io.IOException

fun Throwable.toUserMessage(): String {
    if (this is BiometricException || this is TokenKeyInvalidatedException) {
        return message ?: "No se pudo usar la biometría"
    }
    if (this is HttpException) {
        val raw = try {
            response()?.errorBody()?.string()
        } catch (_: Exception) {
            null
        }
        val body = raw?.let {
            try {
                ApiFactory.json.decodeFromString<ApiErrorBody>(it)
            } catch (_: Exception) {
                null
            }
        }
        val serverMessage = body?.message ?: body?.msg
        if (serverMessage != null) return translate(serverMessage)
        return when (code()) {
            400 -> "La solicitud tiene datos inválidos."
            401 -> "La sesión expiró. Vuelve a iniciar sesión."
            403 -> "No tienes permiso para esta acción."
            404 -> "No se encontró el recurso solicitado."
            409 -> "El token cambió o ya fue usado. Inténtalo de nuevo."
            429 -> "Has hecho demasiadas peticiones. Espera un momento."
            in 500..599 -> "El servidor no pudo completar la operación. Inténtalo de nuevo."
            else -> "La operación falló (${code()})."
        }
    }
    if (this is IOException) {
        return "No se pudo conectar con el servidor. Revisa la red e inténtalo de nuevo."
    }
    return translate(message?.takeIf { it.isNotBlank() } ?: "Ocurrió un error inesperado.")
}

private fun translate(message: String): String = when (message.trim()) {
    "CREDENTIALS_BAD" -> "La cédula o la contraseña no son correctas."
    "NOT_FOUND_USER" -> "No existe un usuario con esa cédula."
    "USER_SUSPENDED" -> "El usuario está suspendido. Contacta con soporte."
    "SYSTEM_ACCESS_DENIED" -> "No tienes acceso a SirpefOffice en SVA."
    "ACCESS DENIED: NOT FOUND" -> "Tu usuario no está asignado a SirpefOffice en SVA."
    "ACCESS DENIED: SYSTEM" -> "SirpefOffice no está activo en SVA."
    "ACCESS DENIED: API KEY" -> "La clave de integración con SVA no es válida."
    "ACCESS DENIED: SESSION" -> "La sesión de SVA expiró. Vuelve a iniciar sesión."
    "SVA_UNAVAILABLE" -> "No se pudo contactar con SVA. Inténtalo más tarde."
    "SVA_ACCESS_DENIED" -> "SVA rechazó el acceso. Revisa tu asignación al sistema."
    else -> message
}
