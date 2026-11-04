import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Error de aplicación con código HTTP y código interno estable. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'No autenticado') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'No tienes permiso para esta acción') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Recurso no encontrado') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

/** El documento ya fue aprobado/enviado y su contenido es inmutable. */
export const locked = (message = 'Este documento fue aprobado y enviado; ya no se puede editar') =>
  new AppError(409, 'DOCUMENT_LOCKED', message);

/** Handler global de errores para Fastify. */
export function errorHandler(
  error: Error & { statusCode?: number; code?: string },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      details: error.issues,
    });
    return;
  }

  // Errores de Fastify (validación de esquema, payload, etc.)
  if (error.statusCode && error.statusCode < 500) {
    reply.status(error.statusCode).send({
      error: error.code ?? 'REQUEST_ERROR',
      message: error.message,
    });
    return;
  }

  request.log.error({ err: error }, 'Error no controlado');
  reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'Error interno del servidor',
  });
}
