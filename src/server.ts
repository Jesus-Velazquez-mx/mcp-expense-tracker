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
    fecha: string;
    categoria: string;
}

interface Presupuesto {
    mes: string;
    limite: number;
}

/* Ruta del archivo JSON */
const DATA_FILE = path.resolve(process.cwd(), 'data', 'gastos.json');
const BUDGET_FILE = path.resolve(process.cwd(), 'data', 'presupuestos.json');

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MES_REGEX = /^\d{4}-\d{2}$/;

function fechaActual(): string {
    return new Date().toISOString().slice(0, 10);
}

function validarFecha(fecha: string): boolean {
    if (!FECHA_REGEX.test(fecha)) return false;
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const parsed = new Date(anio, mes - 1, dia);
    return parsed.getFullYear() === anio
        && parsed.getMonth() === mes - 1
        && parsed.getDate() === dia;
}

function mesDeFecha(fecha: string): string {
    return fecha.slice(0, 7);
}

/* Leer todo el archivo gastos.json y convertirlo en Gasto[] */
function leerGastos(): Gasto[] {
    if (!fs.existsSync(DATA_FILE)) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
        return [];
    } // crea un archivo vacio si no existe
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Gasto[];
}

/* Guardar */
function guardarGastos(gastos: Gasto[]): void {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(gastos, null, 2), 'utf-8');
}

/* Leer todo el archivo presupuestos.json y convertirlo en Presupuesto[] */
function leerPresupuestos(): Presupuesto[] {
    if (!fs.existsSync(BUDGET_FILE)) {
        fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
        fs.writeFileSync(BUDGET_FILE, '[]', 'utf-8');
        return [];
    }
    return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf-8')) as Presupuesto[];
}

/* Guardar */
function guardarPresupuestos(presupuestos: Presupuesto[]): void {
    fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(presupuestos, null, 2), 'utf-8');
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
                monto: z.number().positive().describe('Cantidad de dinero gastado'),
                fecha: z.string().regex(FECHA_REGEX, 'Usa el formato YYYY-MM-DD').describe('Fecha del gasto en formato YYYY-MM-DD'),
                categoria: z.string().trim().min(1).describe('Categoría del gasto')
            }
        },
        async ({ descripcion, monto, fecha, categoria }) => {
            if (!validarFecha(fecha)) {
                return {
                    content: [{ type: 'text', text: `La fecha "${fecha}" no es válida. Usa una fecha real en formato YYYY-MM-DD.` }],
                    isError: true
                };
            }

            const gastos = leerGastos();
            const siguienteId = gastos.length > 0 ? Math.max(...gastos.map((g) => g.id)) + 1 : 1;

            const nuevoGasto: Gasto = {
                id: siguienteId,
                descripcion,
                monto,
                fecha,
                categoria
            };

            gastos.push(nuevoGasto);
            guardarGastos(gastos);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto registrado con éxito: [ID: ${nuevoGasto.id}] ${nuevoGasto.descripcion} - $${nuevoGasto.monto.toFixed(2)} - ${nuevoGasto.categoria} - ${nuevoGasto.fecha}`
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
                .map((g) => `- ID ${g.id}: ${g.descripcion} — $${g.monto.toFixed(2)} — ${g.categoria} — ${g.fecha}`)
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
                        text: `Gasto encontrado -> ID: ${gasto.id} | Descripción: ${gasto.descripcion} | Monto: $${gasto.monto.toFixed(2)} | Categoría: ${gasto.categoria} | Fecha: ${gasto.fecha}`
                    }
                ]
            };
        }
    );

    /* Actualizar un gasto existente */
    server.registerTool(
        'actualizar-gasto',
        {
            description: 'Actualiza la descripción, el monto, la fecha y/o la categoría de un gasto existente usando su ID',
            inputSchema: {
                id: z.number().int().positive().describe('ID numérico del gasto a modificar'),
                descripcion: z.string().min(1).optional().describe('Nueva descripción del gasto (opcional)'),
                monto: z.number().positive().optional().describe('Nuevo monto (opcional)'),
                fecha: z.string().regex(FECHA_REGEX, 'Usa el formato YYYY-MM-DD').optional().describe('Nueva fecha del gasto en formato YYYY-MM-DD'),
                categoria: z.string().trim().min(1).optional().describe('Nueva categoría del gasto')
            }
        },
        async ({ id, descripcion, monto, fecha, categoria }) => {
            if (descripcion === undefined && monto === undefined && fecha === undefined && categoria === undefined) {
                return {
                    content: [{ type: 'text', text: 'Debes proporcionar al menos una descripción, monto, fecha o categoría nueva.' }],
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

            if (fecha !== undefined && !validarFecha(fecha)) {
                return {
                    content: [{ type: 'text', text: `La fecha "${fecha}" no es válida. Usa una fecha real en formato YYYY-MM-DD.` }],
                    isError: true
                };
            }

            if (descripcion !== undefined) gastos[indice].descripcion = descripcion;
            if (monto !== undefined) gastos[indice].monto = monto;
            if (fecha !== undefined) gastos[indice].fecha = fecha;
            if (categoria !== undefined) gastos[indice].categoria = categoria;

            guardarGastos(gastos);

            return {
                content: [
                    {
                        type: 'text',
                        text: `Gasto actualizado: [ID: ${gastos[indice].id}] ${gastos[indice].descripcion} - $${gastos[indice].monto.toFixed(2)} - ${gastos[indice].categoria} - ${gastos[indice].fecha}`
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

    /* Filtrar gastos por fecha, categoría, descripción y monto */
    server.registerTool(
        'filtrar-gastos',
        {
            description: 'Filtra los gastos por mes, rango de fechas, categoría, descripción o rango de monto',
            inputSchema: {
                mes: z.string().regex(MES_REGEX, 'Usa el formato YYYY-MM').optional().describe('Mes a consultar en formato YYYY-MM'),
                fechaDesde: z.string().regex(FECHA_REGEX, 'Usa el formato YYYY-MM-DD').optional().describe('Fecha inicial inclusiva'),
                fechaHasta: z.string().regex(FECHA_REGEX, 'Usa el formato YYYY-MM-DD').optional().describe('Fecha final inclusiva'),
                categoria: z.string().min(1).optional().describe('Categoría exacta a buscar'),
                descripcion: z.string().min(1).optional().describe('Texto a buscar dentro de la descripción'),
                montoMin: z.number().nonnegative().optional().describe('Monto mínimo inclusivo'),
                montoMax: z.number().nonnegative().optional().describe('Monto máximo inclusivo')
            }
        },
        async ({ mes, fechaDesde, fechaHasta, categoria, descripcion, montoMin, montoMax }) => {
            if (mes !== undefined) {
                const [anio, numeroMes] = mes.split('-').map(Number);
                if (numeroMes < 1 || numeroMes > 12) {
                    return { content: [{ type: 'text', text: `El mes "${mes}" no es válido.` }], isError: true };
                }
                if (anio < 1) {
                    return { content: [{ type: 'text', text: `El mes "${mes}" no es válido.` }], isError: true };
                }
            }

            for (const [nombre, fecha] of [['fechaDesde', fechaDesde], ['fechaHasta', fechaHasta]] as const) {
                if (fecha !== undefined && !validarFecha(fecha)) {
                    return {
                        content: [{ type: 'text', text: `El campo ${nombre} contiene una fecha no válida: "${fecha}".` }],
                        isError: true
                    };
                }
            }

            if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
                return {
                    content: [{ type: 'text', text: 'La fecha inicial no puede ser posterior a la fecha final.' }],
                    isError: true
                };
            }

            if (montoMin !== undefined && montoMax !== undefined && montoMin > montoMax) {
                return {
                    content: [{ type: 'text', text: 'El monto mínimo no puede ser mayor que el monto máximo.' }],
                    isError: true
                };
            }

            let gastos = leerGastos();
            if (mes) gastos = gastos.filter((gasto) => mesDeFecha(gasto.fecha) === mes);
            if (fechaDesde) gastos = gastos.filter((gasto) => gasto.fecha >= fechaDesde);
            if (fechaHasta) gastos = gastos.filter((gasto) => gasto.fecha <= fechaHasta);
            if (categoria) {
                const categoriaBuscada = categoria.trim().toLocaleLowerCase();
                gastos = gastos.filter((gasto) => gasto.categoria.toLocaleLowerCase() === categoriaBuscada);
            }
            if (descripcion) {
                const texto = descripcion.trim().toLocaleLowerCase();
                gastos = gastos.filter((gasto) => gasto.descripcion.toLocaleLowerCase().includes(texto));
            }
            if (montoMin !== undefined) gastos = gastos.filter((gasto) => gasto.monto >= montoMin);
            if (montoMax !== undefined) gastos = gastos.filter((gasto) => gasto.monto <= montoMax);

            if (gastos.length === 0) {
                return { content: [{ type: 'text', text: 'No se encontraron gastos con los filtros proporcionados.' }] };
            }

            const total = gastos.reduce((acumulado, gasto) => acumulado + gasto.monto, 0);
            const listado = gastos
                .map((gasto) => `- ID ${gasto.id}: ${gasto.descripcion} — $${gasto.monto.toFixed(2)} — ${gasto.categoria} — ${gasto.fecha}`)
                .join('\n');

            return {
                content: [{
                    type: 'text',
                    text: `Gastos encontrados (${gastos.length}) — Total: $${total.toFixed(2)}\n${listado}`
                }]
            };
        }
    );

    /* Configurar presupuesto mensual */
    server.registerTool(
        'configurar-presupuesto',
        {
            description: 'Configura un límite mensual general para todos los gastos del mes',
            inputSchema: {
                mes: z.string().regex(MES_REGEX, 'Usa el formato YYYY-MM').describe('Mes del presupuesto en formato YYYY-MM'),
                limite: z.number().positive().describe('Monto máximo permitido para el mes')
            }
        },
        async ({ mes, limite }) => {
            const [anio, numeroMes] = mes.split('-').map(Number);
            if (anio < 1 || numeroMes < 1 || numeroMes > 12) {
                return { content: [{ type: 'text', text: `El mes "${mes}" no es válido.` }], isError: true };
            }

            const presupuestos = leerPresupuestos();
            const indice = presupuestos.findIndex((presupuesto) => presupuesto.mes === mes);
            const presupuesto: Presupuesto = { mes, limite };

            if (indice === -1) presupuestos.push(presupuesto);
            else presupuestos[indice] = presupuesto;

            guardarPresupuestos(presupuestos);

            return {
                content: [{
                    type: 'text',
                    text: `Presupuesto mensual configurado para ${mes}: $${limite.toFixed(2)} para todos los gastos.`
                }]
            };
        }
    );

    /* Consultar presupuesto mensual */
    server.registerTool(
        'consultar-presupuesto',
        {
            description: 'Consulta el gasto total, límite y saldo disponible del presupuesto mensual general',
            inputSchema: {
                mes: z.string().regex(MES_REGEX, 'Usa el formato YYYY-MM').optional().describe('Mes a consultar; por defecto usa el mes actual')
            }
        },
        async ({ mes }) => {
            const mesConsulta = mes ?? fechaActual().slice(0, 7);
            const [anio, numeroMes] = mesConsulta.split('-').map(Number);
            if (anio < 1 || numeroMes < 1 || numeroMes > 12) {
                return { content: [{ type: 'text', text: `El mes "${mesConsulta}" no es válido.` }], isError: true };
            }

            const presupuestos = leerPresupuestos();
            const presupuesto = presupuestos.find((item) => item.mes === mesConsulta);

            if (!presupuesto) {
                return {
                    content: [{
                        type: 'text',
                        text: `No hay un presupuesto mensual configurado para ${mesConsulta}.`
                    }],
                    isError: true
                };
            }

            const gastado = leerGastos()
                .filter((gasto) => mesDeFecha(gasto.fecha) === mesConsulta)
                .reduce((total, gasto) => total + gasto.monto, 0);
            const disponible = presupuesto.limite - gastado;
            const porcentaje = presupuesto.limite > 0 ? (gastado / presupuesto.limite) * 100 : 0;
            const estado = disponible >= 0 ? 'Dentro del presupuesto' : 'Presupuesto excedido';

            return {
                content: [{
                    type: 'text',
                    text: `${estado}. Mes: ${mesConsulta}. Gastado total: $${gastado.toFixed(2)}. Límite mensual: $${presupuesto.limite.toFixed(2)}. Disponible: $${disponible.toFixed(2)}. Uso: ${porcentaje.toFixed(1)}%.`
                }]
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
    console.log(`Archivo de gastos: ${DATA_FILE}`);
    console.log(`Archivo de presupuestos: ${BUDGET_FILE}`);
});