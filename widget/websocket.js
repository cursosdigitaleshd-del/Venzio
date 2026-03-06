/**
 * WebSocket Communication Module
 * Comunicación con backend para envío de audio y recepción de respuestas
 */

import { CONFIG } from './config.js';

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;

        // Callbacks
        this.onTranscript = null; // (text: string) => void
        this.onReply = null;     // (text: string) => void
        this.onAudio = null;     // (audioBuffer: ArrayBuffer) => void
        this.onError = null;     // (message: string) => void
        this.onConnected = null; // () => void
        this.onDisconnected = null; // () => void
    }

    async connect(voiceId, token) {
        if (this.isConnected) return;

        try {
            const wsUrl = `${CONFIG.api.wsBaseUrl}/ws/public/voice/${voiceId}?token=${token}`;
            this.ws = new WebSocket(wsUrl);

            return new Promise((resolve, reject) => {
                this.ws.onopen = () => {
                    console.log('[WebSocket] Connected');
                    this.isConnected = true;
                    if (this.onConnected) this.onConnected();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this._handleMessage(event);
                };

                this.ws.onerror = (error) => {
                    console.error('[WebSocket] Error:', error);
                    if (this.onError) this.onError('Connection error');
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('[WebSocket] Disconnected');
                    this.isConnected = false;
                    if (this.onDisconnected) this.onDisconnected();
                };
            });

        } catch (error) {
            console.error('[WebSocket] Connection failed:', error);
            throw error;
        }
    }

    disconnect() {
        if (this.ws && this.isConnected) {
            this.ws.close();
        }
    }

    sendAudio(audioBuffer) {
        if (!this.isConnected || !this.ws) {
            console.error('[WebSocket] Not connected');
            return;
        }

        try {
            console.log(`[WebSocket] Sending audio: ${audioBuffer.byteLength} bytes`);
            this.ws.send(audioBuffer);
        } catch (error) {
            console.error('[WebSocket] Error sending audio:', error);
            if (this.onError) this.onError('Error sending audio');
        }
    }

    sendEndSession() {
        if (!this.isConnected || !this.ws) return;

        try {
            this.ws.send(JSON.stringify({ type: 'end_session' }));
        } catch (error) {
            console.error('[WebSocket] Error sending end_session:', error);
        }
    }

    _handleMessage(event) {
        if (event.data instanceof Blob) {
            // Binary audio data
            event.data.arrayBuffer().then(audioBuffer => {
                console.log(`[WebSocket] Received audio: ${audioBuffer.byteLength} bytes`);
                if (this.onAudio) this.onAudio(audioBuffer);
            });
        } else {
            // Text message
            try {
                const msg = JSON.parse(event.data);
                this._handleTextMessage(msg);
            } catch (error) {
                console.error('[WebSocket] Error parsing message:', error);
            }
        }
    }

    _handleTextMessage(msg) {
        switch (msg.type) {
            case 'session_ready':
                console.log('[WebSocket] Session ready:', msg.voice);
                break;

            case 'final_transcript':
                console.log('[WebSocket] Transcript:', msg.text);
                if (this.onTranscript) this.onTranscript(msg.text);
                break;

            case 'reply_text':
                console.log('[WebSocket] Reply:', msg.text);
                if (this.onReply) this.onReply(msg.text);
                break;

            case 'error':
                console.error('[WebSocket] Error:', msg.message);
                if (this.onError) this.onError(msg.message);
                break;

            default:
                console.log('[WebSocket] Unknown message type:', msg.type);
        }
    }
}

export { WebSocketClient };