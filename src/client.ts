import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_name?: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaChatResponse {
    message: OllamaMessage;
    done: boolean;
}

/* Configuracion del .env */
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_CHAT_PATH = process.env.LLM_CHAT_PATH || '/api/chat';
const LLM_MODEL = process.env.LLM_MODEL;

if (!MCP_SERVER_URL || !LLM_BASE_URL || !LLM_MODEL) {
    console.error('Faltan variables en el archivo .env (MCP_SERVER_URL, LLM_BASE_URL, LLM_MODEL)');
    process.exit(1);
}

/* Enpoint al LLM */
const llmEndpoint = `${LLM_BASE_URL}${LLM_CHAT_PATH}`;
const MAX_TOOL_ROUNDS = 10;

async function startHostSession() {
    /* Mostrar la configuracion actual */
    console.log('Configuración actual: ');
    console.log(`  Proveedor    : ${LLM_PROVIDER}`);
    console.log(`  Modelo local : ${LLM_MODEL}`);
    console.log(`  API del LLM  : ${llmEndpoint}`);
    console.log(`  Servidor MCP : ${MCP_SERVER_URL}`);

    /* Crear el cliente para el sevidor MCP */
    const mcpClient = new Client(
        { name: 'expense-tracker-host', version: '1.0.0' },
        { capabilities: {} }
    );

    /* Mostrar las herramientas disponibles */
    const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL!));
    console.log('Realizando conexión al servidor MCP...');
    await mcpClient.connect(transport); // .connect realiza la conexion con el servidor MCP

    const { tools } = await mcpClient.listTools(); // .listTools obtiene la lista de herramientas disponibles

    console.log('Herramientas disponibles:');
    for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
    }
    console.log('');

    /* Definicion de un DTO de herramientas para el modelo */
    const ollamaTools = tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description ?? '',
            parameters: tool.inputSchema
        }
    }));

    /* Iniciar una sesion en el chat */
    /* createInterface({ input, output }) creea una interfaz de lectura y escritura para usar la terminal */
    const rl = readline.createInterface({ input, output });

    /* messages es un arreglo que guarda todos los mensajes de la sesión. Sirve como contexto y memoria */
    const messages: OllamaMessage[] = [
        {
            /* Prompt inicial */
            role: 'system',
            content: [
                'Eres un asistente especializado en la gestión y control de gastos personales.',
                'Tu única fuente de verdad sobre los gastos del usuario son las herramientas conectadas al servidor MCP.',
                'Reglas estrictas:',
                '1. Siempre que el usuario mencione un gasto nuevo, usa la herramienta de registro antes de confirmar.',
                '2. Siempre que pregunte por historiales, resúmenes o totales, consulta primero con las herramientas disponibles; nunca inventes ni estimes cifras.',
                '3. Si falta un dato obligatorio para registrar un gasto (como el monto o el concepto), pídelo brevemente al usuario antes de ejecutar la herramienta.',
                '4. Para registrar un gasto, también solicita o deduce una fecha válida en formato YYYY-MM-DD y una categoría; no inventes estos datos si el usuario no los proporciona.',
                '5. Los presupuestos son únicamente mensuales y generales: incluyen todos los gastos sin importar la categoría. No existe configuración de presupuesto por categoría.',
                '6. Usa las herramientas de filtro cuando el usuario consulte gastos por categoría o período, y las herramientas de presupuesto para límites mensuales.',
                '7. Responde siempre en español, de forma directa, amable y estructurada.'
            ].join(' ') // .join junta todo en un string
        }
    ];

    /* Primer mensaje en consola */
    console.log('Chat disponible. Escribe "salir" para terminar o "nuevo" para volver a empezar.\n');

    while (true) {
        /* .question muestra un mensaje, pausa la ejecucion hasta que se escriba algo y se de enter, 
            y lo guarda en un string */
        let userInput: string;
        try {
            userInput = await rl.question('Dile algo al asistente: ');
        } catch (err) {
            if (err instanceof Error && 'code' in err && err.code === 'ERR_USE_AFTER_CLOSE') break;
            throw err;
        }
        const trimmed = userInput.trim();

        if (!trimmed) continue; // si no se escribe nada no hace nada
        if (trimmed.toLowerCase() === 'salir') break; // salir
        if (trimmed.toLowerCase() === 'nuevo') {
            messages.splice(1); // regresa al primer mensaje (donde se le dan las instrucciones)
            console.log('\nNueva conversación iniciada\n');
            continue;
        } // reiniciar

        /* Meter el mensaje en el arreglo para que el LLM lo vea */
        messages.push({ role: 'user', content: trimmed });

        /* Rondas de llamadas al LLM */
        /* Enviar el historial al LLM para decidir si responde o solicita herramientas MCP. */
        const firstResponse = await fetch(llmEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages,
                stream: false,
                tools: ollamaTools
            })
        });

        let finalResponse: Response = firstResponse;
        let responseToProcess: Response = firstResponse;
        let rondasHerramientas = 0;
        let respuestaFinal: string | undefined;
        let errorFinal: string | undefined;

        while (respuestaFinal === undefined && errorFinal === undefined) {
            /* Para cualquier error */
            if (!responseToProcess.ok) {
                const errText = await responseToProcess.text();
                throw new Error(`Error HTTP de Ollama (${responseToProcess.status}): ${errText}`);
            }

            /* Respuesta del LLM */
            const chatResponse = (await responseToProcess.json()) as OllamaChatResponse; // convertir a JSON
            const assistantMessage = chatResponse.message; // sacar el mensaje
            const toolCalls = assistantMessage.tool_calls ?? []; // ver si hay tool_calls

            /* Si no hay tool_calls, simplemente manda el mensaje de respuesta */
            if (toolCalls.length === 0) {
                respuestaFinal = assistantMessage.content?.trim();
                if (respuestaFinal) {
                    /* Se guarda en el arreglo de memoria */
                    messages.push({ ...assistantMessage, content: respuestaFinal });
                } else {
                    errorFinal = 'Ollama devolvió una respuesta vacía.';
                    messages.push({ role: 'assistant', content: errorFinal });
                }
                break;
            }

            if (rondasHerramientas >= MAX_TOOL_ROUNDS) {
                errorFinal = `Se alcanzó el límite de ${MAX_TOOL_ROUNDS} rondas de herramientas; la solicitud quedó incompleta.`;
                messages.push({ role: 'assistant', content: errorFinal });
                break;
            }

            rondasHerramientas++;

            /* Se guarda en el arreglo de memoria */
            messages.push(assistantMessage);

            /* Si hay tool_calls, entonces las llama una por una */
            for (const call of toolCalls) {
                const toolName = call.function.name;
                const toolArgs = call.function.arguments;

                console.log(`\n(MCP) El modelo llama a la herramienta: ${toolName}`);
                console.log(`(MCP) Argumentos: ${JSON.stringify(toolArgs)}`);

                /* Llamar a la herramienta con el nombre y los argumentos */
                let textoResultado = 'Sin resultado.'; // si no hay resultado, no se modifica el string
                try {
                    const mcpResult = await mcpClient.callTool({ name: toolName, arguments: toolArgs }); // llamada al MCP
                    if (Array.isArray(mcpResult.content)) { // ver si es un array
                        const textBlocks = mcpResult.content
                            .filter((b): b is { type: 'text'; text: string } =>
                                typeof b === 'object' && b !== null && 'type' in b && b.type === 'text' &&
                                'text' in b && typeof b.text === 'string')
                            .map((b) => b.text);// solo regresa un arreglo de string

                        if (textBlocks.length > 0) textoResultado = textBlocks.join('\n'); // si son varios bloques, les da un enter
                    }
                } catch (err) {
                    textoResultado = `Error al ejecutar la herramienta: ${err instanceof Error ? err.message : String(err)}`;
                }

                console.log(`(MCP) Resultado MCP: ${textoResultado}\n`);

                /* Guardar el resultado en el contexto/memoria */
                messages.push({
                    role: 'tool',
                    content: textoResultado,
                    tool_name: toolName
                });
            }

            /* La siguiente iteración vuelve a llamar al LLM con esos resultados (segunda llamada y rondas posteriores). */
            console.log('(LLM) Enviando el resultado de la(s) herramienta(s) al modelo para la respuesta final...\n');
            finalResponse = await fetch(llmEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: LLM_MODEL,
                    messages,
                    stream: false,
                    tools: ollamaTools
                })
            });
            responseToProcess = finalResponse;
        }

        if (respuestaFinal !== undefined) {
            console.log(`\nAsistente: ${respuestaFinal}\n`);
        } else {
            console.error(`\n(LLM) Error: ${errorFinal}`);
        }
    }

    /* Finalizar la sesión */
    rl.close();
    await transport.close();
    console.log('Sesión finalizada.');
}

startHostSession().catch((err) => {
    console.error('Error en el cliente:', err);
    process.exit(1);
});