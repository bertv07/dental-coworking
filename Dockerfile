# =============================================================================
#  Dental Coworking — imagen de producción
# =============================================================================
#  Tres etapas. Sólo la última acaba en el servidor, y lleva lo justo para
#  ATENDER peticiones y aplicar migraciones: ni compilador de TypeScript, ni
#  código fuente, ni dependencias de desarrollo.
#
#  Por qué importa más allá del tamaño: cada herramienta que sobra dentro del
#  contenedor es una herramienta que tiene a mano quien logre entrar.
# =============================================================================

# --- 1. Dependencias ---------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# `libc6-compat` lo necesitan los binarios nativos de Prisma y Argon2 sobre
# Alpine, que usa musl en vez de glibc.
RUN apk add --no-cache libc6-compat

# Se copian SÓLO los manifiestos antes que el código: mientras no cambien las
# dependencias, Docker reutiliza esta capa y no vuelve a instalar nada.
COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Compilación ----------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# El cliente de Prisma se genera a partir del esquema y hay que crearlo antes
# de compilar: el código lo importa en tiempo de tipos.
RUN npx prisma generate --schema backend/prisma/schema.prisma

# Valores de relleno SÓLO para el build.
#
# Next.js ejecuta las rutas durante la compilación para recolectar metadatos, y
# eso dispara la validación del entorno. Nadie se conecta a nada aquí: hacen
# falta valores con la FORMA correcta, no valores reales.
#
# Los secretos exigen 32 caracteres, así que estos rellenos los tienen. Si se
# quedan cortos, el build revienta al llegar a la primera ruta.
#
# ⚠️  Los de verdad los inyecta EasyPanel al ARRANCAR el contenedor y pisan a
#  estos. No queda ningún secreto real dentro de la imagen.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="relleno-de-compilacion-no-es-un-secreto-real"
ENV AUTOMATION_HMAC_SECRET="relleno-de-compilacion-no-es-un-secreto-real"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- 3. Ejecución ------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario sin privilegios. Por defecto los contenedores corren como root, y un
# fallo de ejecución remota dentro de la aplicación heredaría ese root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# `output: 'standalone'` deja aquí un servidor con sus dependencias mínimas.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# --- CLI de Prisma, aparte ---------------------------------------------------
#  Las migraciones se aplican al arrancar el contenedor, así que el CLI tiene
#  que estar aquí. Se instala en SU PROPIO directorio, no en /app.
#
#  Por qué no basta con copiar `node_modules/prisma` desde la etapa anterior:
#  el CLI arrastra sus propias dependencias transitivas, y copiar sólo dos o
#  tres paquetes deja un árbol incompleto que revienta con MODULE_NOT_FOUND al
#  arrancar. Copiar `node_modules` entero anularía la ventaja del standalone.
#
#  Por qué en /opt y no en /app: un `npm install` dentro de /app leería el
#  `package.json` mínimo que dejó el standalone y podría podar justo las
#  dependencias que la aplicación necesita para arrancar.
WORKDIR /opt/prisma-cli
RUN npm init -y > /dev/null \
 && npm install --no-audit --no-fund prisma@6 \
 && npm cache clean --force

WORKDIR /app

# El esquema y las migraciones: es lo que el CLI necesita leer.
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma ./backend/prisma

# Scripts de operación. Van en JavaScript plano a propósito: el seed original
# es TypeScript y necesita `tsx`, que es dependencia de desarrollo y no está
# en esta imagen. Éstos sólo usan lo que la aplicación ya lleva dentro.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
EXPOSE 3000

# `migrate deploy` (no `dev`): aplica las migraciones que ya existen y no
# intenta generar ninguna nueva ni pedir confirmación. Si falla, el
# contenedor no arranca — mejor eso que servir con el esquema desfasado.
CMD ["sh", "-c", "node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema backend/prisma/schema.prisma && node server.js"]
