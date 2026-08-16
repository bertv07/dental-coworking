import { z } from 'zod';

/**
 * ===========================================================================
 *  Primitivos de validación reutilizables
 * ===========================================================================
 *  Estos esquemas se usan en AMBOS lados:
 *    - Cliente: feedback inmediato en el formulario (UX).
 *    - Servidor: la validación que de verdad cuenta (seguridad).
 *
 *  La del cliente es una cortesía; la del servidor es la que protege. Nunca
 *  se confía en que el cliente haya validado, porque el cliente puede ser
 *  curl. Por eso este archivo NO lleva `server-only`: es intencional que se
 *  comparta.
 * ===========================================================================
 */

/**
 * Teléfono en E.164 — el formato que usa WhatsApp.
 *
 * `.transform` normaliza ANTES de validar: quita espacios, guiones y
 * paréntesis que la gente escribe por costumbre. Sin este paso, el mismo
 * paciente entra tres veces con "+57 300 123 4567", "+573001234567" y
 * "+57-300-1234567".
 */
export const phoneE164Schema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'El teléfono debe estar en formato E.164, ej: +573001234567',
      ),
  );

/**
 * Texto libre seguro para nombres, notas y descripciones.
 *
 * Sobre XSS: la defensa REAL es el escapado de React al renderizar, que es
 * automático. Aquí no se intenta "limpiar HTML" — los filtros por lista negra
 * siempre se acaban burlando y además destruyen datos legítimos (un apellido
 * con `&` es válido).
 *
 * Lo que sí se hace: rechazar caracteres de control, que no tienen uso
 * legítimo en estos campos y sí sirven para envenenar logs (inyección de
 * saltos de línea) o romper exportaciones a CSV.
 */
export const safeTextSchema = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, `No puede exceder ${maxLength} caracteres`)
    // \u0000-\u0008 y \u000B-\u001F: caracteres de control C0.
    // Se permiten \n (\u000A) y \t (\u0009): en notas clínicas el salto de
    // línea es legítimo. \u007F es DEL.
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value), {
      message: 'El texto contiene caracteres no permitidos',
    });

/** Nombre de persona. Límite generoso: los nombres compuestos son largos. */
export const personNameSchema = safeTextSchema(120).pipe(
  z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
);

/** Email normalizado a minúsculas para que la unicidad funcione de verdad. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Correo electrónico inválido')
  .max(255);

/**
 * Identificador CUID de Prisma.
 *
 * Validar la FORMA del id antes de consultar evita trabajo inútil en la DB
 * y corta de raíz los intentos de inyectar payloads donde se espera un id.
 * (El ORM ya parametriza, esto es defensa en profundidad.)
 */
export const cuidSchema = z.string().regex(/^c[a-z0-9]{20,30}$/i, 'Identificador inválido');

/**
 * Fecha-hora ISO 8601 CON zona horaria obligatoria.
 *
 * Se exige el offset a propósito: si el bot manda "2026-08-15T10:00:00" sin
 * zona, el servidor lo interpreta en SU zona horaria y la cita acaba
 * desplazada varias horas. Un bug clásico y muy caro en una agenda.
 */
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Debe ser ISO 8601 con zona horaria, ej: 2026-08-15T10:00:00-05:00' })
  .transform((value) => new Date(value));

/** Monto en centavos: entero no negativo con techo razonable (anti-overflow). */
export const centsSchema = z
  .number()
  .int('El monto debe ser un entero de centavos')
  .min(0, 'El monto no puede ser negativo')
  .max(1_000_000_000_00, 'Monto fuera de rango');

/** Porcentaje de comisión. */
export const percentSchema = z.number().int().min(0).max(100);

/**
 * Llave de idempotencia para las peticiones de la automatización.
 *
 * n8n reintenta ante timeouts de red. Sin idempotencia, un timeout en la
 * respuesta (cuando la cita YA se creó) produce una cita duplicada al
 * reintentar. Con ella, el segundo intento devuelve la cita original.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8, 'La llave de idempotencia es demasiado corta')
  .max(128)
  .regex(/^[A-Za-z0-9_:-]+$/, 'Sólo se permiten caracteres alfanuméricos, _, : y -');

/** Paginación con cota superior: impide un `?limit=999999` que tumbe la DB. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Rango de fechas para los informes del dashboard. */
export const dateRangeSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .refine((data) => data.to > data.from, {
    message: 'La fecha final debe ser posterior a la inicial',
    path: ['to'],
  })
  .refine(
    (data) => data.to.getTime() - data.from.getTime() <= 366 * 24 * 60 * 60 * 1000,
    { message: 'El rango no puede exceder un año', path: ['to'] },
  );
