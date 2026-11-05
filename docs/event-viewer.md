# Visor de eventos

React y Ant Design proporcionan tabla, filtros y panel lateral.
`@uiw/react-json-view` muestra el árbol JSON de solo lectura. IBM Plex Sans se
distribuye con la aplicación, sin solicitar fuentes a terceros.

Dirección: `https://zlink.trok.dev/events`. La raíz redirige al visor.
El webhook continúa en `/webhooks/zlink`.

Diseño: navegación azul marino (#102c42), fondo gris claro (#f3f6f9), superficies
blancas, acento azul (#136b9a), texto (#183044) y divisores (#dce5ec).
La tabla conserva el contexto al abrir el detalle lateral. Las métricas reflejan
todo el historial; el contador de la tabla refleja los filtros.
Los horarios son de Lima; el rango personalizado se interpreta en la zona del
navegador y se convierte a UTC.

## Acceso

Configurar en `.env`: `ZLINK_VIEWER_USER`, `ZLINK_VIEWER_PASSWORD_HASH` y
`ZLINK_VIEWER_SESSION_SECRET` (secreto aleatorio de al menos 32 caracteres).
Generar el hash sin dejar la contraseña en el historial:

```bash
.venv/bin/python -c 'from getpass import getpass; from app.viewer import hash_password; print(hash_password(getpass("Contraseña del visor: ")))'
```

El visor tiene contraseña propia: PBKDF2-SHA256, 600.000 iteraciones. Usa cookie
firmada, Secure, HttpOnly, SameSite=Strict y duración de ocho horas. Consultas con
`Cache-Control: no-store`. La cookie requiere HTTPS, también durante desarrollo.
El receptor de callbacks conserva su autenticación independiente.

Límite: cinco intentos fallidos por IP en cinco minutos, en memoria del proceso.
Para múltiples réplicas se necesita un almacén compartido. No hay roles ni
administración multiusuario. Cerrar sesión elimina la cookie; rotar el secreto
invalida todas las sesiones. Las credenciales no se guardan en el navegador.

## Compilación

```bash
cd frontend
npm ci
npm run build
```

FastAPI sirve `frontend/dist/`. Los compilados se excluyen de Git: compilar o
transferir ese directorio al servidor antes de reiniciar `zlink`.
No se necesitan cambios en el túnel ni puertos adicionales.

## Datos

`GET /api/events`: búsqueda literal (`q`), tipo (`event_code`), fechas ISO con zona
(`since`, `until`), página, tamaño (máximo 100) y orden. Solo devuelve resúmenes
acotados. `GET /api/events/{request_id}` obtiene el JSON completo bajo demanda.
Índices por fecha y código/fecha; para búsquedas de JSON en historiales muy grandes
considerar FTS, ya que la búsqueda actual usa LIKE.

La actualización consulta cada diez segundos y se pausa con la pestaña oculta.
Los errores conservan la última vista con una alerta. No se insertan datos de
demostración en producción: `integration.test` identifica las pruebas anteriores.
Copiar y descargar solo actúan sobre el evento seleccionado.
