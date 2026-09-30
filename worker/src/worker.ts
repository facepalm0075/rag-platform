import WebSocket from 'ws';

import { config } from './config.js';
import {
    getEmbedding,
    getChatCompletion,
    getChatCompletionStream,
    initLMStudio,
} from './lmstudio.js';


// ============================================================
// Configuration
// ============================================================

const RECONNECT_DELAY = 5_000;

const HEARTBEAT_INTERVAL = 30_000;

// If we haven't received a pong within this amount of time,
// consider the connection dead.
const HEARTBEAT_TIMEOUT = 10_000;


// ============================================================
// State
// ============================================================

const activeStreams = new Map<string, AbortController>();

let ws: WebSocket | null = null;

let reconnectTimer: NodeJS.Timeout | null = null;

let heartbeatTimer: NodeJS.Timeout | null = null;

let heartbeatTimeoutTimer: NodeJS.Timeout | null = null;

let shouldReconnect = true;

const getTime = ()=>{
    return (new Date).toLocaleString() + ' ';
}

// ============================================================
// Connection
// ============================================================

function connect() {
    if (!shouldReconnect) {
        return;
    }

    // Don't create duplicate connections.
    if (
        ws &&
        (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    console.log(getTime () + 'Connecting to server...');

    const socket = new WebSocket(config.SERVER_URL, {
        headers: {
            'x-worker-auth': config.WORKER_AUTH_SECRET,
        },

        // Optional but useful for detecting TCP-level connection
        // problems more aggressively.
        handshakeTimeout: 15_000,
    });

    /*
     * Assign this socket immediately.
     *
     * We use the local `socket` variable inside every handler
     * so old connections cannot accidentally destroy new ones.
     */
    ws = socket;


    // ========================================================
    // OPEN
    // ========================================================

    socket.on('open', () => {
        console.log(getTime() + 'Connected to server');

        startHeartbeat(socket);
    });


    // ========================================================
    // MESSAGE
    // ========================================================

    socket.on('message', async (data) => {
        let message: any;

        try {
            message = JSON.parse(data.toString());
        } catch (err) {
            console.error(
                'Received invalid JSON from server:',
                err
            );

            return;
        }

        try {
            await handleMessage(message);
        } catch (err) {
            console.error(
                'Error processing worker message:',
                err
            );

            sendResponse({
                id: message?.id,
                success: false,
                error:
                    err instanceof Error
                        ? err.message
                        : 'Unknown error',
            });
        }
    });


    // ========================================================
    // PONG
    // ========================================================

    socket.on('pong', () => {
        /*
         * Server responded to our ping.
         *
         * This proves that the WebSocket connection is alive.
         */
        clearHeartbeatTimeout();
    });


    // ========================================================
    // CLOSE
    // ========================================================

    socket.on('close', (code, reason) => {
        console.log(
            getTime() + `Disconnected from server. code=${code} reason=${reason.toString()}`
        );

        /*
         * Stop heartbeat timers for this socket.
         */
        stopHeartbeat();

        /*
         * IMPORTANT:
         *
         * Only modify global `ws` if this is still the current
         * socket.
         *
         * This prevents an old socket's close event from
         * destroying a newly-created connection.
         */
        if (ws === socket) {
            ws = null;

            /*
             * Any tasks running on this connection can no longer
             * send their result to the server.
             */
            abortActiveStreams();

            scheduleReconnect();
        }
    });


    // ========================================================
    // ERROR
    // ========================================================

    socket.on('error', (err) => {
        console.error(
            getTime() + 'WebSocket error:',
            err.message
        );

        /*
         * Do not reconnect here.
         *
         * ws normally emits `close` after `error`.
         * Reconnecting from both handlers can create duplicate
         * connections.
         */
    });
}


// ============================================================
// Heartbeat
// ============================================================

function startHeartbeat(socket: WebSocket) {
    stopHeartbeat();

    heartbeatTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }

        clearHeartbeatTimeout();

        /*
         * Send WebSocket protocol-level ping.
         */
        socket.ping();

        /*
         * If pong isn't received within HEARTBEAT_TIMEOUT,
         * the connection is considered dead.
         */
        heartbeatTimeoutTimer = setTimeout(() => {
            console.warn(
                getTime() + 'WebSocket heartbeat timeout. Terminating connection.'
            );

            /*
             * terminate() is intentional here.
             *
             * close() waits for a clean WebSocket close handshake.
             * If the connection is dead, that handshake may never
             * happen.
             */
            socket.terminate();

        }, HEARTBEAT_TIMEOUT);

    }, HEARTBEAT_INTERVAL);
}


function clearHeartbeatTimeout() {
    if (heartbeatTimeoutTimer) {
        clearTimeout(heartbeatTimeoutTimer);

        heartbeatTimeoutTimer = null;
    }
}


function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);

        heartbeatTimer = null;
    }

    clearHeartbeatTimeout();
}


// ============================================================
// Reconnection
// ============================================================

function scheduleReconnect() {
    if (!shouldReconnect) {
        return;
    }

    /*
     * Don't schedule multiple reconnect timers.
     */
    if (reconnectTimer) {
        return;
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        connect();

    }, RECONNECT_DELAY);

    console.log(
        getTime() + `Reconnecting in ${RECONNECT_DELAY / 1000}s...`
    );
}


// ============================================================
// Active task cleanup
// ============================================================

function abortActiveStreams() {
    if (activeStreams.size === 0) {
        return;
    }

    console.log(
        getTime() + `Aborting ${activeStreams.size} active stream(s)`
    );

    for (const controller of activeStreams.values()) {
        controller.abort();
    }

    activeStreams.clear();
}


// ============================================================
// Sending responses
// ============================================================

function sendResponse(response: unknown): boolean {
    const socket = ws;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn(
            'Cannot send response: WebSocket is not open'
        );

        return false;
    }

    try {
        socket.send(JSON.stringify(response));

        return true;

    } catch (err) {
        console.error(
            'Failed to send WebSocket response:',
            err
        );

        return false;
    }
}


// ============================================================
// Message dispatcher
// ============================================================

async function handleMessage(message: any) {
    const {
        id,
        type,
        payload,
    } = message;

    switch (type) {

        case 'embed':
            await handleEmbed(id, payload);
            break;


        case 'chat':
            await handleChat(id, payload);
            break;


        case 'abort': {
            const taskId = payload?.taskId;

            if (!taskId) {
                console.warn(
                    'Received abort without taskId'
                );

                return;
            }

            const controller =
                activeStreams.get(taskId);

            if (controller) {
                controller.abort();

                activeStreams.delete(taskId);

                console.log(
                    `Aborted stream task ${taskId}`
                );
            }

            break;
        }


        default:
            sendResponse({
                id,
                success: false,
                error: `Unknown message type: ${type}`,
            });
    }
}


// ============================================================
// Embedding
// ============================================================

async function handleEmbed(
    id: string,
    payload: any
) {
    try {
        const input = payload?.input;

        if (!input) {
            throw new Error(
                'Missing "input" in payload'
            );
        }

        const embeddings =
            await getEmbedding(input);

        sendResponse({
            id,
            success: true,
            data: embeddings,
        });

    } catch (err) {
        sendResponse({
            id,
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : 'Embedding failed',
        });
    }
}


// ============================================================
// Chat
// ============================================================

async function handleChat(
    id: string,
    payload: any
) {
    const messages = payload?.messages;

    if (
        !messages ||
        !Array.isArray(messages)
    ) {
        sendResponse({
            id,
            success: false,
            error: 'Invalid messages array',
        });

        return;
    }


    const isStream =
        payload?.stream === true;


    // ========================================================
    // Streaming
    // ========================================================

    if (isStream) {
        const abortController =
            new AbortController();

        activeStreams.set(
            id,
            abortController
        );

        try {
            await getChatCompletionStream(
                messages,

                (token) => {
                    sendResponse({
                        id,
                        content: token,
                    });
                },

                abortController.signal
            );


            if (!abortController.signal.aborted) {
                sendResponse({
                    id,
                    done: true,
                });
            }

        } catch (err) {

            if (
                abortController.signal.aborted
            ) {
                console.log(
                    `Stream ${id} aborted`
                );

            } else {

                sendResponse({
                    id,
                    success: false,
                    error:
                        err instanceof Error
                            ? err.message
                            : 'Chat stream failed',
                });
            }

        } finally {
            activeStreams.delete(id);
        }

        return;
    }


    // ========================================================
    // Non-streaming
    // ========================================================

    try {
        const content =
            await getChatCompletion(messages);

        sendResponse({
            id,
            success: true,
            data: content,
        });

    } catch (err) {
        sendResponse({
            id,
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : 'Chat failed',
        });
    }
}


// ============================================================
// Start
// ============================================================

async function start() {
    try {
        await initLMStudio();
    } catch (err) {
        console.error('LM Studio initialization failed:', err);
        process.exit(1);
    }
    connect();
}

setTimeout(() => {
    start();
}, 30_000);



// ============================================================
// Graceful shutdown
// ============================================================

function shutdown(signal: string) {
    console.log(
        getTime() + `${signal} received. Shutting down worker...`
    );

    shouldReconnect = false;

    stopHeartbeat();

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    abortActiveStreams();

    const socket = ws;

    ws = null;

    if (socket) {
        socket.close(1000, 'Worker shutting down');
    }

    /*
     * Give the WebSocket a moment to send the close frame.
     */
    setTimeout(() => {
        process.exit(0);
    }, 500);
}


process.on('SIGINT', () => {
    shutdown('SIGINT');
});

process.on('SIGTERM', () => {
    shutdown('SIGTERM');
});