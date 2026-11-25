# Asistente de Control de Gastos Personales con MCP y LLM Local

Aplicación de consola desarrollada en **TypeScript / Node.js** que implementa el **Model Context Protocol (MCP)** sobre transporte HTTP (`StreamableHTTPServerTransport`) y la conecta con un modelo de lenguaje local ejecutado mediante **Ollama**.

El asistente permite gestionar gastos personales almacenados en `data/gastos.json` y presupuestos mensuales generales guardados en `data/presupuestos.json`. Los gastos incluyen fecha y categoría; cada presupuesto considera todos los gastos del mes, sin separarlos por categoría. El LLM local decide de forma autónoma **cuándo** invocar cada herramienta y **con qué parámetros**; el cliente no contiene reglas `if/else` que reconozcan preguntas específicas.

---

## Arquitectura del flujo

```text
Usuario (consola) ──▶ Cliente/Host MCP ──▶ LLM local (Ollama)
                            │                     │
                            │◀── tool_calls ──────┘
                            ▼
                   Servidor MCP (HTTP /mcp)
                      │             │
            lee/escribe       lee/escribe
                      ▼             ▼
             data/gastos.json  data/presupuestos.json
                      │             │
                      └──────┬──────┘
                             ▼
              Cliente agrega mensaje `tool` al historial
                             │
                             ▼
        Siguiente llamada al LLM ──▶ Respuesta final o más tools
```

Si el modelo solicita más herramientas, el ciclo se repite hasta que devuelve un mensaje sin `tool_calls`.

---

## Estructura del proyecto

```text
expense_tracker/
├── data/
│   ├── gastos.json        # Datos iniciales de prueba
│   └── presupuestos.json  # Datos iniciales de prueba
├── src/
│   ├── server.ts          # Servidor MCP (HTTP)
│   └── client.ts          # Cliente/host: chat + LLM local + llamadas MCP
├── .env.example           # Plantilla de configuración (sin secretos)
├── gastos.example.json    # Ejemplo de estructura de datos de gastos
├── presupuestos.example.json # Ejemplo de estructura de presupuestos
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
    "monto": 150,
    "fecha": "2026-11-24",
    "categoria": "Alimentación"
  },
  {
    "id": 2,
    "descripcion": "Recarga de transporte público",
    "monto": 200,
    "fecha": "2026-11-24",
    "categoria": "Transporte"
  },
  {
    "id": 3,
    "descripcion": "internet",
    "monto": 200,
    "fecha": "2026-11-23",
    "categoria": "Servicios"
  }
]
```

Si el archivo no existe, el servidor lo crea automáticamente vacío (`[]`).

El archivo `data/presupuestos.json` contiene los límites mensuales generales configurados. Para la demostración, incluye un presupuesto de $3000 para noviembre de 2026:

```json
[
  {
    "mes": "2026-11",
    "limite": 3000
  }
]
```

Los presupuestos aplican al total de gastos del mes, sin distinguir categorías. Si el archivo no existe, el servidor lo crea automáticamente vacío (`[]`).

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

Por cada herramienta que el modelo solicite, el cliente imprime el nombre, los argumentos y el resultado de la llamada MCP. Tras cada ronda, reenvía el historial actualizado y las definiciones de herramientas al LLM; el ciclo continúa hasta obtener una respuesta sin `tool_calls`. Para evitar ciclos interminables, se permiten hasta 10 rondas por consulta. Si Ollama devuelve una respuesta vacía, el cliente informa el error.

---

## Herramientas MCP expuestas

| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `registrar-gasto` | `descripcion` (string, no vacío), `monto` (number > 0), `fecha` (YYYY-MM-DD), `categoria` (string) | Registra un nuevo gasto asignando un ID incremental automático. |
| `consultar-gastos` | *(ninguno)* | Devuelve la lista completa de gastos registrados en `data/gastos.json`. |
| `consultar-gasto` | `id` (entero > 0) | Busca y devuelve el detalle de un gasto específico por su ID. |
| `actualizar-gasto` | `id` (entero > 0), `descripcion?` (string), `monto?` (number > 0), `fecha?` (YYYY-MM-DD), `categoria?` (string) | Actualiza uno o varios campos de un gasto existente. |
| `eliminar-gasto` | `id` (entero > 0) | Elimina un gasto del archivo JSON a partir de su ID. |
| `calcular-total-gastos` | *(ninguno)* | Suma los montos de todos los registros y devuelve el total gastado. |
| `filtrar-gastos` | `mes?`, `fechaDesde?`, `fechaHasta?`, `categoria?`, `descripcion?`, `montoMin?`, `montoMax?` | Filtra gastos por período, categoría, texto y rango de monto. |
| `configurar-presupuesto` | `mes` (YYYY-MM), `limite` (number > 0) | Configura un límite mensual general para todos los gastos en `data/presupuestos.json`. |
| `consultar-presupuesto` | `mes?` (YYYY-MM) | Informa gasto total, límite, saldo disponible y porcentaje consumido del mes. |

Los presupuestos son generales por mes e incluyen todos los gastos, independientemente de su categoría.

Además, el servidor expone el recurso `gastos://about` con una descripción breve del servicio.

### Validaciones

* Los parámetros se validan con **zod** (tipos, enteros, valores positivos, cadenas no vacías y formatos `YYYY-MM-DD`/`YYYY-MM`).
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
Archivo de gastos: .../expense_tracker/data/gastos.json
Archivo de presupuestos: .../expense_tracker/data/presupuestos.json
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
  - actualizar-gasto: Actualiza la descripción, el monto, la fecha y/o la categoría de un gasto existente usando su ID
  - eliminar-gasto: Elimina un gasto registrado usando su ID numérico
  - calcular-total-gastos: Calcula la suma total del dinero gastado entre todos los registros
  - filtrar-gastos: Filtra los gastos por mes, rango de fechas, categoría, descripción o rango de monto
  - configurar-presupuesto: Configura un límite mensual general para todos los gastos del mes
  - consultar-presupuesto: Consulta el gasto total, límite y saldo disponible del presupuesto mensual general
```

### 4. Conversación en la que el modelo solicita la herramienta, el cliente realiza la llamada y el modelo entrega una respuesta final

```text
Dile algo al asistente: configura un presupuesto de 1500 para diciembre. agrega un gasto de regalos de 1000.00 para el 01 de diciembre del 2026. tambien agrega otro gasto de luz en la categoria de "hogar" de 1200.00 para la misma fecha. dime si me paso del presupuesto.

(MCP) El modelo llama a la herramienta: configurar-presupuesto
(MCP) Argumentos: {"limite":1500,"mes":"2026-12"}
(MCP) Resultado MCP: Presupuesto mensual configurado para 2026-12: $1500.00 para todos los gastos.

(MCP) El modelo llama a la herramienta: registrar-gasto
(MCP) Argumentos: {"categoria":"Navidad","descripcion":"Regalos","fecha":"2026-12-01","monto":1000}
(MCP) Resultado MCP: Gasto registrado con éxito: [ID: 10] Regalos - $1000.00 - Navidad - 2026-12-01

(MCP) El modelo llama a la herramienta: registrar-gasto
(MCP) Argumentos: {"categoria":"Hogar","descripcion":"Luz","fecha":"2026-12-01","monto":1200}
(MCP) Resultado MCP: Gasto registrado con éxito: [ID: 11] Luz - $1200.00 - Hogar - 2026-12-01

(MCP) El modelo llama a la herramienta: consultar-presupuesto
(MCP) Argumentos: {"mes":"2026-12"}
(MCP) Resultado MCP: Presupuesto excedido. Mes: 2026-12. Gastado total: $2200.00. Límite mensual: $1500.00. Disponible: $-700.00. Uso: 146.7%.

(LLM) Enviando el resultado de la(s) herramienta(s) al modelo para la respuesta final...

Asistente: He configurado el presupuesto de $1500.00 para diciembre de 2026 y he registrado ambos gastos:

1. **Regalos (Navidad):** $1000.00 para el 2026-12-01.
2. **Luz (Hogar):** $1200.00 para el 2026-12-01.

Respecto a tu presupuesto: **Sí, has excedido el límite.**

Los gastos registrados para diciembre de 2026 suman un total de **$2200.00**, superando el presupuesto mensual de $1500.00. Te encuentras por encima del límite en $700.00.
```

### 5. Caso de validación o error controlado de la herramienta

```text
Dile algo al asistente: dame todos los gastos de enero y busca el gasto con el id 99

(MCP) El modelo llama a la herramienta: consultar-gasto
(MCP) Argumentos: {"id":99}
(MCP) Resultado MCP: No se encontró ningún gasto con el ID 99.

(LLM) Enviando el resultado de la(s) herramienta(s) al modelo para la respuesta final...

Asistente: El gasto con ID 99 **no fue encontrado** en el sistema.

Por favor, dime el año para que pueda buscarte todos los gastos de enero.

Dile algo al asistente: 2026

(MCP) El modelo llama a la herramienta: filtrar-gastos
(MCP) Argumentos: {"fechaDesde":"2026-01-01","fechaHasta":"2026-01-31","mes":"2026-01"}
(MCP) Resultado MCP: No se encontraron gastos con los filtros proporcionados.

(LLM) Enviando el resultado de la(s) herramienta(s) al modelo para la respuesta final...

Asistente: De acuerdo. He buscado en el sistema todos los gastos registrados para enero de 2026.

Actualmente, **no se han encontrado gastos** registrados para el mes de enero de 2026.
```