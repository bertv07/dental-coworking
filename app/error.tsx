'use client';

import { useEffect, useState } from 'react';

/**
 * ===========================================================================
 *  Pantalla de error del panel
 * ===========================================================================
 *  Cubre cualquier fallo del cliente por debajo del layout raíz.
 *
 *  ---------------------------------------------------------------------
 *  EL CASO QUE DE VERDAD OCURRE: DESPLEGAR CON LA PESTAÑA ABIERTA
 *  ---------------------------------------------------------------------
 *  Next identifica cada Server Action con un hash que cambia en CADA build.
 *  Cuando se despliega una versión nueva, el navegador de quien tenía el
 *  panel abierto sigue con el JavaScript viejo: al pulsar un botón pide un
 *  id de acción que el servidor ya no reconoce y todo se cae con
 *  «UnrecognizedActionError».
 *
 *  No es un fallo del código, es desfase entre cliente y servidor, y aquí
 *  pasa a diario: recepción deja el panel abierto todo el turno.
 *
 *  La única cura es recargar para traerse el JavaScript nuevo. Se hace solo,
 *  porque pedirle a quien está cobrando que «actualice la página» es pedirle
 *  que interprete un error técnico en mitad de su trabajo.
 *
 *  ⚠️  La recarga se protege contra bucles: si el mismo error vuelve a los
 *   pocos segundos, recargar no lo arregló y se enseña la pantalla en vez de
 *   insistir. Un bucle de recargas escondería un fallo real para siempre.
 * ===========================================================================
 */

/** Cuándo se recargó por última vez a causa de un desfase de versión. */
const MARCA_RECARGA = 'panel:recarga-por-version';

/**
 * Ventana para distinguir un bucle de un desfase nuevo.
 *
 * Si el error vuelve DENTRO de estos segundos, recargar no lo arregló y
 * seguir recargando sólo escondería un fallo real. Pasado ese rato, un error
 * igual ya es otro despliegue distinto y merece su propia recarga — por eso
 * se guarda la HORA y no un simple «ya lo intenté»: con un booleano, la
 * segunda actualización del día dejaría de recuperarse sola.
 */
const VENTANA_BUCLE_MS = 15_000;

/**
 * ¿Es el error de «la acción ya no existe en el servidor»?
 *
 * Se mira el nombre Y el texto: Next ha cambiado el mensaje entre versiones,
 * y quedarse sólo con una de las dos señales haría que dejara de detectarse
 * en la siguiente actualización sin que nadie se entere.
 */
function esDesfaseDeVersion(error: Error): boolean {
  const nombre = error.name ?? '';
  const mensaje = error.message ?? '';

  return (
    nombre === 'UnrecognizedActionError' ||
    (/server action/i.test(mensaje) && /not found|no se encontr/i.test(mensaje)) ||
    /failed-to-find-server-action/i.test(mensaje)
  );
}

export default function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    // El detalle completo al log del navegador: la pantalla no lo enseña,
    // pero quien tenga que diagnosticarlo lo necesita.
    console.error('[panel] error no controlado', error);

    if (!esDesfaseDeVersion(error)) return;

    let enBucle = false;
    try {
      const ultima = Number(sessionStorage.getItem(MARCA_RECARGA) ?? 0);
      enBucle = Date.now() - ultima < VENTANA_BUCLE_MS;
      sessionStorage.setItem(MARCA_RECARGA, String(Date.now()));
    } catch {
      // Navegación privada sin almacenamiento: se prefiere no recargar a
      // arriesgar un bucle que no se podría detectar.
      enBucle = true;
    }

    if (enBucle) return;

    setRecargando(true);
    window.location.reload();
  }, [error]);

  // Recarga en marcha: no se enseña un error que está a punto de desaparecer.
  if (recargando) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <h1 className="login-card__title">Actualizando el panel…</h1>
          <p className="login-card__subtitle">
            Se publicó una versión nueva. Un momento.
          </p>
        </div>
      </main>
    );
  }

  const desfase = esDesfaseDeVersion(error);

  return (
    <main className="login-shell">
      <div className="login-card">
        <h1 className="login-card__title">
          {desfase ? 'El panel se actualizó' : 'Algo se rompió'}
        </h1>

        <p className="login-card__subtitle">
          {desfase
            ? 'Tenías esta pestaña abierta desde antes de la última actualización. Recarga para seguir trabajando.'
            : 'No se pudo cargar esta pantalla. Puedes reintentar; si vuelve a fallar, avisa con el código de abajo.'}
        </p>

        <div className="row" style={{ gap: '0.5rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Recargar
          </button>

          {/*
            `reset()` reintenta el render sin recargar. No sirve para el
            desfase de versión —el JavaScript viejo sigue en memoria— así que
            sólo se ofrece cuando el error es otro.
          */}
          {!desfase && (
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Reintentar
            </button>
          )}
        </div>

        {/*
          El `digest` es el identificador con el que este error aparece en los
          logs del servidor. Es lo único que hace falta para encontrarlo, y no
          revela nada del sistema.
        */}
        {error.digest && (
          <p className="text-xs subtle mono" style={{ marginTop: '1rem' }}>
            Código: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
