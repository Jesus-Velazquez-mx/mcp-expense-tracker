import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHTTP.js';
import { z } from 'zod';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Gasto {
    id: number;
    descripcion: string;
    monto: number;
}

/* Ruta del archivo JSON */
const DATA_FILE = path.resolve(process.cwd(), 'data', 'gastos.json');

/* Leer todo el archivo y convertirlo en Gasto[] */
function leerGastos(): Gasto[] {
    if (!fs.existsSync(DATA_FILE)) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
        return [];
    } // crea un archivo vacio si no existe
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw) as Gasto[]; // Lo convierte en gasto[]
}

/* Guardar */
function guardarGastos(gastos: Gasto[]): void {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(gastos, null, 2), 'utf-8');
}

/* Crear el servidor MCP (se instancia por petición para permitir reconexiones) */
function crearServidorMcp(): McpServer {
    const server = new McpServer({ name: 'expense-tracker-server', version: '1.0.0' });

    /* Definicion de las herramientas */
    /* Registrar gasto */
    server.registerTool(
        'registrar-gasto',
        {
            description: 'Registra un nuevo gasto personal',
            inputSchema: {
                descripcion: z.string().min(1).describe('Concepto o descripción del gasto'),
                monto: z.number().positive().describe('Cantidad de dinero gastado')
            }
        },
        async ({ descripcion, monto }) => {
            const gastos = leerGastos();
            const siguienteId = gastos.length > 0 ? Math.max(...gastos.map((g) => g.id)) + 1 : 1;

            const nuevoGasto: Gasto = {
                id: siguienteId,
                descripcion,
                monto
            };

            gastos.push(nuevoGasto);
            guardarGastos(gastos);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto registrado con éxito: [ID: ${nuevoGasto.id}] ${nuevoGasto.descripcion} - $${nuevoGasto.monto.toFixed(2)}`
                    }
                ]
            };
        }
    );

    /* Consultar todos los gastos */
    server.registerTool(
        'consultar-gastos',
        {
            description: 'Obtiene la lista completa de todos los gastos personales registrados',
            inputSchema: {}
        },
        async () => {
            const gastos = leerGastos();
            if (gastos.length === 0) {
                return { content: [{ type: 'text', text: 'No hay gastos registrados todavía.' }] };
            }

            const listado = gastos
                .map((g) => `- ID ${g.id}: ${g.descripcion} — $${g.monto.toFixed(2)}`)
                .join('\n');

            return { content: [{ type: 'text', text: `Lista de gastos:\n${listado}` }] };
        }
    );

    /* Consultar un solo gasto */
    server.registerTool(
        'consultar-gasto',
        {
            description: 'Consulta el detalle de un gasto específico buscando por su ID numérico',
            inputSchema: {
                id: z.number().int().positive().describe('ID numérico del gasto a consultar')
            }
        },
        async ({ id }) => {
            const gastos = leerGastos();
            const gasto = gastos.find((g) => g.id === id);

            if (!gasto) {
                return {
                    content: [{ type: 'text', text: `No se encontró ningún gasto con el ID ${id}.` }],
                    isError: true
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto encontrado -> ID: ${gasto.id} | Descripción: ${gasto.descripcion} | Monto: $${gasto.monto.toFixed(2)}`
                    }
                ]
            };
        }
    );

    /* Actualizar un gasto existente */
    server.registerTool(
        'actualizar-gasto',
        {
            description: 'Actualiza la descripción y/o el monto de un gasto existente usando su ID',
            inputSchema: {
                id: z.number().int().positive().describe('ID numérico del gasto a modificar'),
                descripcion: z.string().min(1).optional().describe('Nueva descripción del gasto (opcional)'),
                monto: z.number().positive().optional().describe('Nuevo monto (opcional)')
            }
        },
        async ({ id, descripcion, monto }) => {
            if (descripcion === undefined && monto === undefined) {
                return {
                    content: [{ type: 'text', text: 'Debes proporcionar al menos una nueva descripción o un nuevo monto.' }],
                    isError: true
                };
            }

            const gastos = leerGastos();
            const indice = gastos.findIndex((g) => g.id === id);

            if (indice === -1) {
                return {
                    content: [{ type: 'text', text: `No se encontró ningún gasto con el ID ${id} para actualizar.` }],
                    isError: true
                };
            }

            if (descripcion !== undefined) gastos[indice].descripcion = descripcion;
            if (monto !== undefined) gastos[indice].monto = monto;

            guardarGastos(gastos);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto actualizado: [ID: ${gastos[indice].id}] ${gastos[indice].descripcion} - $${gastos[indice].monto.toFixed(2)}`
                    }
                ]
            };
        }
    );

    /* Eliminar un gasto */
    server.registerTool(
        'eliminar-gasto',
        {
            description: 'Elimina un gasto registrado usando su ID numérico',
            inputSchema: {
                id: z.number().int().positive().describe('ID numérico del gasto a eliminar')
            }
        },
        async ({ id }) => {
            const gastos = leerGastos();
            const indice = gastos.findIndex((g) => g.id === id);

            if (indice === -1) {
                return {
                    content: [{ type: 'text', text: `No se encontró ningún gasto con el ID ${id} para eliminar.` }],
                    isError: true
                };
            }

            const [eliminado] = gastos.splice(indice, 1);
            guardarGastos(gastos);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto eliminado: [ID: ${eliminado.id}] ${eliminado.descripcion} ($${eliminado.monto.toFixed(2)})`
                    }
                ]
            };
        }
    );

    /* Calcular el total gastado */
    server.registerTool(
        'calcular-total-gastos',
        {
            description: 'Calcula la suma total del dinero gastado entre todos los registros',
            inputSchema: {}
        },
        async () => {
            const gastos = leerGastos();
            const total = gastos.reduce((acumulador, gasto) => acumulador + gasto.monto, 0);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Total gastado (${gastos.length} registros): $${total.toFixed(2)}`
                    }
                ]
            };
        }
    );

    server.registerResource(
        'about',
        'gastos://about',
        { title: 'Acerca del gestor de gastos', mimeType: 'text/plain' },
        async (uri) => ({
            contents: [{ uri: uri.href, text: 'Servidor MCP de control de gastos personales respaldado por JSON.' }]
        })
    );

    return server;
}

/* Levantar el servidor MCP */
const httpServer = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    /* El transport MCP maneja las peticiones HTTP */
    if (pathname === '/mcp') {
        if (req.method === 'POST') {
            try {
                /* Crear servidor y canal de comunicación HTTP sin estado (stateless) */
                /* Stateless ayuda evitar bloqueos cuando el cliente creashea o no finaliza correctamente. */
                const server = crearServidorMcp();
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined
                });

                res.on('close', () => {
                    transport.close().catch(() => { });
                    server.close().catch(() => { });
                });

                await server.connect(transport);
                await transport.handleRequest(req, res);
            } catch (error) {
                console.error('Error manejando petición MCP:', error);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32603, message: 'Internal server error' },
                        id: null
                    }));
                }
            }
            return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed.' },
            id: null
        }));
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const HOST = process.env.HOST || 'localhost';
const PORT = Number(process.env.PORT) || 5000;

/* Arrancar el servidor */
httpServer.listen(PORT, HOST, () => {
    console.log(`Gastos MCP Server corriendo en http://${HOST}:${PORT}`);
    console.log(`Endpoint para conectarse: http://${HOST}:${PORT}/mcp`);
    console.log(`Archivo de datos: ${DATA_FILE}`);
});