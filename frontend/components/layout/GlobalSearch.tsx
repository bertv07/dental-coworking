'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
 */
export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');

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
    router.push(`/pacientes?q=${encodeURIComponent(query)}`);
  }

  return (
    <form className="topbar__search" onSubmit={onSubmit} role="search">
      <IconSearch size={16} />
      <input
        ref={inputRef}
        type="search"
        placeholder="Buscar paciente por nombre, teléfono o documento…"
        aria-label="Buscar pacientes"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      <kbd className="topbar__kbd">⌘K</kbd>
    </form>
  );
}
