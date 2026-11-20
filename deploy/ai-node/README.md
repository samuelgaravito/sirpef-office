# Nodo de IA local

Equipo Linux que pone su GPU al servicio de SirpefOffice. Ollama corre en
Docker y un agente pequeño mantiene un túnel saliente con el servidor: **no se
abre ningún puerto** y Ollama no es accesible desde la red.

```
PC (este compose)                                Servidor
┌──────────────────────────────┐                ┌──────────────────────────┐
│  ollama  ◄── agente ─────────┼── WSS 443 ────►│  API + túnel de nodos    │
│  (GPU)        (~200 líneas)  │                │  prompt, saneado, audit  │
└──────────────────────────────┘                └──────────────────────────┘
```

## Requisitos

- Linux con Docker Engine y el plugin `docker compose`.
- Driver NVIDIA y `nvidia-container-toolkit` (solo si el equipo tiene GPU).
- Unos 12 GB libres para la imagen y el modelo.
- Salida al 443 del servidor (el mismo puerto que ya usa el navegador).

Comprobaciones rápidas:

```bash
docker compose version
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

## Puesta en marcha

1. En la aplicación: **Ajustes → Asistente de IA → Mi equipo → Crear equipo**.
   Copia el token (solo se muestra una vez).
2. En la PC, dentro de esta carpeta:

```bash
cp .env.example .env
# edita SD_SERVER y SD_TOKEN
./install.sh
```

El instalador comprueba Docker, detecta la GPU, arranca los servicios y
descarga `qwen2.5:14b`. Si prefieres hacerlo a mano:

```bash
docker compose up -d
docker compose exec ollama ollama pull qwen2.5:14b
```

3. Vuelve a la aplicación: el equipo debe aparecer **conectado**, con su GPU,
   sus modelos y los tokens por segundo.

## Cómo se distribuye la imagen del agente

Sin registro interno (lo más simple):

```bash
# en la máquina de desarrollo
docker build -t sirpef-ai-node:1.0 ./agent
docker save sirpef-ai-node:1.0 | gzip > sirpef-ai-node-1.0.tar.gz

# en cada PC
gunzip -c sirpef-ai-node-1.0.tar.gz | docker load
```

Con registro interno, basta publicarla y dejar `AI_NODE_IMAGE` apuntando a ella:

```bash
docker build -t registro.interno/sirpef-ai-node:1.0 ./agent
docker push registro.interno/sirpef-ai-node:1.0
```

## Actualizar

```bash
docker compose pull agente   # si viene de un registro
docker load -i sirpef-ai-node-<nueva>.tar.gz   # si viene de un tar
docker compose up -d agente
```

## Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| El agente no conecta y sale con código 4401 | Token inválido o revocado. Crea un equipo nuevo y actualiza `SD_TOKEN`. |
| El agente no conecta y reintenta | El servidor no es alcanzable: revisa `SD_SERVER` y `curl -I https://…`. |
| El equipo aparece conectado pero sin GPU | Falta `nvidia-container-toolkit` o el driver. Prueba el comando `docker run --rm --gpus all …`. |
| La redacción tarda minutos | Está en CPU. Revisa la GPU o usa `qwen2.5:7b`. |
| «El modelo no está descargado» | `docker compose exec ollama ollama pull qwen2.5:14b`. |
| Se corta a los 5 minutos | Revisa el `proxy_read_timeout` del nginx del servidor para `/api/ai/node`. |

## Notas

- La imagen de Ollama está **fijada en `0.20.0`**: funciona con el driver 535 y
  con el 550+, y evita el fallo silencioso a CPU de las versiones nuevas con
  drivers antiguos.
- El agente solo reenvía `/api/chat` y las consultas de estado
  (`/api/version`, `/api/tags`, `/api/ps`). No guarda documentos ni respuestas.
- Un equipo atiende **un trabajo a la vez**; el servidor encola el resto.
