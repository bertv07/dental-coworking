import type { ReactNode } from 'react';

/**
 * ===========================================================================
 *  Odontograma
 * ===========================================================================
 *  Las 32 piezas de la dentición permanente en notación FDI, que es la que se
 *  usa en Venezuela y en la mayor parte del mundo.
 *
 *  CÓMO SE LEE LA NOTACIÓN
 *  El primer dígito es el cuadrante visto DESDE EL PACIENTE, no desde quien
 *  mira la lámina — por eso el cuadrante 1 aparece a la izquierda del papel
 *  aunque sea el lado derecho del paciente. Es la convención, y cambiarla para
 *  que "se lea mejor" haría que el impreso no coincidiera con lo que el
 *  odontólogo tiene en la cabeza.
 *
 *      18 17 16 15 14 13 12 11 │ 21 22 23 24 25 26 27 28   ← superior
 *      48 47 46 45 44 43 42 41 │ 31 32 33 34 35 36 37 38   ← inferior
 *
 *  El segundo dígito es la pieza: 1 el incisivo central, 8 la muela del juicio.
 *
 *  ---------------------------------------------------------------------
 *  ESTE COMPONENTE SIRVE PARA LAS DOS COSAS
 *  ---------------------------------------------------------------------
 *  Impreso en blanco (casillas vacías para marcar a lápiz) y en pantalla con
 *  el estado ya transcrito. Es el MISMO componente: si fueran dos, el papel y
 *  la pantalla acabarían divergiendo y el odontólogo marcaría una casilla que
 *  luego no existe en el sistema.
 * ===========================================================================
 */

/** Cuadrantes en el orden en que se imprimen. */
const SUPERIOR_DERECHA = ['18', '17', '16', '15', '14', '13', '12', '11'];
const SUPERIOR_IZQUIERDA = ['21', '22', '23', '24', '25', '26', '27', '28'];
const INFERIOR_DERECHA = ['48', '47', '46', '45', '44', '43', '42', '41'];
const INFERIOR_IZQUIERDA = ['31', '32', '33', '34', '35', '36', '37', '38'];

/** Estados posibles de una pieza. La abreviatura es lo que se marca a mano. */
export const ESTADOS_PIEZA = {
  SANO: { abreviatura: '', etiqueta: 'Sano', color: 'var(--color-text-subtle)' },
  CARIES: { abreviatura: 'C', etiqueta: 'Caries', color: 'var(--color-danger)' },
  OBTURADO: { abreviatura: 'O', etiqueta: 'Obturado', color: 'var(--color-primary)' },
  CORONA: { abreviatura: 'K', etiqueta: 'Corona', color: 'var(--color-warning)' },
  AUSENTE: { abreviatura: 'X', etiqueta: 'Ausente', color: 'var(--color-text-subtle)' },
  EXTRACCION: { abreviatura: 'E', etiqueta: 'Extracción indicada', color: 'var(--color-danger)' },
  IMPLANTE: { abreviatura: 'I', etiqueta: 'Implante', color: 'var(--color-success)' },
  ENDODONCIA: { abreviatura: 'N', etiqueta: 'Endodoncia', color: 'var(--color-warning)' },
} as const;

export type EstadoPieza = keyof typeof ESTADOS_PIEZA;

/** Lo que se guarda en la columna JSON del expediente. */
export type OdontogramaDatos = Record<string, { estado: EstadoPieza; notas?: string } | undefined>;

/** Todas las piezas, para recorrerlas al validar o al guardar. */
export const TODAS_LAS_PIEZAS = [
  ...SUPERIOR_DERECHA,
  ...SUPERIOR_IZQUIERDA,
  ...INFERIOR_DERECHA,
  ...INFERIOR_IZQUIERDA,
];

function Pieza({ numero, datos }: { numero: string; datos: OdontogramaDatos | null }) {
  const estado = datos?.[numero]?.estado;
  const meta = estado ? ESTADOS_PIEZA[estado] : null;

  return (
    <div className="odonto__pieza">
      {/*
        La casilla va ARRIBA y el número debajo, como en el impreso clásico:
        el odontólogo marca la casilla mirando el número que tiene justo
        debajo, sin tener que buscarlo.
      */}
      <div
        className={`odonto__casilla${meta && meta.abreviatura ? ' odonto__casilla--marcada' : ''}`}
        style={meta && meta.abreviatura ? { color: meta.color, borderColor: meta.color } : undefined}
        title={meta?.etiqueta}
      >
        {meta?.abreviatura ?? ''}
      </div>
      <span className="odonto__numero">{numero}</span>
    </div>
  );
}

function Fila({ izquierda, derecha, datos }: {
  izquierda: string[];
  derecha: string[];
  datos: OdontogramaDatos | null;
}) {
  return (
    <div className="odonto__fila">
      <div className="odonto__cuadrante">
        {izquierda.map((n) => <Pieza key={n} numero={n} datos={datos} />)}
      </div>
      {/* La línea media: separa los cuadrantes izquierdo y derecho. */}
      <div className="odonto__media" aria-hidden="true" />
      <div className="odonto__cuadrante">
        {derecha.map((n) => <Pieza key={n} numero={n} datos={datos} />)}
      </div>
    </div>
  );
}

export function Odontogram({ datos = null }: { datos?: OdontogramaDatos | null }) {
  return (
    <div className="odonto">
      <Fila izquierda={SUPERIOR_DERECHA} derecha={SUPERIOR_IZQUIERDA} datos={datos} />
      <Fila izquierda={INFERIOR_DERECHA} derecha={INFERIOR_IZQUIERDA} datos={datos} />

      {/* La leyenda va SIEMPRE, también en el impreso en blanco: es lo que le
          dice al odontólogo qué letra poner en cada casilla. */}
      <div className="odonto__leyenda">
        {Object.entries(ESTADOS_PIEZA)
          .filter(([, meta]) => meta.abreviatura)
          .map(([clave, meta]) => (
            <span key={clave} className="odonto__leyenda-item">
              <b style={{ color: meta.color }}>{meta.abreviatura}</b> {meta.etiqueta}
            </span>
          ))}
      </div>
    </div>
  );
}

/** Renglones en blanco para escribir a mano. Sólo tienen sentido impresos. */
export function Renglones({ cantidad, children }: { cantidad: number; children?: ReactNode }) {
  if (children) return <div className="renglon-texto">{children}</div>;
  return (
    <div className="renglones">
      {Array.from({ length: cantidad }, (_, i) => (
        <span key={i} className="renglon" />
      ))}
    </div>
  );
}
