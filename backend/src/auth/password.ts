import 'server-only';
import { hash, verify } from '@node-rs/argon2';

/**
 * ===========================================================================
 *  Hasheo de contraseñas — Argon2id
 * ===========================================================================
 *  Por qué Argon2id y no bcrypt:
 *
 *  - Ganador del Password Hashing Competition y recomendación actual de OWASP.
 *  - `bcrypt` trunca silenciosamente en 72 bytes: una contraseña larga generada
 *    por un gestor puede quedar efectivamente recortada sin que nadie lo note.
 *  - Argon2id es *memory-hard*: encarece muchísimo el crackeo con GPU/ASIC,
 *    algo que bcrypt (ligero en memoria) no consigue.
 *
 *  Se usa `@node-rs/argon2` (binding Rust precompilado) en vez del paquete
 *  `argon2`, que requiere node-gyp y rompe builds en Docker con frecuencia.
 * ===========================================================================
 */

/**
 * Parámetros según OWASP Password Storage Cheat Sheet (perfil Argon2id).
 * Objetivo: ~50-100 ms por hash en el hardware del servidor.
 *
 * ⚠️  Subirlos más adelante NO invalida los hashes existentes: cada hash
 *  guarda sus propios parámetros en la cadena resultante. Al hacer login se
 *  puede detectar un hash con parámetros viejos y re-hashear al vuelo.
 */
const ARGON2_OPTIONS = {
  /** 19 MiB de memoria por hash. El coste real para un atacante. */
  memoryCost: 19_456,
  /** Iteraciones. */
  timeCost: 2,
  /** Hilos paralelos. */
  parallelism: 1,
} as const;

/**
 * Hash "señuelo" precomputado, usado para ejecutar una verificación real
 * cuando el usuario NO existe. Ver `verifyPassword` para el porqué.
 * Corresponde a una contraseña aleatoria que nadie conoce.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZXg$Yy8gTm90QVJlYWxIYXNoVmFsdWVIZXJlMTIzNA';

/** Genera el hash Argon2id de una contraseña en claro. */
export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, ARGON2_OPTIONS);
}

/**
 * Verifica una contraseña contra su hash.
 *
 * Devuelve `false` ante cualquier error en vez de propagarlo: un hash
 * corrupto en la DB debe traducirse en "credenciales inválidas", nunca en un
 * 500 que le confirme al atacante que ese usuario existe.
 */
export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Consume el mismo tiempo que una verificación real, sin verificar nada.
 *
 * ATAQUE QUE PREVIENE — enumeración de usuarios por tiempo de respuesta:
 * si con un email inexistente se responde en 2 ms y con uno existente en
 * 80 ms (lo que tarda Argon2), un atacante descubre qué cuentas existen
 * simplemente cronometrando. Ejecutando el hash señuelo, ambos caminos
 * tardan lo mismo.
 */
export async function fakeVerifyPassword(): Promise<false> {
  try {
    await verify(DUMMY_HASH, 'contraseña-que-nunca-coincidira', ARGON2_OPTIONS);
  } catch {
    // Se ignora: sólo interesa haber gastado el tiempo de CPU.
  }
  return false;
}

/**
 * Política de contraseñas alineada con NIST SP 800-63B.
 *
 * Nota deliberada: NO se exigen "1 mayúscula + 1 número + 1 símbolo". Esas
 * reglas empujan a la gente hacia `Password1!` y el NIST las desaconseja
 * desde 2017. La longitud es lo que de verdad aporta entropía.
 */
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128, // Cota superior: evita DoS hasheando entradas de 10 MB.
} as const;
