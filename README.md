# ZLINK API

Receptor de callbacks de ZKBio Zlink con FastAPI y una bandeja de eventos SQLite.

Incluye un [visor privado de eventos](docs/event-viewer.md) en `/events`, construido
con React y Ant Design: búsqueda, filtros, paginación, actualización automática
y detalle JSON. La raíz abre el dashboard `/dashboard`. También incluye
administración de usuarios en `/users` y la [consola de API](docs/api-console.md)
en `/integration`, con las 31 operaciones y 21 guías de la documentación oficial.
La interfaz completa admite español e inglés con i18next.

## Desarrollo

Requiere Python 3.10 o superior.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
# Configurar las variables de .env.example en el entorno antes de iniciar.
python -m uvicorn app.main:app --host 127.0.0.1 --port 3000 --reload
```

En Windows, activar con `.venv\Scripts\Activate.ps1`.

## Debian

Ruta del proyecto: `/home/trok/apps/zlink`.

```bash
mkdir -p /home/trok/apps
git clone https://github.com/TrokNet/zlink.git /home/trok/apps/zlink
cd /home/trok/apps/zlink
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
# Completar .env con los valores de la aplicación antes de iniciar el servicio.
sudo install -m 644 deploy/zlink.service /etc/systemd/system/zlink.service
sudo systemctl daemon-reload
sudo systemctl enable --now zlink
```

Si falta el soporte de entornos virtuales: `sudo apt install python3-venv`.

Para actualizar:

```bash
cd /home/trok/apps/zlink
git pull --ff-only
.venv/bin/python -m pip install -r requirements.txt
sudo systemctl restart zlink
```

Estado y registros:

```bash
sudo systemctl status zlink
sudo journalctl -u zlink -n 100 --no-pager
curl http://127.0.0.1:3000/health
```

## Cloudflare

El túnel `adms-tunnel` debe ejecutarse en el mismo servidor y publicar
`zlink.trok.dev` hacia `http://127.0.0.1:3000`, con el campo Path vacío.
Uvicorn escucha solo en loopback; Cloudflare proporciona HTTPS público.

- Inicio: https://zlink.trok.dev/
- Salud: https://zlink.trok.dev/health
- Swagger: https://zlink.trok.dev/docs
- OpenAPI: https://zlink.trok.dev/openapi.json

No se deben subir contraseñas, claves privadas ni archivos `.env` al repositorio.

## Webhook de ZKBio Zlink

Request URL: `https://zlink.trok.dev/webhooks/zlink` (sin barra final).
Seleccionar **Send events to developer's server**, guardar, añadir los eventos
y permisos necesarios, y publicar la versión para activar las suscripciones.

El mismo endpoint acepta:

- `GET`: verifica la firma y devuelve el desafío `echo` descifrado como
  `{"code":"ZCOP0000","message":"Operation successful","data":"..."}`.
- `POST`: valida, descifra y guarda el evento antes de responder HTTP 200.

Ambos métodos requieren los parámetros de consulta `sign`, `timestamp` y `nonce`.
La firma es MD5 hexadecimal en minúsculas de la concatenación exacta
`Verification Token + timestamp + nonce`. Se permiten cinco minutos de desfase
en ambas direcciones. El descifrado sigue AES/CBC/NoPadding, con ciphertext
hexadecimal, AppKey como clave y Encryption Key como IV de 16 bytes.

Configurar en `/home/trok/apps/zlink/.env`:

- `ZLINK_APP_KEY`: Basic Info & Credentials > AppKey.
- `ZLINK_ENCRYPTION_KEY`: Events & Callbacks > Encryption Settings > Encryption Key.
- `ZLINK_VERIFICATION_TOKEN`: Events & Callbacks > Encryption Settings > Verification Token.
- `ZLINK_DATABASE_PATH`: ruta de la base de datos; por defecto `.local/events.sqlite3`.

El AppSecret no es necesario para recibir estos callbacks. El servicio systemd
carga `.env`; Uvicorn iniciado manualmente requiere exportar las variables al
entorno. No se registran los cuerpos ni los secretos en los logs.

El POST requiere `requestId`, `eventCode` y `encryptData`. El payload descifrado
debe ser JSON. La tabla `events` conserva el identificador, código, contenido
cifrado, JSON descifrado y fecha UTC. Un índice único por `requestId` evita
duplicados, incluso en entregas concurrentes. Las consultas del visor requieren
una sesión autenticada. Los eventos se conservan hasta definir una política de retención;
incluir `.local/` en las copias de seguridad privadas del servidor.

Se limita cada callback a 1 MiB. Las firmas inválidas y los timestamps fuera de
ventana se rechazan; un fallo de almacenamiento devuelve 503 para que Zlink
reintente. Esta versión recibe y conserva eventos; no ejecuta lógica de negocio.

### Pruebas

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas utilizan credenciales ficticias y una base temporal.

### Protocolo oficial

- [Verificación de la URL](https://zlink-help.minervaiot.com/hc/articles/pc/8a8883949a54d914019a7ff086cf0016/8a8883949a54d914019a8056e1d9010f)
- [Recepción, firma y descifrado](https://zlink-help.minervaiot.com/hc/articles/pc/8a8883949a54d914019a7ff3d856003a/8a8883949a54d914019a80008aed0088)
- [Eventos, reintentos y duplicados](https://zlink-help.minervaiot.com/hc/articles/pc/8a88857b9ca17652019cdc58c35f000b/8a88857b9ca17652019cdc593110000f)

La guía describe una ventana de cinco minutos; su ejemplo Java contiene
`3000000` ms, que no equivale a cinco minutos. El receptor aplica `300000` ms.
