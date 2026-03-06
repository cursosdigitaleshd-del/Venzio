/**
 * Venzio Widget Configuration
 * Configuraciones técnicas obligatorias para el sistema de voz
 */

const CONFIG = {
    // Audio settings
    audio: {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
    },

    // VAD settings
    vad: {
        threshold: 0.01,
        minSpeechMs: 200,
        silenceMs: 700,
    },

    // Prebuffer settings
    prebuffer: {
        durationMs: 300,
    },

    // Recording settings
    recording: {
        maxRecordingMs: 15000,
    },

    // WebSocket settings
    websocket: {
        maxAttempts: 3,
        delayMs: 2000,
    },

    // API settings
    api: {
        baseUrl: 'https://venzio.online',
        wsBaseUrl: 'wss://venzio.online',
    },
};

export { CONFIG };