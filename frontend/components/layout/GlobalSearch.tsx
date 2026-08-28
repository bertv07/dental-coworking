'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { IconSearch } from '@/frontend/components/ui/icons';

/**
 * Buscador global de la barra superior.
 *
 * Antes era decorativo (`readOnly`) y no hacía nada al escribir, lo cual es
 * peor que no tenerlo: promete una función que no existe. Ahora navega de
 * verdad a /pacientes con el término, que es donde vive la búsqueda ya
 * implementada en el servidor.
 *
 * Atajo ⌘K / Ctrl+K para enfocarlo, como anuncia la propia tecla mostrada.
 *
 * EN WHATSAPP BUSCA OTRA COSA
 * Estando en el monitor, buscar «María» y acabar en la ficha de una paciente
 * es justo lo contrario de lo que se quiere: ahí se busca el CHAT. Así que en
 * esa pantalla el mismo cuadro filtra las conversaciones —incluidos los
 * números que aún no son pacientes de nadie— y en el resto sigue yendo a
 * pacientes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');

  const enWhatsApp = pathname?.startsWith('/whatsapp') ?? false;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // `metaKey` en macOS, `ctrlKey` en Windows/Linux.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        // Sin esto, el navegador abre su propia barra de búsqueda.
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (!query) return;

    // El filtrado ocurre en el SERVIDOR: se navega con el término en la URL
    // en lugar de traer todos los pacientes al navegador para filtrarlos.
    router.push(
      enWhatsApp
        ? `/whatsapp?q=${encodeURIComponent(query)}`
        : `/pacientes?q=${encodeURIComponent(query)}`,
    );
  }

  /*
   * En WhatsApp filtra según se escribe, sin esperar al Enter.
   *
   * Es una lista corta que ya está en pantalla: obligar a pulsar Enter para
   * ver desaparecer tres filas se siente roto. En pacientes sí se espera al
   * Enter, porque eso es un cambio de pantalla.
   */
  useEffect(() => {
    if (!enWhatsApp) return undefined;
    const id = setTimeout(() => {
      const query = term.trim();
      router.replace(query ? `/whatsapp?q=${encodeURIComponent(query)}` : '/whatsapp');
    }, 250);
    return () => clearTimeout(id);
  }, [term, enWhatsApp, router]);

  return (
    <form className="topbar__search" onSubmit={onSubmit} role="search">
      <IconSearch size={16} />
      <input
        ref={inputRef}
        type="search"
        placeholder={
          enWhatsApp
            ? 'Buscar chat por nombre o número…'
            : 'Buscar paciente por nombre, teléfono o documento…'
        }
        aria-label={enWhatsApp ? 'Buscar conversaciones' : 'Buscar pacientes'}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      <kbd className="topbar__kbd">⌘K</kbd>
    </form>
  );
}
