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

  const enWhatsApp = pathname?.startsWith('/whatsapp') ?? false;

  /*
   * El cuadro arranca con lo que YA haya en la URL (`?q=...`), leído de
   * `window.location` y no de `useSearchParams()`: ese hook exige envolver
   * el componente en un límite `<Suspense>`, y este vive en la barra
   * superior de TODAS las páginas del panel — tocar ese límite aquí
   * afectaría a pantallas que no tienen nada que ver con esto.
   */
  const [term, setTerm] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('q') ?? ''),
  );

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
   *
   * ---------------------------------------------------------------------
   *  POR QUÉ SE RECONSTRUYE LA URL EN VEZ DE FIJAR "/whatsapp?q=..."
   * ---------------------------------------------------------------------
   *  La versión anterior sustituía la URL entera por `/whatsapp` (vacío) o
   *  `/whatsapp?q=...`, sin mirar qué más llevaba puesto. Eso borraba
   *  `archivadas=1`: al entrar al listado de archivados, este mismo efecto
   *  se disparaba igual —el cuadro estaba vacío, "no había nada que
   *  buscar"— y un cuarto de segundo después devolvía a `/whatsapp` a
   *  secas. La pantalla de archivados se veía un instante y se cerraba
   *  ella sola: el bug que se reportó como "entra y sale de una vez".
   *
   *  Ahora se parte de los parámetros que YA tiene la URL y sólo se toca
   *  `q`, y si el resultado es idéntico a la URL actual NO SE NAVEGA. Así
   *  el efecto no hace nada la primera vez que se entra a la pantalla —
   *  sólo actúa cuando el usuario de verdad escribe o borra algo.
   */
  useEffect(() => {
    if (!enWhatsApp) return undefined;

    const id = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const query = term.trim();
      if (query) params.set('q', query);
      else params.delete('q');

      const search = params.toString();
      const target = search ? `/whatsapp?${search}` : '/whatsapp';
      const actual = `/whatsapp${window.location.search}`;

      if (target !== actual) router.replace(target);
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
