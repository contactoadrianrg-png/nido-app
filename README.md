# 🏠 Mi Familia

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
- **Base de datos:** SQLite (better-sqlite3)
- **Auth:** JWT + bcryptjs
- **Notificaciones:** Telegram Bot API
- **Frontend:** Vanilla JS + CSS (sin frameworks)

---

## Despliegue en Railway

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
| `PORT` | (Railway lo pone automáticamente) | Puerto del servidor |
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

SQLite guarda los datos en `familia.db`. Railway tiene **volúmenes persistentes**:

1. En tu servicio → **Volumes** → **Add Volume**
2. Mount path: `/app` (o donde Railway clone el repo)
3. Esto garantiza que la base de datos sobrevive a reinicios y redeploys

> Sin volumen, los datos se pierden en cada redeploy.

### 5. Primer acceso

Tras el despliegue, accede a tu URL y el sistema crea automáticamente la cuenta admin con las credenciales de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Entra en `/login` con esas credenciales.

---

## Desarrollo local

```bash
# Instalar dependencias
npm install

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

JWT_SECRET=cambia_esto_por_algo_seguro
ADMIN_EMAIL=admin@familia.local
ADMIN_PASSWORD=admin1234
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
