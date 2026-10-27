# 🏠 Nido

App web multi-usuario para registrar y gestionar actividades de los hijos. Diseño tipo app móvil, recordatorios automáticos por Telegram y exportación a calendario (.ics).

## Funcionalidades

- Registro e inicio de sesión con email y contraseña (JWT)
- Cada usuario tiene sus propios hijos y eventos
- Categorías: médica, examen, excursión, deporte, colegio, otro
- Recordatorios diarios por Telegram a la hora configurada por cada usuario
- Estadísticas por hijo, categoría y mes
- Exportación a formato iCal (.ics)
- Panel de administración para ver usuarios registrados
- Recuperación de contraseña por email

## Tecnología

- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (pg)
- **Auth:** JWT + bcryptjs
- **Notificaciones:** Telegram Bot API
- **Frontend:** Vanilla JS + CSS (sin frameworks)

---

## Despliegue en un servidor Node.js

### 1. Preparar el repositorio

```bash
git init
git add .
git commit -m "Initial commit"
```

### 2. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. Haz clic en **New Project → Deploy from GitHub repo**
3. Conecta tu repositorio

Railway detecta automáticamente Node.js y ejecuta `npm start`.

### 3. Configurar variables de entorno

En Railway → tu servicio → **Variables**, añade:

| Variable | Valor | Descripción |
|---|---|---|
| `PORT` | Lo proporciona el alojamiento | Puerto del servidor |
| `DATABASE_URL` | Configurar en el alojamiento | Conexión PostgreSQL externa |
| `JWT_SECRET` | Una cadena aleatoria larga | Secreto para firmar tokens |
| `ADMIN_EMAIL` | tu@email.com | Email del primer administrador |
| `ADMIN_PASSWORD` | contraseña segura | Contraseña del administrador |
| `APP_URL` | https://tu-app.railway.app | URL pública de la app |
| `TIMEZONE` | Europe/Madrid | Zona horaria para recordatorios |
| `SMTP_HOST` | smtp.gmail.com | (Opcional) Para emails de recuperación |
| `SMTP_PORT` | 587 | |
| `SMTP_USER` | tu@gmail.com | |
| `SMTP_PASS` | app-password | |
| `SMTP_FROM` | noreply@tu-app.com | |

> **JWT_SECRET:** Genera uno seguro con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

> **Sin SMTP:** Los enlaces de recuperación de contraseña aparecerán en los logs de Railway.

### 4. Persistencia de la base de datos

Los datos se guardan en PostgreSQL, mediante `DATABASE_URL`. El repositorio no contiene las cuentas, citas ni copias de la base de datos. Para recuperar datos anteriores hace falta conservar la base original o una copia de seguridad.

### Despliegue existente en Vercel

`vercel.json` dirige las peticiones a `src/server.js`. Configura `DATABASE_URL`, `JWT_SECRET`, `APP_URL` y `CRON_SECRET` en el proyecto Nido. Usa una conexión PostgreSQL externa accesible desde Vercel; para un proveedor con agrupación de conexiones, utiliza su conexión apropiada para funciones sin servidor. Guarda los valores confidenciales en el alojamiento, fuera del repositorio.

El cron de Vercel se ejecuta a las 08:00 UTC. No se envían recordatorios por esa ruta sin `CRON_SECRET`.

`GET /api/health` comprueba únicamente la conexión con PostgreSQL y devuelve 200 o 503, sin mostrar la URL, credenciales ni errores internos. Las páginas públicas se sirven aunque falle la base. Las operaciones API inicializan el esquema y pueden volver a intentarlo tras un fallo. Las rutas de diagnóstico temporales `/api/debug/*` están retiradas.

### 5. Primer acceso

Tras el despliegue, accede a tu URL y el sistema crea una cuenta admin solamente si la base está vacía y has configurado tanto `ADMIN_EMAIL` como `ADMIN_PASSWORD`. Sin ambas variables puedes crear una cuenta normal en `/register`; no se crean credenciales de administrador por defecto. Entra en `/login` con esas credenciales.

---

## Desarrollo local

```bash
# Instalar dependencias
npm ci

# Crear archivo de entorno
cp .env.example .env
# Edita .env con tus valores

# Iniciar servidor
npm start

# O con recarga automática
npm run dev
```

La app queda disponible en `http://localhost:3000`.

### Variables de entorno locales (.env)

```env
PORT=3000
TIMEZONE=Europe/Madrid

DATABASE_URL=
JWT_SECRET=cambia_esto_por_algo_seguro
ADMIN_EMAIL=
ADMIN_PASSWORD=
CRON_SECRET=
APP_URL=http://localhost:3000

# Telegram (se configura también por usuario desde el perfil)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID_1=

# Email (opcional — sin esto usa la consola)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@familia.app
```

## Configurar Telegram

1. Habla con `@BotFather` en Telegram → `/newbot` → copia el **Bot Token**
2. Obtén tu **Chat ID** hablando con `@userinfobot`
3. En la app → Configuración → sección Telegram → pega ambos valores
4. Pulsa **Mensaje de prueba** para verificar

Los recordatorios se envían automáticamente a la hora configurada si hay eventos ese día o el siguiente.

## Comprobar los cambios

Ejecuta `npm test`. Las pruebas cubren la recuperación después de una conexión fallida, peticiones simultáneas, páginas disponibles durante la caída, retirada de diagnósticos públicos y arranque sin administrador por defecto. Utilizan una base simulada; la comprobación con PostgreSQL real sigue siendo necesaria después de configurar el alojamiento.
