# Asistente de Control de Gastos Personales con MCP y LLM Local

Aplicación de consola desarrollada en **TypeScript / Node.js** que implementa el **Model Context Protocol (MCP)** sobre transporte HTTP (`StreamableHTTPServerTransport`) conectado a un modelo de lenguaje local ejecutado mediante **Ollama**.

El asistente permite gestionar gastos personales almacenados localmente en `data/gastos.json` (registrar, consultar todos, consultar por ID, actualizar, eliminar y calcular el total gastado), permitiendo que el LLM local decida de forma autónoma cuándo invocar cada herramienta y con qué parámetros.

---

## Arquitectura del Flujo

```text
Usuario (Consola) ──▶ Cliente/Host MCP ──▶ LLM Local (Ollama)
                            │                     │
                            │◀── tool_calls ──────┘
                            ▼
                    Servidor MCP (HTTP)
                            │
                            ▼
                    data/gastos.json
                            │
                            ▼
                    LLM Local (Ollama) ──▶ Respuesta final al usuario
```

---

## Requisitos Previos

* **Node.js** v20.6 o superior (requerido para soporte nativo de `--env-file`).
* **Ollama** instalado y en ejecución local (`http://localhost:11434`).

---

## Instalación y Configuración

### 1. Clonar o descargar el proyecto e instalar dependencias

Desde la carpeta raíz del proyecto (`retailserver`), instala los paquetes necesarios:

```bash
npm install
```

### 2. Descargar y preparar el modelo local en Ollama

Descarga el modelo configurado para el proyecto:

```bash
ollama pull gemma4:e4b
```

*(Nota: Si se utiliza un equipo con poca VRAM dedicada, también es compatible con modelos más ligeros como `qwen2.5:3b`).*

### 3. Configurar las variables de entorno

Copia el archivo de ejemplo `.env.example` para crear tu archivo `.env` local:

```bash
cp .env.example .env
```

Asegúrate de que `.env` contenga la siguiente estructura:

```env
HOST=localhost
PORT=5000
MCP_SERVER_URL=http://localhost:5000/mcp
LLM_BASE_URL=http://localhost:11434
LLM_CHAT_PATH=/api/chat
LLM_MODEL=gemma4:e4b
```

### 4. Verificar datos iniciales

El archivo `data/gastos.json` contiene los registros iniciales de prueba para reproducir la demostración:

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

---

## Ejecución del Sistema

El sistema requiere ejecutar el servidor MCP y el cliente/host en **dos terminales independientes** ubicadas en la carpeta `retailserver`.

### Terminal 1: Iniciar el Servidor MCP

```bash
npx tsx --env-file=.env src/index.ts
```

### Terminal 2: Iniciar el Cliente / Chat con el Asistente

```bash
npx tsx --env-file=.env src/client.ts
```

Comandos disponibles dentro del chat:
* Escribe cualquier consulta en lenguaje natural sobre tus gastos.
* Escribe `nuevo` para limpiar el historial de la conversación y comenzar desde cero.
* Escribe `salir` para cerrar la sesión y desconectar el cliente MCP.

---

## Herramientas MCP Expuestas

| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `registrar-gasto` | `descripcion` (string), `monto` (number > 0) | Registra un nuevo gasto asignando un ID incremental automático. |
| `consultar-gastos` | *(Ninguno)* | Devuelve la lista completa de gastos registrados en `data/gastos.json`. |
| `consultar-gasto` | `id` (number entero > 0) | Busca y devuelve el detalle de un gasto específico por su ID. |
| `actualizar-gasto` | `id` (number), `descripcion?` (string), `monto?` (number) | Actualiza la descripción y/o el monto de un gasto existente. |
| `eliminar-gasto` | `id` (number entero > 0) | Elimina un gasto del archivo JSON a partir de su ID. |
| `calcular-total-gastos` | *(Ninguno)* | Suma los montos de todos los registros y devuelve el total gastado. |

---

## Evidencias de Funcionamiento

### 1. Servidor MCP iniciado y accesible por HTTP

```text
Gastos MCP Server corriendo en http://localhost:5000
Endpoint para conectarse: http://localhost:5000/mcp
Archivo de datos: .../retailserver/data/gastos.json
```

### 2. Configuración efectiva del cliente y descubrimiento de herramientas MCP

```text
Configuración actual: 
  Modelo local : gemma4:e4b
  API del LLM  : http://localhost:11434/api/chat
  Servidor MCP : http://localhost:5000/mcp
Realizando conexión al servidor MCP...
Herramientas disponibles:
  - registrar-gasto: Registra un nuevo gasto personal
  - consultar-gastos: Obtiene la lista completa de todos los gastos personales registrados
  - consultar-gasto: Consulta el detalle de un gasto específico buscando por su ID numérico
  - actualizar-gasto: Actualiza la descripción y/o el monto de un gasto existente usando su ID
  - eliminar-gasto: Elimina un gasto registrado usando su ID numérico
  - calcular-total-gastos: Calcula la suma total del dinero gastado entre todos los registros
```

### 3. Conversación completa con invocación de herramienta MCP y respuesta final

```text
Dile algo al asistente: ocupo que calcules el total de mis gastos

(MCP) El modelo llama a la herramienta: calcular-total-gastos
(MCP) Argumentos: {}
(MCP) Resultado MCP: Total gastado (3 registros): $550.00

Asistente: El total de tus gastos registrados actualmente es de **$550.00** (basado en 3 registros).
```

### 4. Caso de validación / error controlado de la herramienta

```text
Dile algo al asistente: Elimina el gasto con ID 99

(MCP) El modelo llama a la herramienta: eliminar-gasto
(MCP) Argumentos: {"id":99}
(MCP) Resultado MCP: No se encontró ningún gasto con el ID 99 para eliminar.

Asistente: No pude eliminar ese gasto porque no existe ningún registro con el ID 99 en tu lista. Si deseas, puedo mostrarte tus gastos actuales para verificar los IDs disponibles.
```