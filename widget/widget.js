/**
 * Venzio Widget - Main Orchestrator
 * Gestiona máquina de estados y coordina módulos
 */

import { CONFIG } from './config.js';
import { AudioCapture } from './audio_capture.js';
import { VAD } from './vad.js';
import { Recorder } from './recorder.js';
import { WebSocketClient } from './websocket.js';
import { AudioPlayer } from './player.js';

const STATES = {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    LISTENING: 'listening',
    RECORDING: 'recording',
    PROCESSING: 'processing',
    PLAYING: 'playing',
    ERROR: 'error',
};

class VenzioWidget {
    constructor(options = {}) {
        console.log('[Venzio][DEBUG] widget constructor called');

        // Validar parámetros requeridos
        if (!options.siteId || !options.voiceId || !options.token) {
            throw new Error('siteId, voiceId y token son requeridos');
        }

        this.options = {
            apiBase: options.apiBase || CONFIG.api.baseUrl,
            agentName: options.agentName || 'Agente Venzio',
            siteId: options.siteId,
            voiceId: options.voiceId,
            token: options.token,
            ...options
        };

        this.state = STATES.IDLE;

        // Initialize modules
        this.audioCapture = new AudioCapture();
        this.vad = new VAD();
        this.recorder = new Recorder();
        this.wsClient = new WebSocketClient();
        this.player = new AudioPlayer();

        // Setup event handlers
        this._setupEventHandlers();

        // DOM elements
        this.elements = {};
        this.isOpen = false;

        this._buildUI();
    }

    // ── State Management ──────────────────────────────────────────────────────
    _setState(newState) {
        console.log(`[Widget] State: ${this.state} → ${newState}`);
        this.state = newState;
        this._updateUI();
    }

    // ── Module Event Handlers ─────────────────────────────────────────────────
    _setupEventHandlers() {
        // Audio capture
        this.audioCapture.onAudioFrame = (samples) => {
            this.vad.processAudioFrame(samples);
            this.recorder.processAudioFrame(samples);
        };

        // VAD
        this.vad.onVoiceStart = () => {
            console.log('[Venzio][DEBUG] VAD voice start detected');
            console.log('[Venzio][DEBUG] current state:', this.state);

            // Barge-in: interrupt playback if user speaks while agent is talking
            if (this.state === STATES.PLAYING) {
                // Anti-echo protection: ignore voice detection within 150ms of playback start
                if (this.playingStartedAt && (Date.now() - this.playingStartedAt) < 150) {
                    console.log('[Venzio][DEBUG] voice ignored (anti-echo protection)');
                    return;
                }

                console.log('[Venzio][DEBUG] barge-in triggered');
                console.log('[Venzio][DEBUG] stopping player');
                this.player.stop();
                this.recorder.startRecording();
                this._setState(STATES.RECORDING);
                return;
            }

            // Normal voice start when listening
            if (this.state === STATES.LISTENING) {
                this.recorder.startRecording();
                this._setState(STATES.RECORDING);
            }
        };

        this.vad.onVoiceEnd = () => {
            if (this.state === STATES.RECORDING) {
                this.recorder.stopRecording();
                this._setState(STATES.PROCESSING);
            }
        };

        // Recorder
        this.recorder.onAudioReady = (wavBuffer) => {
            this.wsClient.sendAudio(wavBuffer);
        };

        // WebSocket
        this.wsClient.onConnected = () => {
            this._startAudioPipeline();
            this._setState(STATES.LISTENING);
        };

        this.wsClient.onDisconnected = () => {
            this._stopAudioPipeline();
            this._setState(STATES.IDLE);
        };

        this.wsClient.onTranscript = (text) => {
            this._addMessage('user', text);
        };

        this.wsClient.onReply = (text) => {
            this._addMessage('agent', text);
        };

        this.wsClient.onAudio = (audioBuffer) => {
            this.playingStartedAt = Date.now();
            this.player.play(audioBuffer);
            this._setState(STATES.PLAYING);
        };

        this.wsClient.onError = (message) => {
            this._addMessage('error', message);
            this._setState(STATES.ERROR);
        };

        // Player
        this.player.onEnd = () => {
            this._setState(STATES.LISTENING);
        };
    }

    // ── Audio Pipeline Control ────────────────────────────────────────────────
    async _startAudioPipeline() {
        try {
            await this.audioCapture.start();
            console.log('[Widget] Audio pipeline started');
        } catch (error) {
            console.error('[Widget] Failed to start audio pipeline:', error);
            this._setState(STATES.ERROR);
        }
    }

    _stopAudioPipeline() {
        this.audioCapture.stop();
        this.vad.reset();
        this.recorder.reset();
        console.log('[Widget] Audio pipeline stopped');
    }

    // ── WebSocket Connection ──────────────────────────────────────────────────
    async _connectWebSocket() {
        if (!this.options.voiceId || !this.options.token) {
            this._addMessage('error', 'Configuración incompleta');
            return;
        }

        this._setState(STATES.CONNECTING);

        try {
            await this.wsClient.connect(this.options.voiceId, this.options.token);
        } catch (error) {
            console.error('[Widget] Connection failed:', error);
            this._setState(STATES.ERROR);
        }
    }

    // ── UI Management ────────────────────────────────────────────────────────
    _buildUI() {
        console.log('[Venzio][DEBUG] building UI');

        // Load CSS
        if (!document.getElementById('vz-styles')) {
            const link = document.createElement('link');
            link.id = 'vz-styles';
            link.rel = 'stylesheet';
            link.href = `${this.options.apiBase.replace('/api', '')}/widget/widget.css`;
            document.head.appendChild(link);
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'vz-widget';
        wrapper.id = 'vz-widget';
        wrapper.innerHTML = `
            <button class="vz-trigger" id="vz-trigger" aria-label="Abrir agente de voz">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            </button>

            <div class="vz-panel" id="vz-panel">
                <div class="vz-header">
                    <div class="vz-header-avatar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        </svg>
                    </div>
                    <div class="vz-header-info">
                        <h3>${this.options.agentName}</h3>
                        <p><span class="vz-status-dot"></span>En línea</p>
                    </div>
                </div>

                <div class="vz-messages" id="vz-messages">
                    <div class="vz-msg agent">
                        👋 ¡Hola! Soy tu agente de ventas virtual. Te escucho automáticamente.
                    </div>
                </div>

                <div class="vz-visualizer" id="vz-visualizer">
                    ${Array.from({ length: 10 }, () => '<div class="vz-bar"></div>').join('')}
                </div>

                <div class="vz-controls">
                    <div class="vz-status-text" id="vz-status-text">
                        <span>Listo</span> — Abre el panel para conectar
                    </div>
                    <button class="vz-end-btn" id="vz-end-btn">Terminar</button>
                </div>
            </div>
        `;

        document.body.appendChild(wrapper);

        this.elements.trigger = document.getElementById('vz-trigger');
        this.elements.panel = document.getElementById('vz-panel');
        this.elements.messages = document.getElementById('vz-messages');
        this.elements.status = document.getElementById('vz-status-text');
        this.elements.endBtn = document.getElementById('vz-end-btn');
        this.elements.visualizer = document.getElementById('vz-visualizer');

        this.elements.trigger.addEventListener('click', () => this.togglePanel());
        this.elements.endBtn.addEventListener('click', () => this.endSession());
    }

    togglePanel() {
        this.isOpen = !this.isOpen;
        this.elements.panel.classList.toggle('open', this.isOpen);
        this.elements.trigger.classList.toggle('active', this.isOpen);

        if (this.isOpen && this.state === STATES.IDLE) {
            this._connectWebSocket();
        }
    }

    _updateUI() {
        const viz = this.elements.visualizer;
        viz.className = 'vz-visualizer';

        switch (this.state) {
            case STATES.LISTENING:
                viz.classList.add('listening');
                this._setStatus('Escuchando...');
                break;
            case STATES.RECORDING:
                viz.classList.add('user_speaking');
                this._setStatus('Hablando...');
                break;
            case STATES.PROCESSING:
                viz.classList.add('processing');
                this._setStatus('Procesando...');
                break;
            case STATES.PLAYING:
                viz.classList.add('speaking');
                this._setStatus('Respondiendo...');
                break;
            case STATES.CONNECTING:
                this._setStatus('Conectando...');
                break;
            case STATES.ERROR:
                this._setStatus('Error');
                break;
            default:
                this._setStatus('Listo');
        }
    }

    _setStatus(text) {
        this.elements.status.innerHTML = `<span>${text}</span>`;
    }

    _addMessage(type, text) {
        const div = document.createElement('div');
        div.className = `vz-msg ${type}`;
        div.textContent = text;
        this.elements.messages.appendChild(div);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    // ── Session Management ────────────────────────────────────────────────────
    endSession() {
        this._stopAudioPipeline();
        this.wsClient.sendEndSession();
        this.wsClient.disconnect();
        this.player.destroy();
        this._setState(STATES.IDLE);
        this._setStatus('Sesión terminada');
    }

    destroy() {
        this.endSession();
        if (this.elements.trigger) {
            this.elements.trigger.remove();
        }
    }
}

// Export for module system and global access
export { VenzioWidget };

// Make available globally for embed.js
if (typeof window !== 'undefined') {
    window.VenzioWidget = VenzioWidget;
}
