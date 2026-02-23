/**
 * Venzio Voice Widget v1.0
 * WebSocket + WebRTC Voice Sales Agent
 *
 * States: idle → connecting → ready → listening → processing → speaking → error
 */

(function (window, document) {
    'use strict';

    // ── Config (can be overridden via data attributes on <script> tag) ──────────
    const CONFIG = {
        apiBase: window.VENZIO_API || 'http://localhost:8000',
        wsBase: window.VENZIO_WS || 'ws://localhost:8000',
        agentName: window.VENZIO_NAME || 'Agente Venzio',
        autoOpen: false,
    };

    // ── State Machine ────────────────────────────────────────────────────────────
    const STATES = {
        IDLE: 'idle',
        CONNECTING: 'connecting',
        READY: 'ready',
        LISTENING: 'listening',
        PROCESSING: 'processing',
        SPEAKING: 'speaking',
        ERROR: 'error',
    };

    class VenzioWidget {
        constructor() {
            this.state = STATES.IDLE;
            this.ws = null;
            this.mediaRecorder = null;
            this.audioStream = null;
            this.audioCtx = null;
            this.audioChunks = [];
            this.voices = [];
            this.selectedVoiceId = null;
            this.isOpen = false;
            this.sessionActive = false;

            this._build();
            this._loadVoices();
        }

        // ── DOM Construction ───────────────────────────────────────────────────────
        _build() {
            // Inject CSS if not already present
            if (!document.getElementById('vz-styles')) {
                const link = document.createElement('link');
                link.id = 'vz-styles';
                link.rel = 'stylesheet';
                link.href = CONFIG.apiBase.replace(/\/$/, '') + '/widget/widget.css';
                document.head.appendChild(link);
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'vz-widget';
            wrapper.id = 'vz-widget';
            wrapper.innerHTML = `
        <!-- Floating trigger button -->
        <button class="vz-trigger" id="vz-trigger" aria-label="Abrir agente de voz">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>

        <!-- Chat Panel -->
        <div class="vz-panel" id="vz-panel" role="dialog" aria-label="Agente de voz Venzio">
          <!-- Header -->
          <div class="vz-header">
            <div class="vz-header-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
            </div>
            <div class="vz-header-info">
              <h3>${CONFIG.agentName}</h3>
              <p><span class="vz-status-dot"></span>En línea</p>
            </div>
          </div>

          <!-- Voice Selector -->
          <div class="vz-voice-selector" id="vz-voice-selector">
            <label for="vz-voice-select">Voz del agente</label>
            <select id="vz-voice-select">
              <option value="">Cargando voces...</option>
            </select>
          </div>

          <!-- Messages -->
          <div class="vz-messages" id="vz-messages">
            <div class="vz-msg agent">
              👋 ¡Hola! Soy tu agente de ventas virtual. Presiona el micrófono y habla conmigo.
            </div>
          </div>

          <!-- Waveform Visualizer -->
          <div class="vz-visualizer" id="vz-visualizer">
            ${Array.from({ length: 10 }, () => '<div class="vz-bar"></div>').join('')}
          </div>

          <!-- Controls -->
          <div class="vz-controls">
            <button class="vz-mic-btn" id="vz-mic-btn" aria-label="Hablar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            <div class="vz-status-text" id="vz-status-text">
              <span>Listo</span> — Presiona el micrófono para hablar
            </div>
            <button class="vz-end-btn" id="vz-end-btn">Terminar</button>
          </div>
        </div>
      `;

            document.body.appendChild(wrapper);

            // Cache elements
            this.$trigger = document.getElementById('vz-trigger');
            this.$panel = document.getElementById('vz-panel');
            this.$msgs = document.getElementById('vz-messages');
            this.$micBtn = document.getElementById('vz-mic-btn');
            this.$endBtn = document.getElementById('vz-end-btn');
            this.$status = document.getElementById('vz-status-text');
            this.$viz = document.getElementById('vz-visualizer');
            this.$voiceSel = document.getElementById('vz-voice-select');

            // Events
            this.$trigger.addEventListener('click', () => this.togglePanel());
            this.$micBtn.addEventListener('click', () => this._onMicClick());
            this.$endBtn.addEventListener('click', () => this._endSession());
        }

        // ── Load Voices from API ───────────────────────────────────────────────────
        async _loadVoices() {
            try {
                const res = await fetch(`${CONFIG.apiBase}/voices`);
                if (!res.ok) throw new Error('API error');
                this.voices = await res.json();
                const sel = this.$voiceSel;
                sel.innerHTML = '';
                if (this.voices.length === 0) {
                    sel.innerHTML = '<option value="">Sin voces disponibles</option>';
                    return;
                }
                this.voices.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = `${v.name} (${v.language.toUpperCase()})`;
                    sel.appendChild(opt);
                });
                this.selectedVoiceId = this.voices[0].id;
                sel.addEventListener('change', () => {
                    this.selectedVoiceId = Number(sel.value);
                });
            } catch (e) {
                this.$voiceSel.innerHTML = '<option value="">Error cargando voces</option>';
                console.warn('[Venzio] No se pudieron cargar las voces:', e);
            }
        }

        // ── Panel Toggle ───────────────────────────────────────────────────────────
        togglePanel() {
            this.isOpen = !this.isOpen;
            this.$panel.classList.toggle('open', this.isOpen);
            this.$trigger.classList.toggle('active', this.isOpen);
            if (this.isOpen && this.state === STATES.IDLE) {
                this._connectWebSocket();
            }
        }

        // ── WebSocket Connection ───────────────────────────────────────────────────
        _connectWebSocket() {
            if (!this.selectedVoiceId) {
                this._addMessage('system', 'Selecciona una voz antes de iniciar.');
                return;
            }
            this._setState(STATES.CONNECTING);
            this._setStatus('Conectando...');

            const wsUrl = `${CONFIG.wsBase}/ws/voice/${this.selectedVoiceId}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this._setState(STATES.READY);
                this._setStatus('<span>Conectado</span> — Presiona el micrófono para hablar');
                this.sessionActive = true;
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof Blob) {
                    // Audio response from TTS
                    await this._playAudio(event.data);
                } else {
                    const msg = JSON.parse(event.data);
                    this._handleServerMessage(msg);
                }
            };

            this.ws.onerror = () => {
                this._setState(STATES.ERROR);
                this._addMessage('error', '⚠️ Error de conexión. Recarga la página e intenta de nuevo.');
                this._setStatus('Error de conexión');
            };

            this.ws.onclose = () => {
                if (this.sessionActive) {
                    this._addMessage('system', 'Sesión finalizada.');
                    this.sessionActive = false;
                }
                this._setState(STATES.IDLE);
                this._setStatus('<span>Desconectado</span>');
            };
        }

        // ── Server Message Handler ─────────────────────────────────────────────────
        _handleServerMessage(msg) {
            switch (msg.type) {
                case 'session_ready':
                    this._addMessage('system', `🎙 Sesión iniciada — Voz: ${msg.voice}`);
                    break;
                case 'transcript':
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando tu consulta...');
                    break;
                case 'reply_text':
                    this._addMessage('agent', msg.text);
                    this._setState(STATES.SPEAKING);
                    this._setStatus('Respondiendo...');
                    break;
                case 'error':
                    this._addMessage('error', `⚠️ ${msg.message}`);
                    this._setState(STATES.READY);
                    this._setStatus('<span>Listo</span> — Intenta hablar de nuevo');
                    break;
                default:
                    console.debug('[Venzio] Mensaje desconocido:', msg);
            }
        }

        // ── Mic Button ─────────────────────────────────────────────────────────────
        async _onMicClick() {
            if (this.state === STATES.LISTENING) {
                this._stopRecording();
            } else if (this.state === STATES.READY) {
                await this._startRecording();
            }
        }

        async _startRecording() {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this._addMessage('error', '⚠️ No hay conexión activa.');
                return;
            }
            try {
                this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                this.audioChunks = [];

                this.mediaRecorder = new MediaRecorder(this.audioStream, {
                    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                        ? 'audio/webm;codecs=opus'
                        : 'audio/ogg',
                });

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) this.audioChunks.push(e.data);
                };

                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                    blob.arrayBuffer().then(buf => {
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(buf);
                        }
                    });
                };

                this.mediaRecorder.start();
                this._setState(STATES.LISTENING);
                this.$micBtn.classList.add('recording');
                this._setStatus('🔴 Grabando... Suelta para enviar');
            } catch (err) {
                this._addMessage('error', '⚠️ No se pudo acceder al micrófono. Verifica los permisos.');
                console.error('[Venzio] Mic error:', err);
            }
        }

        _stopRecording() {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                this.audioStream.getTracks().forEach(t => t.stop());
            }
            this.$micBtn.classList.remove('recording');
            this._setState(STATES.PROCESSING);
            this._setStatus('Enviando audio...');
        }

        // ── Audio Playback ─────────────────────────────────────────────────────────
        async _playAudio(blob) {
            this._setState(STATES.SPEAKING);
            try {
                const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
                const arrayBuf = await blob.arrayBuffer();
                const audioBuf = await ctx.decodeAudioData(arrayBuf);
                const source = ctx.createBufferSource();
                source.buffer = audioBuf;
                source.connect(ctx.destination);
                source.start(0);
                source.onended = () => {
                    this._setState(STATES.READY);
                    this._setStatus('<span>Listo</span> — Presiona el micrófono para responder');
                };
            } catch (err) {
                console.error('[Venzio] Audio playback error:', err);
                this._setState(STATES.READY);
            }
        }

        // ── End Session ────────────────────────────────────────────────────────────
        _endSession() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'end_session' }));
                this.ws.close();
            }
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(t => t.stop());
            }
            this.$micBtn.classList.remove('recording');
            this.sessionActive = false;
            this._setState(STATES.IDLE);
        }

        // ── Helpers ────────────────────────────────────────────────────────────────
        _setState(state) {
            this.state = state;
            const viz = this.$viz;
            viz.className = 'vz-visualizer';
            if (state === STATES.LISTENING) viz.classList.add('listening');
            if (state === STATES.PROCESSING) viz.classList.add('processing');
            if (state === STATES.SPEAKING) viz.classList.add('speaking');

            const isListening = state === STATES.LISTENING;
            const canTalk = [STATES.READY, STATES.LISTENING].includes(state);
            this.$micBtn.disabled = !canTalk;
        }

        _setStatus(html) {
            this.$status.innerHTML = html;
        }

        _addMessage(type, text) {
            const div = document.createElement('div');
            div.className = `vz-msg ${type}`;
            div.textContent = text;
            this.$msgs.appendChild(div);
            this.$msgs.scrollTop = this.$msgs.scrollHeight;
        }
    }

    // ── Auto-init ────────────────────────────────────────────────────────────────
    function init() {
        if (document.getElementById('vz-widget')) return; // already mounted
        window.VenzioWidget = new VenzioWidget();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window, document);
