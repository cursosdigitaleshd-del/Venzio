/**
 * Venzio Voice Widget v2.0 - Simplified
 * WebSocket + WebRTC Voice Sales Agent with VAD
 *
 * States: idle → connecting → listening → user_speaking → processing → ai_speaking
 */

(function (window, document) {
    'use strict';

    // ── Config ──────────
    const CONFIG = {
        apiBase: 'https://venzio.online/api',
        wsBase: 'wss://venzio.online',
        agentName: window.VENZIO_NAME || 'Agente Venzio',
        
        // VAD Configuration - Simplificado
        vadThreshold: -40,        // dB threshold
        vadMinDuration: 300,      // ms mínimo de voz para iniciar
        vadSilenceTimeout: 800,   // ms de silencio para cortar
        vadMaxSpeakingTime: 20000, // ms máximo hablando
        
        recordingChunkSize: 100,  // ms por chunk
        debugVAD: true,
    };

    // ── State Machine ────────────────────────────────────────────────────────────
    const STATES = {
        IDLE: 'idle',
        CONNECTING: 'connecting',
        LISTENING: 'listening',
        USER_SPEAKING: 'user_speaking',
        PROCESSING: 'processing',
        AI_SPEAKING: 'ai_speaking',
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
            this.voices = [];
            this.selectedVoiceId = null;
            this.isOpen = false;
            this.sessionActive = false;

            // Audio playback
            this.currentAudioSource = null;

            // VAD tracking
            this.vadInterval = null;
            this.voiceDetectedTime = null;
            this.lastVoiceTime = null;
            this.silenceCheckInterval = null;
            
            // Recording buffer
            this.currentRecordingChunks = [];
            this.isRecording = false;

            // Utterance tracking
            this.currentUtteranceId = null;

            this._build();
            this._loadVoices();
        }

        // ── DOM Construction ───────────────────────────────────────────────────────
        _build() {
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
              👋 ¡Hola! Soy tu agente de ventas virtual. Te escucho automáticamente.
            </div>
          </div>

          <!-- Waveform Visualizer -->
          <div class="vz-visualizer" id="vz-visualizer">
            ${Array.from({ length: 10 }, () => '<div class="vz-bar"></div>').join('')}
          </div>

          <!-- Controls -->
          <div class="vz-controls">
            <button class="vz-mic-btn" id="vz-mic-btn" aria-label="Estado del micrófono" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            <div class="vz-status-text" id="vz-status-text">
              <span>Listo</span> — Abre el panel para conectar
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
            this.$endBtn.addEventListener('click', () => this._endSession());
        }

        // ── Load Voices ─────────────────────────────────────────────────────────────
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
                throw new Error(`Auth fallida: ${err.detail || res.status}`);
            }

            const { token, expires_in } = await res.json();

            clearTimeout(this._tokenRefreshTimer);
            this._tokenRefreshTimer = setTimeout(
                () => this._getTemporalToken().catch(() => {}),
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
                console.log('[Venzio] WebSocket connected');
                this.sessionActive = true;
                this._startListening();
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof Blob) {
                    // Audio TTS response
                    await this._playAudio(event.data);
                } else {
                    const msg = JSON.parse(event.data);
                    this._handleServerMessage(msg);
                }
            };

            this.ws.onerror = (err) => {
                console.error('[Venzio] WebSocket error:', err);
                this._setState(STATES.ERROR);
                this._addMessage('error', '⚠️ Error de conexión');
                this._setStatus('Error de conexión');
            };

            this.ws.onclose = () => {
                console.log('[Venzio] WebSocket closed');
                if (this.sessionActive) {
                    this._addMessage('system', 'Sesión finalizada.');
                    this.sessionActive = false;
                }
                this._stopListening();
                this._setState(STATES.IDLE);
                this._setStatus('Desconectado');
            };
        }

        // ── Server Message Handler ─────────────────────────────────────────────────
        _handleServerMessage(msg) {
            console.log('[Venzio] Server message:', msg);
            
            switch (msg.type) {
                case 'session_ready':
                    this._addMessage('system', `🎙 Sesión iniciada — Voz: ${msg.voice}`);
                    break;
                    
                case 'partial_transcript':
                    if (this.state === STATES.USER_SPEAKING) {
                        this._setStatus(`📝 ${msg.text}`);
                    }
                    break;
                    
                case 'final_transcript':
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando...');
                    break;
                    
                case 'transcript':
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando...');
                    break;
                    
                case 'reply_text':
                    this._addMessage('agent', msg.text);
                    // El audio viene separado como Blob
                    break;
                    
                case 'error':
                    this._addMessage('error', `⚠️ ${msg.message}`);
                    this._setState(STATES.LISTENING);
                    this._setStatus('Escuchando...');
                    break;
                    
                default:
                    console.debug('[Venzio] Unknown message:', msg);
            }
        }

        // ── Audio Playback ─────────────────────────────────────────────────────────
        async _playAudio(blob) {
            // Stop VAD while AI is speaking
            this._pauseVAD();
            
            this._setState(STATES.AI_SPEAKING);
            this._setStatus('🔊 Respondiendo...');

            try {
                if (!this.audioCtx) {
                    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }

                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                
                const source = this.audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.audioCtx.destination);
                
                this.currentAudioSource = source;

                source.onended = () => {
                    this.currentAudioSource = null;
                    this._setState(STATES.LISTENING);
                    this._setStatus('Escuchando...');
                    this._resumeVAD();
                };

                source.start(0);

            } catch (err) {
                console.error('[Venzio] Audio playback error:', err);
                this._setState(STATES.LISTENING);
                this._resumeVAD();
            }
        }

        // ── Listening & Recording ──────────────────────────────────────────────────
        async _startListening() {
            try {
                this.audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1
                    }
                });

                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (this.audioCtx.state === 'suspended') {
                    await this.audioCtx.resume();
                }

                // Setup analyzer for VAD
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.5;

                const source = this.audioCtx.createMediaStreamSource(this.audioStream);
                source.connect(this.analyser);

                // Setup MediaRecorder
                this.mediaRecorder = new MediaRecorder(this.audioStream, {
                    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                        ? 'audio/webm;codecs=opus'
                        : 'audio/ogg'
                });

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0 && this.isRecording) {
                        this.currentRecordingChunks.push(e.data);
                        console.log('[Venzio] Chunk captured:', e.data.size, 'bytes');
                    }
                };

                // Start recording continuously
                this.mediaRecorder.start(CONFIG.recordingChunkSize);
                console.log('[Venzio] MediaRecorder started');

                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
                this._startVAD();

            } catch (err) {
                console.error('[Venzio] Microphone access error:', err);
                this._addMessage('error', '⚠️ No se pudo acceder al micrófono');
                this._setState(STATES.ERROR);
            }
        }

        _stopListening() {
            this._stopVAD();
            
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(t => t.stop());
            }
            
            this.isRecording = false;
            this.currentRecordingChunks = [];
        }

        // ── VAD (Voice Activity Detection) ────────────────────────────────────────
        _startVAD() {
            console.log('[Venzio] VAD started');
            this.vadInterval = setInterval(() => {
                const db = this._getVolumeDB();
                this._processVAD(db);
            }, 50); // Check every 50ms
        }

        _pauseVAD() {
            if (this.vadInterval) {
                clearInterval(this.vadInterval);
                this.vadInterval = null;
            }
            if (this.silenceCheckInterval) {
                clearInterval(this.silenceCheckInterval);
                this.silenceCheckInterval = null;
            }
        }

        _resumeVAD() {
            if (!this.vadInterval && this.state === STATES.LISTENING) {
                this._startVAD();
            }
        }

        _stopVAD() {
            this._pauseVAD();
            this.voiceDetectedTime = null;
            this.lastVoiceTime = null;
        }

        _getVolumeDB() {
            if (!this.analyser) return -100;
            
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const amplitude = dataArray[i] / 255;
                sum += amplitude * amplitude;
            }
            
            const rms = Math.sqrt(sum / bufferLength);
            return 20 * Math.log10(rms || 0.0001);
        }

        _processVAD(db) {
            const now = Date.now();
            
            if (CONFIG.debugVAD && Math.random() < 0.1) {
                console.log('[VAD]', db.toFixed(1), 'dB | State:', this.state);
            }

            // Voice detected
            if (db > CONFIG.vadThreshold) {
                this.lastVoiceTime = now;

                if (this.state === STATES.LISTENING) {
                    if (!this.voiceDetectedTime) {
                        this.voiceDetectedTime = now;
                    } else if (now - this.voiceDetectedTime > CONFIG.vadMinDuration) {
                        this._onVoiceStart();
                    }
                }
                
                // Clear silence checker
                if (this.silenceCheckInterval) {
                    clearInterval(this.silenceCheckInterval);
                    this.silenceCheckInterval = null;
                }
            } 
            // Silence detected
            else {
                if (this.state === STATES.USER_SPEAKING && !this.silenceCheckInterval) {
                    // Start checking for silence timeout
                    this.silenceCheckInterval = setInterval(() => {
                        const silenceDuration = Date.now() - this.lastVoiceTime;
                        if (silenceDuration > CONFIG.vadSilenceTimeout) {
                            this._onVoiceEnd();
                        }
                    }, 100);
                }
            }

            // Max speaking time guard
            if (this.state === STATES.USER_SPEAKING && this.voiceDetectedTime) {
                if (now - this.voiceDetectedTime > CONFIG.vadMaxSpeakingTime) {
                    console.log('[Venzio] Max speaking time reached');
                    this._onVoiceEnd();
                }
            }
        }

        _onVoiceStart() {
            console.log('[Venzio] Voice START detected');

            // Generate unique utterance ID
            this.currentUtteranceId = Date.now().toString();

            // Send audio_start metadata
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'audio_start',
                    id: this.currentUtteranceId
                }));
                console.log('[Venzio] Sent audio_start:', this.currentUtteranceId);
            }

            this.isRecording = true;
            this.currentRecordingChunks = [];

            this._setState(STATES.USER_SPEAKING);
            this._setStatus('🎤 Hablando...');
            this.$micBtn.classList.add('recording');
        }

        _onVoiceEnd() {
            console.log('[Venzio] Voice END detected');
            
            this.isRecording = false;
            this.voiceDetectedTime = null;
            
            if (this.silenceCheckInterval) {
                clearInterval(this.silenceCheckInterval);
                this.silenceCheckInterval = null;
            }

            this.$micBtn.classList.remove('recording');
            this._setState(STATES.PROCESSING);
            this._setStatus('Enviando audio...');

            // Send collected audio
            this._sendRecordedAudio();
        }

        async _sendRecordedAudio() {
            if (this.currentRecordingChunks.length === 0) {
                console.warn('[Venzio] No audio chunks to send');
                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
                return;
            }

            console.log('[Venzio] Sending', this.currentRecordingChunks.length, 'chunks');

            try {
                // Send chunks individually as expected by backend
                for (const chunk of this.currentRecordingChunks) {
                    const arrayBuffer = await chunk.arrayBuffer();
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(arrayBuffer);
                    }
                }

                console.log('[Venzio] Audio chunks sent');

                // Send audio_end metadata after all chunks
                if (this.currentUtteranceId && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'audio_end',
                        id: this.currentUtteranceId
                    }));
                    console.log('[Venzio] Sent audio_end:', this.currentUtteranceId);
                }

            } catch (err) {
                console.error('[Venzio] Error sending audio:', err);
                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
            } finally {
                this.currentRecordingChunks = [];
                this.currentUtteranceId = null; // Clear for next utterance
            }
        }

        // ── End Session ────────────────────────────────────────────────────────────
        _endSession() {
            console.log('[Venzio] Ending session');
            
            this._stopListening();
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'end_session' }));
                this.ws.close();
            }
            
            if (this.currentAudioSource) {
                this.currentAudioSource.stop();
                this.currentAudioSource = null;
            }

            this.sessionActive = false;
            this._setState(STATES.IDLE);
            this._setStatus('Sesión terminada');
        }

        // ── Helpers ────────────────────────────────────────────────────────────────
        _setState(state) {
            console.log('[Venzio] State:', this.state, '→', state);
            this.state = state;
            
            const viz = this.$viz;
            viz.className = 'vz-visualizer';
            if (state === STATES.LISTENING) viz.classList.add('listening');
            if (state === STATES.USER_SPEAKING) viz.classList.add('user_speaking');
            if (state === STATES.PROCESSING) viz.classList.add('processing');
            if (state === STATES.AI_SPEAKING) viz.classList.add('speaking');
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
        if (document.getElementById('vz-widget')) return;
        window.VenzioWidget = new VenzioWidget();
        console.log('[Venzio] Widget initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window, document);