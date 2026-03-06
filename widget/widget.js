/**
 * Venzio Voice Widget v1.0
 * WebSocket + WebRTC Voice Sales Agent with VAD
 *
 * States: idle → connecting → listening → user_speaking → processing → ai_speaking → waiting → error
 */

(function (window, document) {
    'use strict';

    // ── Config ──────────
    const CONFIG = {
        apiBase: 'https://venzio.online/api',
        wsBase: 'wss://venzio.online',
        agentName: window.VENZIO_NAME || 'Agente Venzio',
        autoOpen: false,
        // VAD Configuration
        vadThreshold: -40,        // dB threshold — menos sensible al ruido de fondo
        vadMinDuration: 200,      // ms para confirmar que es voz real (evita clics / tos)
        vadSilenceTimeout: 400,   // ms de silencio antes de cortar (más natural)
        vadLongSilence: 10000,    // ms largo silencio para intervención IA
        vadInactivityTimeout: 30000, // ms inactividad total para cerrar sesión
        vadMaxSpeakingTime: 15000, // ms máx de habla continua antes de forzar envío
        humanDelay: 100, // ms delay before AI response
        debugVAD: false, // Enable VAD logging for debugging
    };

    // ── State Machine ────────────────────────────────────────────────────────────
    const STATES = {
        IDLE: 'idle',
        CONNECTING: 'connecting',
        READY: 'ready',
        LISTENING: 'listening',
        USER_SPEAKING: 'user_speaking',
        PROCESSING: 'processing',
        AI_SPEAKING: 'ai_speaking',
        WAITING: 'waiting',
        ERROR: 'error',
    };

    class VenzioWidget {
        constructor() {
            this.state = STATES.IDLE;
            this.ws = null;
            this.mediaRecorder = null;
            this.audioStream = null;
            this.audioCtx = null;
            this.analyser = null;
            this.audioChunks = [];
            this.voices = [];
            this.selectedVoiceId = null;
            this.isOpen = false;
            this.sessionActive = false;

            // Audio streaming properties
            this.audioQueue = [];
            this.currentSource = null;
            this.playbackToken = 0;
            this.isDecoding = false;
            this.outputGain = null; // For fade-out

            // VAD properties
            this.vadInterval = null;
            this.silenceTimer = null;
            this.longSilenceTimer = null;
            this.inactivityTimer = null;
            this.speakingStartTime = null;
            this.lastVoiceTime = null;

            // Pre-roll buffer
            this.preRollBuffer = [];
            this.preRollMaxChunks = 3; // 300ms at 100ms chunks

            // Interruption control
            this.interrupting = false;
            this.interruptVoiceStart = null;

            // Recording timing
            this.recordingStartTime = null;
            this.currentUtteranceId = null;

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
                link.href = 'https://venzio.online/widget/widget.css';
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
              👋 ¡Hola! Soy tu agente de ventas virtual. Solo habla, te escucho automáticamente.
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
                const res = await fetch(`${CONFIG.apiBase}/public/voices`);
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
        async _getTemporalToken() {
            const siteId = window.VENZIO_SITE_ID;
            if (!siteId) throw new Error('[Venzio] window.VENZIO_SITE_ID no definido');

            const res = await fetch(
                `${CONFIG.apiBase.replace('/api', '')}/widget/auth?site_id=${encodeURIComponent(siteId)}`
            );

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(`[Venzio] Auth fallida: ${err.detail || res.status}`);
            }

            const { token, expires_in } = await res.json();

            // Auto-refresh 60s antes de expirar
            clearTimeout(this._tokenRefreshTimer);
            this._tokenRefreshTimer = setTimeout(
                () => this._getTemporalToken().catch(() => { }),
                (expires_in - 60) * 1000
            );

            this._widgetToken = token;
            return token;
        }

        async _connectWebSocket() {
            if (!this.selectedVoiceId) {
                this._addMessage('system', 'Selecciona una voz antes de iniciar.');
                return;
            }
            this._setState(STATES.CONNECTING);
            this._setStatus('Conectando...');

            let token;
            try {
                token = await this._getTemporalToken();
            } catch (e) {
                this._setState(STATES.ERROR);
                this._addMessage('error', `⚠️ ${e.message}`);
                this._setStatus('Error de autenticación');
                return;
            }

            const wsUrl = `${CONFIG.wsBase}/ws/public/voice/${this.selectedVoiceId}?token=${token}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
                this.sessionActive = true;
                this._startContinuousListening();
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof Blob) {
                    // Audio response from TTS - usar cola
                    await this.enqueueAudio(event.data);
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
                case 'partial_transcript':
                    // Show live transcription only when user is speaking
                    if (this.state === STATES.USER_SPEAKING) {
                        this._setStatus(`📝 ${msg.text}`);
                    }
                    break;
                case 'final_transcript':
                    // Show final transcription and process
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando tu consulta...');
                    break;
                case 'transcript':
                    // Legacy support for old transcript messages
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando tu consulta...');
                    break;
                case 'reply_text':
                    this._addMessage('agent', msg.text);
                    this._setState(STATES.AI_SPEAKING);
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
                    mimeType: MediaRecorder.isTypeSupported('audio/wav;codecs=pcm')
                        ? 'audio/wav;codecs=pcm'
                        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
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

        _pauseVAD() {
            if (this.vadInterval) {
                clearInterval(this.vadInterval);
                this.vadInterval = null;
            }
        }

        _resumeVAD() {
            if (!this.vadInterval) {
                this._startVAD();
            }
        }

        // ── Audio Context Initialization ───────────────────────────────────────────
        _initAudioContext() {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                // Initialize output gain for fade-out
                this.outputGain = this.audioCtx.createGain();
                this.outputGain.connect(this.audioCtx.destination);
            }
        }

        // ── Audio Queue System ────────────────────────────────────────────────────
        async enqueueAudio(blob) {
            this._initAudioContext(); // Garantizar contexto

            this.audioQueue.push(blob);

            if (!this.currentSource && !this.isDecoding) {
                this._playNext();
            }
        }

        async _playNext() {
            if (this.isDecoding) return;

            if (this.audioQueue.length === 0) {
                this.isDecoding = false;
                return;
            }

            this.isDecoding = true;
            const currentToken = this.playbackToken;

            const blob = this.audioQueue.shift();

            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);

                if (currentToken !== this.playbackToken) {
                    this.isDecoding = false;
                    return;
                }

                const source = this.audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.outputGain); // Use output gain for fade-out control

                this.currentSource = source;

                source.onended = () => {
                    if (currentToken !== this.playbackToken) return;

                    this.currentSource = null;
                    this.isDecoding = false;
                    this._playNext();
                };

                source.start(0);

            } catch (err) {
                console.error("Audio decode error:", err);
                this.isDecoding = false;

                if (currentToken === this.playbackToken) {
                    this._playNext();
                }
            }
        }

        // ── Audio Control ──────────────────────────────────────────────────────────
        stopAudio() {
            this.audioQueue = [];

            if (this.currentSource) {
                try {
                    this.currentSource.stop();
                } catch (e) {
                    // Ignore if already stopped
                }
                this.currentSource = null;
            }
        }

        // ── Legacy Audio Playback (for compatibility) ─────────────────────────────
        async _playAudio(blob) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.humanDelay));

            this._pauseVAD(); // 🔥 PAUSAR DETECCIÓN

            this._setState(STATES.AI_SPEAKING);

            try {
                const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
                const arrayBuf = await blob.arrayBuffer();
                const audioBuf = await ctx.decodeAudioData(arrayBuf);
                const source = ctx.createBufferSource();
                source.buffer = audioBuf;
                source.connect(ctx.destination);
                this.currentSource = source;

                source.start(0);

                source.onended = () => {
                    this.currentSource = null;
                    this._resumeVAD(); // 🔥 REACTIVAR VAD
                    this._setState(STATES.LISTENING);
                    this._setStatus('Escuchando...');
                };

            } catch (err) {
                console.error('[Venzio] Audio playback error:', err);
                this._resumeVAD();
                this._setState(STATES.LISTENING);
            }
        }

        // ── VAD Methods ────────────────────────────────────────────────────────────
        async _startContinuousListening() {
            try {
                // Enhanced getUserMedia with echo cancellation
                this.audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1
                    },
                    video: false
                });

                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (this.audioCtx.state === 'suspended') {
                    await this.audioCtx.resume();
                }

                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.4;

                const source = this.audioCtx.createMediaStreamSource(this.audioStream);
                source.connect(this.analyser);

                this.audioChunks = [];

                this.mediaRecorder = new MediaRecorder(this.audioStream, {
                    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                        ? 'audio/webm;codecs=opus'
                        : 'audio/ogg',
                });

                // Continuous recording with pre-roll buffer
                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size === 0) return;

                    if (this.state === STATES.LISTENING) {
                        // Maintain pre-roll buffer (last 300ms)
                        this.preRollBuffer.push({
                            chunk: e.data,
                            time: Date.now()
                        });
                        this.preRollBuffer = this.preRollBuffer.filter(
                            c => Date.now() - c.time < 300
                        );
                        // Memory protection
                        if (this.preRollBuffer.length > 10) {
                            this.preRollBuffer.shift();
                        }
                    } else if (this.state === STATES.USER_SPEAKING) {
                        // Collect user speech chunks
                        this.audioChunks.push(e.data);
                    }
                };

                this.mediaRecorder.onstop = () => {
                    // Send any pending audio when manually stopped
                    this._sendPendingAudio();
                };

                // Start continuous recording with 100ms chunks
                this.mediaRecorder.start(100);

                this._startVAD();
                this._startInactivityTimer();

                console.log('[Venzio] VAD con pre-roll iniciado correctamente');

            } catch (err) {
                console.error('[Venzio] Error micrófono:', err);
                this._setState(STATES.ERROR);
            }
        }

        _sendPendingAudio() {
            if (this.audioChunks.length === 0) {
                console.warn('[Venzio] No audio chunks collected');
                return;
            }

            console.log('[Venzio] Sending audio chunks:', this.audioChunks.length);

            const duration = Date.now() - this.recordingStartTime;

            if (duration < 300) {
                console.warn('[Venzio] Audio demasiado corto, ignorado');
                this.audioChunks = [];
                this.recordingStartTime = null;
                return;
            }

            // Send chunks individually as expected by backend
            for (const chunk of this.audioChunks) {
                chunk.arrayBuffer().then(buf => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(buf);
                    }
                });
            }

            this.audioChunks = [];
            this.recordingStartTime = null;
        }

        _startRecordingAfterInterrupt() {
            // Add pre-roll buffer to start of recording
            this.audioChunks = this.preRollBuffer.map(c => c.chunk);
            this.preRollBuffer = []; // Clear for next time

            this.recordingStartTime = Date.now();
            this._setState(STATES.USER_SPEAKING);
            this._setStatus('🎤 Hablando...');
            this._resetInactivityTimer();
        }

        _startVAD() {
            this.vadInterval = setInterval(() => {
                const rms = this._calculateRMS();
                const db = 20 * Math.log10(rms || 0.0001);
                this._processVAD(db);
            }, 50); // Check every 50ms
        }

        _calculateRMS() {
            if (!this.analyser) return 0;
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                // Normalize to 0-1
                const amplitude = dataArray[i] / 255;
                sum += amplitude * amplitude;
            }
            return Math.sqrt(sum / bufferLength);
        }

        _processVAD(db) {
            if (CONFIG.debugVAD) {
                console.log('[Venzio] VAD db:', db, 'state:', this.state);
            }
            const now = Date.now();

            if (db > CONFIG.vadThreshold) {
                // Voice detected
                this.lastVoiceTime = now;

                if (this.state === STATES.LISTENING) {
                    if (!this.speakingStartTime) {
                        this.speakingStartTime = now;
                    } else if (now - this.speakingStartTime > CONFIG.vadMinDuration) {
                        this._onVoiceStart();
                    }
                } else if (this.state === STATES.AI_SPEAKING) {
                    // Interruption with confirmation (100ms continuous voice)
                    if (db > -35) {
                        if (!this.interruptVoiceStart) {
                            this.interruptVoiceStart = now;
                        }
                        if (now - this.interruptVoiceStart > 100) {
                            this.interruptVoiceStart = null;
                            this._interruptAI();
                            this._onVoiceStart();
                        }
                    } else {
                        this.interruptVoiceStart = null;
                    }
                    return; // Don't process other VAD while AI is speaking
                }

                // Clear silence timers
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                    this.silenceTimer = null;
                }
                if (this.longSilenceTimer) {
                    clearTimeout(this.longSilenceTimer);
                    this.longSilenceTimer = null;
                }
            } else {
                // Silence detected
                if (this.state === STATES.USER_SPEAKING) {
                    if (this.lastVoiceTime && Date.now() - this.lastVoiceTime > CONFIG.vadSilenceTimeout) {
                        this._onVoiceEnd();
                    }
                } else if (this.state === STATES.LISTENING && this.lastVoiceTime) {
                    if (!this.longSilenceTimer) {
                        this.longSilenceTimer = setTimeout(() => {
                            this._onLongSilence();
                        }, CONFIG.vadLongSilence);
                    }
                }
            }

            // Check max speaking time
            if (this.state === STATES.USER_SPEAKING && this.speakingStartTime && now - this.speakingStartTime > CONFIG.vadMaxSpeakingTime) {
                console.log('[Venzio] Max speaking time reached, sending audio...');
                this._onVoiceEnd();
            }
        }

        _onVoiceStart() {
            console.log('[Venzio] Voice detected, starting recording with pre-roll...');

            // Send audio_start metadata
            const utteranceId = Date.now().toString();
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'audio_start',
                    id: utteranceId
                }));
            }

            // Add pre-roll buffer to start of recording
            this.audioChunks = this.preRollBuffer.map(c => c.chunk);
            this.preRollBuffer = []; // Clear for next time

            this.recordingStartTime = Date.now();
            this.currentUtteranceId = utteranceId; // Store for later
            this._setState(STATES.USER_SPEAKING);
            this._setStatus('🎤 Hablando...');
            this._resetInactivityTimer();
        }

        _onVoiceEnd() {
            console.log('[Venzio] Voz finalizada, cerrando segmento...');

            // Send pending audio chunks first
            this._sendPendingAudio();

            // Send audio_end metadata
            if (this.currentUtteranceId && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'audio_end',
                    id: this.currentUtteranceId
                }));
            }

            this.silenceTimer = null;
            this.speakingStartTime = null;
            this.currentUtteranceId = null;

            this._setState(STATES.PROCESSING);
            this._setStatus('Analizando...');
        }

        _interruptAI() {
            // Lock to prevent multiple interruptions
            if (this.interrupting) return;
            this.interrupting = true;

            this.playbackToken = Date.now();
            this.audioQueue = [];

            // Fade-out suave usando outputGain
            if (this.currentSource) {
                this.outputGain.gain.setValueAtTime(1, this.audioCtx.currentTime);
                this.outputGain.gain.exponentialRampToValueAtTime(
                    0.001, // Muy bajo pero no cero (evita clicks)
                    this.audioCtx.currentTime + 0.05 // 50ms fade-out
                );

            setTimeout(() => {
                if (this.currentSource) {
                    this.currentSource.stop();
                    this.currentSource = null;
                }
                // Reset gain para próximos audios
                this.outputGain.gain.setValueAtTime(1, this.audioCtx.currentTime);

                // Start recording after interruption cooldown
                this._startRecordingAfterInterrupt();
                this.interrupting = false; // Unlock
            }, 150); // 150ms cooldown to avoid echo
            }

            this._setStatus('👤 Interrupción detectada...');
        }

        _onLongSilence() {
            this.longSilenceTimer = null;
            // Could send a message to AI to continue or ask for clarification
            // For now, just reset to listening
            this._setState(STATES.LISTENING);
            this._setStatus('Escuchando...');
        }

        _startInactivityTimer() {
            this.inactivityTimer = setTimeout(() => {
                this._onInactivityTimeout();
            }, CONFIG.vadInactivityTimeout);
        }

        _resetInactivityTimer() {
            if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
            }
            this._startInactivityTimer();
        }

        _onInactivityTimeout() {
            this._addMessage('system', 'Sesión cerrada por inactividad.');
            this._endSession();
        }

        _stopVAD() {
            if (this.vadInterval) {
                clearInterval(this.vadInterval);
                this.vadInterval = null;
            }
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
            if (this.longSilenceTimer) {
                clearTimeout(this.longSilenceTimer);
                this.longSilenceTimer = null;
            }
            if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
                this.inactivityTimer = null;
            }
        }

        // ── End Session ────────────────────────────────────────────────────────────
        _endSession() {
            this._stopVAD();
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
            if (state === STATES.AI_SPEAKING) viz.classList.add('speaking');
            if (state === STATES.USER_SPEAKING) viz.classList.add('user_speaking');

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
