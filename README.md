# Asistente de Control de Gastos Personales con MCP y LLM Local

Aplicación de consola desarrollada en **TypeScript / Node.js** que implementa el **Model Context Protocol (MCP)** sobre transporte HTTP (`StreamableHTTPServerTransport`) y la conecta con un modelo de lenguaje local ejecutado mediante **Ollama**.

El asistente permite gestionar gastos personales almacenados localmente en `data/gastos.json` (registrar, consultar todos, consultar por ID, actualizar, eliminar y calcular el total gastado). El LLM local decide de forma autónoma **cuándo** invocar cada herramienta y **con qué parámetros**; el cliente no contiene reglas `if/else` que reconozcan preguntas específicas.

---

## Arquitectura del flujo

```text
Usuario (consola) ──▶ Cliente/Host MCP ──▶ LLM local (Ollama)
                            │                     │
                            │◀── tool_calls ──────┘
                            ▼
                   Servidor MCP (HTTP /mcp)
                            │
                            ▼
                     data/gastos.json
                            │
                            ▼
              Cliente agrega mensaje `tool` al historial
                            │
                            ▼
        2.ª llamada al LLM local ──▶ Respuesta final al usuario
```

Si el modelo solicita más herramientas, el ciclo se repite hasta que devuelve un mensaje sin `tool_calls`.

---

## Estructura del proyecto

```text
expense_tracker/
├── data/
│   └── gastos.json        # Datos iniciales de prueba
├── src/
│   ├── server.ts          # Servidor MCP (HTTP)
│   └── client.ts          # Cliente/host: chat + LLM local + llamadas MCP
├── .env.example           # Plantilla de configuración (sin secretos)
├── gastos.example.json    # Ejemplo de estructura de datos de gastos
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

---

## Requisitos previos

* **Node.js** v20.6 o superior (necesario para el soporte nativo de `--env-file`).
* **Ollama** instalado y en ejecución local (por defecto en `http://localhost:11434`).

---

## Instalación y configuración

### 1. Instalar dependencias

Desde la carpeta raíz del proyecto (`expense_tracker`):

```bash
npm install
```

Esto instala `@modelcontextprotocol/sdk`, `zod`, `tsx` y `@types/node`.

### 2. Descargar y preparar el modelo local en Ollama

Asegúrate de que Ollama esté corriendo y descarga el modelo configurado:

```bash
ollama pull gemma4:e4b
```

Puedes comprobar que quedó instalado con:

```bash
ollama list
```

*(Nota: si el equipo tiene poca VRAM, también es compatible un modelo más ligero con soporte de herramientas, como `qwen2.5:3b`. Solo cambia `LLM_MODEL` en el `.env`.)*

### 3. Configurar las variables de entorno

Copia la plantilla `.env.example` para crear tu archivo `.env` local:

```bash
cp .env.example .env
```

En Windows (PowerShell): `Copy-Item .env.example .env`

El archivo `.env` debe tener la siguiente estructura:

```env
# Servidor MCP (host y puerto en los que escucha)
HOST=localhost
PORT=5000

# Dirección completa del servidor MCP que usa el cliente (protocolo, host, puerto y ruta)
MCP_SERVER_URL=http://localhost:5000/mcp

# Proveedor y LLM
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_CHAT_PATH=/api/chat
LLM_MODEL=gemma4:e4b
```

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `HOST` | Host en el que escucha el servidor MCP | `localhost` |
| `PORT` | Puerto del servidor MCP | `5000` |
| `MCP_SERVER_URL` | URL completa del servidor MCP usada por el cliente | *(obligatoria)* |
| `LLM_PROVIDER` | Nombre del proveedor del modelo | `ollama` |
| `LLM_BASE_URL` | URL base de la API del LLM | *(obligatoria)* |
| `LLM_CHAT_PATH` | Ruta del endpoint de chat | `/api/chat` |
| `LLM_MODEL` | Nombre del modelo local | *(obligatoria)* |

Si falta alguna variable obligatoria, el cliente muestra un mensaje de error y termina. El proveedor, las direcciones y el nombre del modelo pueden configurarse desde el `.env`; no se utilizan tokens ni secretos.

### 4. Verificar los datos iniciales

El archivo `data/gastos.json` contiene los registros de prueba para reproducir la demostración:

```json
[
  {
    "id": 1,
    "descripcion": "Comida corrida y agua fresca",
    "monto": 150
  },
  {
    "id": 2,
    "descripcion": "Recarga de transporte público",
    "monto": 200
  },
  {
    "id": 3,
    "descripcion": "internet",
    "monto": 200
  }
]
```

Si el archivo no existe, el servidor lo crea automáticamente vacío (`[]`).

---

## Ejecución del sistema

El sistema requiere **dos terminales independientes**, ambas ubicadas en la carpeta raíz `expense_tracker`. Antes de empezar, verifica que Ollama esté en ejecución.

### Terminal 1: iniciar el servidor MCP

```bash
npx tsx --env-file=.env src/server.ts
```

### Terminal 2: iniciar el cliente / chat con el asistente

```bash
npx tsx --env-file=.env src/client.ts
```

Al iniciar, el cliente muestra la configuración efectiva (modelo, URL del LLM y URL del servidor MCP), se conecta al servidor MCP y lista las herramientas descubiertas.

### Comandos dentro del chat

* Escribe cualquier consulta en lenguaje natural sobre tus gastos.
* Escribe `nuevo` para limpiar el historial de la conversación y comenzar desde cero.
* Escribe `salir` para cerrar la sesión y desconectar el cliente MCP.

Por cada herramienta que el modelo solicite, el cliente imprime el nombre, los argumentos y el resultado de la llamada MCP antes de mostrar la respuesta final del asistente. Tras cada ronda de herramientas, el cliente reenvía el historial actualizado al LLM (segunda llamada) y lo indica con el mensaje `(LLM) Enviando el resultado de la herramienta al modelo para la respuesta final...`.

---

## Herramientas MCP expuestas

| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `registrar-gasto` | `descripcion` (string, no vacío), `monto` (number > 0) | Registra un nuevo gasto asignando un ID incremental automático. |
| `consultar-gastos` | *(ninguno)* | Devuelve la lista completa de gastos registrados en `data/gastos.json`. |
| `consultar-gasto` | `id` (entero > 0) | Busca y devuelve el detalle de un gasto específico por su ID. |
| `actualizar-gasto` | `id` (entero > 0), `descripcion?` (string), `monto?` (number > 0) | Actualiza la descripción y/o el monto de un gasto existente. Requiere al menos uno de los dos campos opcionales. |
| `eliminar-gasto` | `id` (entero > 0) | Elimina un gasto del archivo JSON a partir de su ID. |
| `calcular-total-gastos` | *(ninguno)* | Suma los montos de todos los registros y devuelve el total gastado. |

Además, el servidor expone el recurso `gastos://about` con una descripción breve del servicio.

### Validaciones

* Los parámetros se validan con **zod** (tipos, enteros, valores positivos y cadenas no vacías).
* Si un ID no existe, o si en `actualizar-gasto` no se envía ningún campo a modificar, la herramienta responde con `isError: true` y un mensaje en español comprensible, que el LLM usa para explicar el problema al usuario.

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
| :--- | :--- | :--- |
| `Faltan variables en el archivo .env` | No se creó `.env` o se ejecutó sin `--env-file=.env` | Copia `.env.example` a `.env` y usa el comando completo. |
| `ECONNREFUSED` al conectar con el MCP | El servidor no está iniciado o el puerto no coincide | Inicia la Terminal 1 y verifica que `PORT` coincida con `MCP_SERVER_URL`. |
| Error HTTP de Ollama (404 o conexión rechazada) | Ollama no está corriendo o el modelo no está descargado | Inicia Ollama y ejecuta `ollama pull <modelo>`. |
| El modelo responde sin usar herramientas | El modelo no soporta *tool calling* | Usa un modelo compatible con herramientas. |
| `EADDRINUSE` | El puerto ya está ocupado | Cambia `PORT` y `MCP_SERVER_URL` en el `.env`. |

---

## Evidencias de funcionamiento

### 1. Servidor MCP iniciado y accesible en su URL

```text
Gastos MCP Server corriendo en http://localhost:5000
Endpoint para conectarse: http://localhost:5000/mcp
Archivo de datos: .../expense_tracker/data/gastos.json
```

### 2. Cliente mostrando el modelo, la URL del LLM y la URL del servidor MCP utilizados

```text
Configuración actual: 
  Proveedor    : ollama
  Modelo local : gemma4:e4b
  API del LLM  : http://localhost:11434/api/chat
  Servidor MCP : http://localhost:5000/mcp
```

### 3. Cliente descubriendo las herramientas MCP

```text
Realizando conexión al servidor MCP...
Herramientas disponibles:
  - registrar-gasto: Registra un nuevo gasto personal
  - consultar-gastos: Obtiene la lista completa de todos los gastos personales registrados
  - consultar-gasto: Consulta el detalle de un gasto específico buscando por su ID numérico
  - actualizar-gasto: Actualiza la descripción y/o el monto de un gasto existente usando su ID
  - eliminar-gasto: Elimina un gasto registrado usando su ID numérico
  - calcular-total-gastos: Calcula la suma total del dinero gastado entre todos los registros
```

### 4. Conversación en la que el modelo solicita la herramienta, el cliente realiza la llamada y el modelo entrega una respuesta final

```text
Dile algo al asistente: Consulta el gasto con ID 2

(MCP) El modelo llama a la herramienta: consultar-gasto
(MCP) Argumentos: {"id":2}
(MCP) Resultado MCP: Gasto encontrado -> ID: 2 | Descripción: Recarga de transporte público | Monto: $200.00

(LLM) Enviando el resultado de la herramienta al modelo para la respuesta final...

Asistente: El gasto con ID 2 corresponde a una recarga de transporte público por $200.00.
```

### 5. Caso de validación o error controlado de la herramienta

```text
Dile algo al asistente: Elimina el gasto con ID 99

(MCP) El modelo llama a la herramienta: eliminar-gasto
(MCP) Argumentos: {"id":99}
(MCP) Resultado MCP: No se encontró ningún gasto con el ID 99 para eliminar.

(LLM) Enviando el resultado de la herramienta al modelo para la respuesta final...

Asistente: No pude eliminar ese gasto porque no existe ningún registro con el ID 99 en tu lista. Si deseas, puedo mostrarte tus gastos actuales para verificar los IDs disponibles.
```