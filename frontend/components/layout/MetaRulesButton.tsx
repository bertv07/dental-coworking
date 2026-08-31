'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconChat } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Reglas de Meta, en la barra de arriba
 * ===========================================================================
 *  Un atajo a WhatsApp y, sobre todo, el recordatorio de la regla que más
 *  problemas causa: fuera de las 24 horas siguientes al último mensaje del
 *  paciente NO se puede escribir texto libre, hace falta una plantilla
 *  aprobada por Meta.
 *
 *  Está aquí y no enterrado en la documentación porque el momento en que hace
 *  falta saberlo es justo cuando alguien va a escribirle a un paciente que
 *  lleva días sin hablar — y para entonces ya nadie va a buscar un manual.
 * ===========================================================================
 */

export function MetaRulesButton() {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Se cierra al pulsar fuera o con Escape, como cualquier menú de la barra.
  useEffect(() => {
    if (!abierto) return undefined;

    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false);
    }

    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  return (
    <div className="dropdown-anchor" ref={caja}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        title="WhatsApp y reglas de Meta"
        aria-label="WhatsApp y reglas de Meta"
      >
        <IconChat size={18} />
      </button>

      {abierto && (
        <div className="dropdown meta-rules" role="dialog" aria-label="Reglas de Meta">
          <div className="dropdown__header">
            <span>Escribir por WhatsApp</span>
          </div>

          <p className="meta-rules__regla">
            <strong>La ventana de 24 horas.</strong> Puedes escribirle libremente a
            alguien sólo dentro de las 24 h siguientes a su último mensaje. Pasado ese
            rato, Meta únicamente deja enviar una <strong>plantilla aprobada</strong>.
          </p>

          <p className="meta-rules__regla">
            <strong>Promociones, sólo a quien las autorizó.</strong> Los mensajes de
            oferta y de cumpleaños van nada más a los pacientes que dieron permiso. Es
            lo que evita que bloqueen el número de la clínica.
          </p>

          <p className="meta-rules__regla">
            <strong>Nada clínico por plantilla.</strong> Un recordatorio dice qué cita
            hay; nunca diagnósticos, resultados ni deudas.
          </p>

          <div className="dropdown__footer meta-rules__pie">
            <Link href="/whatsapp" className="btn btn--primary btn--sm" onClick={() => setAbierto(false)}>
              Abrir los chats
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
