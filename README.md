# ZLINK API

Proyecto base de FastAPI, sin base de datos ni lógica de negocio.

## Desarrollo

Requiere Python 3.10 o superior.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
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
