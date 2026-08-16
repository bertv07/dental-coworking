import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { isProduction } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Respuestas de API estandarizadas
 * ===========================================================================
 *  Dos objetivos:
 *
 *  1. CONTRATO ESTABLE. n8n y el bot consumen estos endpoints; una forma de
 *     respuesta predecible evita que cada cambio rompa los flujos.
 *
 *  2. CERO FILTRACIÓN. Los errores nunca exponen stack traces, nombres de
 *     tablas, SQL ni mensajes del driver. El cliente recibe un código
 *     estable y un `requestId`; el detalle real va al log del servidor.
 *
 *  Forma del éxito:  { ok: true,  data: T }
 *  Forma del error:  { ok: false, error: { code, message, requestId, details? } }
 * ===========================================================================
 */

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCodeValue;
    /** Mensaje seguro para mostrar. Nunca incluye internos del sistema. */
    message: string;
    /** Correlaciona la respuesta con la entrada del log del servidor. */
    requestId: string;
    /** Sólo para errores de validación: qué campo falló y por qué. */
    details?: Array<{ field: string; message: string }>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Identificador de petición. `crypto.randomUUID` está en el runtime, sin deps. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Respuesta exitosa. `201` para creación, `200` por defecto. */
export function ok<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json<ApiSuccess<T>>(
    { ok: true, data },
    {
      status,
      headers: {
        // Las respuestas de API jamás deben cachearse en proxies intermedios:
        // contienen datos de pacientes.
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        ...headers,
      },
    },
  );
}

/** Respuesta de error con forma estándar. */
export function fail(
  code: ErrorCodeValue,
  message: string,
  status: number,
  options: {
    requestId?: string;
    details?: ApiFailure['error']['details'];
    headers?: HeadersInit;
  } = {},
): NextResponse {
  const requestId = options.requestId ?? newRequestId();

  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code,
        message,
        requestId,
        ...(options.details ? { details: options.details } : {}),
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...options.headers,
      },
    },
  );
}

// --- Atajos por caso de uso -------------------------------------------------

/**
 * Convierte un `ZodError` en un 400 con detalle por campo.
 *
 * Exponer QUÉ campo falló es correcto y útil (el cliente debe poder
 * corregirlo). Lo que no se expone nunca es el VALOR recibido — podría
 * contener datos sensibles que acabarían replicados en los logs de n8n.
 */
export function failValidation(error: ZodError, requestId?: string): NextResponse {
  return fail(ErrorCode.VALIDATION_ERROR, 'La petición contiene datos inválidos', 400, {
    requestId,
    details: error.issues.map((issue) => ({
      field: issue.path.join('.') || '(raíz)',
      message: issue.message,
    })),
  });
}

/**
 * 401 — sin credenciales o inválidas.
 *
 * El mensaje es deliberadamente vago: distinguir "no existe la llave" de
 * "la firma no coincide" le regala al atacante un oráculo de enumeración.
 */
export function failUnauthorized(requestId?: string): NextResponse {
  return fail(ErrorCode.UNAUTHORIZED, 'Credenciales inválidas o ausentes', 401, {
    requestId,
    headers: { 'WWW-Authenticate': 'Bearer' },
  });
}

/** 403 — autenticado pero sin permiso para esta acción. */
export function failForbidden(requestId?: string): NextResponse {
  return fail(ErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta acción', 403, {
    requestId,
  });
}

/**
 * 404 — recurso inexistente.
 *
 * El mensaje no revela el TIPO de recurso cuando el que pregunta no está
 * autorizado a saber si existe. Para endpoints internos autenticados sí es
 * razonable ser específico.
 */
export function failNotFound(resource = 'Recurso', requestId?: string): NextResponse {
  return fail(ErrorCode.NOT_FOUND, `${resource} no encontrado`, 404, { requestId });
}

/** 409 — el hueco pedido ya fue tomado. Le dice al bot que reintente con otro. */
export function failSlotUnavailable(requestId?: string): NextResponse {
  return fail(
    ErrorCode.SLOT_UNAVAILABLE,
    'El horario solicitado ya no está disponible',
    409,
    { requestId },
  );
}

/** 429 — demasiadas peticiones. `Retry-After` indica cuándo reintentar. */
export function failRateLimited(retryAfterSeconds: number, requestId?: string): NextResponse {
  return fail(ErrorCode.RATE_LIMITED, 'Demasiadas peticiones. Intenta más tarde', 429, {
    requestId,
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}

/**
 * 500 — fallo inesperado.
 *
 * ESTA ES LA FUNCIÓN CRÍTICA PARA NO FILTRAR INFORMACIÓN.
 * El error real se registra en el servidor junto al `requestId`; el cliente
 * sólo recibe ese id. Cuando alguien reporta "me salió un error", se busca
 * el id en los logs y ahí está todo el contexto — sin haberle mostrado nunca
 * al mundo la estructura interna del sistema.
 */
export function failInternal(error: unknown, requestId?: string): NextResponse {
  const id = requestId ?? newRequestId();

  console.error(
    JSON.stringify({
      level: 'error',
      requestId: id,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      // El stack sólo fuera de producción: en prod los agregadores de logs
      // suelen ser accesibles a más gente de la que debería ver rutas internas.
      ...(isProduction ? {} : { stack: error instanceof Error ? error.stack : undefined }),
    }),
  );

  return fail(
    ErrorCode.INTERNAL_ERROR,
    'Ocurrió un error procesando la solicitud',
    500,
    { requestId: id },
  );
}
