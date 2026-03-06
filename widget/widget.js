/**
 * Venzio Voice Widget v3.0 - WAV Conversion Edition
 * Compatible con faster-whisper local + ffmpeg/pydub
 * 
 * SOLUCIÓN: Convierte WebM → WAV en browser antes de enviar
 * Esto garantiza que ffmpeg/pydub siempre puedan procesar el audio
 */

(function (window, document) {
    'use strict';

    // ── Config ──────────
    const CONFIG = {
        apiBase: 'https://venzio.online/api',
        wsBase: 'wss://venzio.online',
        agentName: window.VENZIO_NAME || 'Agente Venzio',
        
        // VAD Configuration
        vadThreshold: -40,
        vadMinDuration: 300,
        vadSilenceTimeout: 800,
        vadMaxSpeakingTime: 20000,
        
        // Audio Recording
        recordingChunkSize: 100,
        sampleRate: 16000,  // 16kHz óptimo para Whisper
        
        debug: true,
    };

    const STATES = {
        IDLE: 'idle',
        CONNECTING: 'connecting',
        LISTENING: 'listening',
        USER_SPEAKING: 'user_speaking',
        PROCESSING: 'processing',
        AI_SPEAKING: 'ai_speaking',
        ERROR: 'error',
    };

    // ══════════════════════════════════════════════════════════════════════════
    // WAV Encoder - Convierte Float32Array a WAV
    // ══════════════════════════════════════════════════════════════════════════
    class WAVEncoder {
        constructor(sampleRate = 16000, numChannels = 1) {
            this.sampleRate = sampleRate;
            this.numChannels = numChannels;
        }

        /**
         * Convierte samples Float32Array a WAV ArrayBuffer
         */
        encode(samples) {
            const buffer = new ArrayBuffer(44 + samples.length * 2);
            const view = new DataView(buffer);

            // WAV Header (44 bytes)
            this._writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + samples.length * 2, true);
            this._writeString(view, 8, 'WAVE');
            
            // fmt chunk
            this._writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);           // chunk size
            view.setUint16(20, 1, true);            // PCM format
            view.setUint16(22, this.numChannels, true);
            view.setUint32(24, this.sampleRate, true);
            view.setUint32(28, this.sampleRate * 2 * this.numChannels, true); // byte rate
            view.setUint16(32, this.numChannels * 2, true); // block align
            view.setUint16(34, 16, true);           // bits per sample
            
            // data chunk
            this._writeString(view, 36, 'data');
            view.setUint32(40, samples.length * 2, true);

            // PCM samples (convert Float32 to Int16)
            let offset = 44;
            for (let i = 0; i < samples.length; i++, offset += 2) {
                const s = Math.max(-1, Math.min(1, samples[i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }

            return buffer;
        }

        _writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Audio Processor - Convierte WebM → WAV
    // ══════════════════════════════════════════════════════════════════════════
    class AudioProcessor {
        constructor(sampleRate = 16000) {
            this.sampleRate = sampleRate;
            this.encoder = new WAVEncoder(sampleRate, 1); // Mono
        }

        /**
         * Convierte Blob de audio (WebM/OGG) a WAV
         */
        async convertToWAV(audioBlob) {
            try {
                // 1. Decodificar audio a AudioBuffer
                const arrayBuffer = await audioBlob.arrayBuffer();
                
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.sampleRate
                });
                
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                
                // 2. Extraer samples (mono)
                let samples;
                if (audioBuffer.numberOfChannels === 1) {
                    samples = audioBuffer.getChannelData(0);
                } else {
                    // Mezclar canales a mono
                    const left = audioBuffer.getChannelData(0);
                    const right = audioBuffer.getChannelData(1);
                    samples = new Float32Array(left.length);
                    for (let i = 0; i < left.length; i++) {
                        samples[i] = (left[i] + right[i]) / 2;
                    }
                }
                
                // 3. Codificar a WAV
                const wavBuffer = this.encoder.encode(samples);
                
                if (CONFIG.debug) {
                    console.log('[AudioProcessor] Conversión:', {
                        input: `${audioBlob.size} bytes (${audioBlob.type})`,
                        output: `${wavBuffer.byteLength} bytes (WAV)`,
                        duration: `${audioBuffer.duration.toFixed(2)}s`,
                        sampleRate: `${audioBuffer.sampleRate}Hz`,
                        channels: audioBuffer.numberOfChannels,
                    });
                }
                
                return new Blob([wavBuffer], { type: 'audio/wav' });
                
            } catch (err) {
                console.error('[AudioProcessor] Error:', err);
                throw err;
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Widget Principal
    // ══════════════════════════════════════════════════════════════════════════
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
            this.recordingFormat = null;

            // Audio processor para conversión WAV
            this.audioProcessor = new AudioProcessor(CONFIG.sampleRate);

            this._build();
            this._loadVoices();
        }

        // ── DOM Construction ───────────────────────────────────────────────────
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
              <h3>${CONFIG.agentName}</h3>
              <p><span class="vz-status-dot"></span>En línea</p>
            </div>
          </div>

          <div class="vz-voice-selector" id="vz-voice-selector">
            <label for="vz-voice-select">Voz del agente</label>
            <select id="vz-voice-select">
              <option value="">Cargando voces...</option>
            </select>
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
            <button class="vz-mic-btn" id="vz-mic-btn" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

            this.$trigger = document.getElementById('vz-trigger');
            this.$panel = document.getElementById('vz-panel');
            this.$msgs = document.getElementById('vz-messages');
            this.$micBtn = document.getElementById('vz-mic-btn');
            this.$endBtn = document.getElementById('vz-end-btn');
            this.$status = document.getElementById('vz-status-text');
            this.$viz = document.getElementById('vz-visualizer');
            this.$voiceSel = document.getElementById('vz-voice-select');

            this.$trigger.addEventListener('click', () => this.togglePanel());
            this.$endBtn.addEventListener('click', () => this._endSession());
        }

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
                console.warn('[Venzio] Error cargando voces:', e);
            }
        }

        togglePanel() {
            this.isOpen = !this.isOpen;
            this.$panel.classList.toggle('open', this.isOpen);
            this.$trigger.classList.toggle('active', this.isOpen);
            if (this.isOpen && this.state === STATES.IDLE) {
                this._connectWebSocket();
            }
        }

        async _getTemporalToken() {
            const siteId = window.VENZIO_SITE_ID;
            if (!siteId) throw new Error('VENZIO_SITE_ID no definido');

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
                return;
            }

            const wsUrl = `${CONFIG.wsBase}/ws/public/voice/${this.selectedVoiceId}?token=${token}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[Venzio] WebSocket conectado');
                this.sessionActive = true;
                this._startListening();
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof Blob) {
                    await this._playAudio(event.data);
                } else {
                    const msg = JSON.parse(event.data);
                    this._handleServerMessage(msg);
                }
            };

            this.ws.onerror = () => {
                this._setState(STATES.ERROR);
                this._addMessage('error', '⚠️ Error de conexión');
            };

            this.ws.onclose = () => {
                if (this.sessionActive) {
                    this._addMessage('system', 'Sesión finalizada.');
                    this.sessionActive = false;
                }
                this._stopListening();
                this._setState(STATES.IDLE);
            };
        }

        _handleServerMessage(msg) {
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
                case 'transcript':
                    this._addMessage('user', msg.text);
                    this._setState(STATES.PROCESSING);
                    this._setStatus('Procesando...');
                    break;
                case 'reply_text':
                    this._addMessage('agent', msg.text);
                    break;
                case 'error':
                    this._addMessage('error', `⚠️ ${msg.message}`);
                    this._setState(STATES.LISTENING);
                    this._setStatus('Escuchando...');
                    break;
            }
        }

        async _playAudio(blob) {
            this._pauseVAD();
            this._setState(STATES.AI_SPEAKING);
            this._setStatus('🔊 Respondiendo...');

            try {
                if (!this.audioCtx) {
                    this.audioCtx = new AudioContext();
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
                console.error('[Venzio] Error playback:', err);
                this._setState(STATES.LISTENING);
                this._resumeVAD();
            }
        }

        // ── Recording con MediaRecorder ────────────────────────────────────────
        async _startListening() {
            try {
                this.audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                        sampleRate: CONFIG.sampleRate,
                    }
                });

                this.audioCtx = new AudioContext({ sampleRate: CONFIG.sampleRate });
                if (this.audioCtx.state === 'suspended') {
                    await this.audioCtx.resume();
                }

                // Analyzer para VAD
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.5;

                const source = this.audioCtx.createMediaStreamSource(this.audioStream);
                source.connect(this.analyser);

                // MediaRecorder - usa formato nativo del browser
                const mimeType = this._getBestFormat();
                this.recordingFormat = mimeType;
                
                console.log('[Venzio] MediaRecorder format:', mimeType);

                this.mediaRecorder = new MediaRecorder(this.audioStream, {
                    mimeType: mimeType,
                    audioBitsPerSecond: 128000
                });

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0 && this.isRecording) {
                        this.currentRecordingChunks.push(e.data);
                    }
                };

                this.mediaRecorder.start(CONFIG.recordingChunkSize);

                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
                this._startVAD();

            } catch (err) {
                console.error('[Venzio] Error micrófono:', err);
                this._addMessage('error', '⚠️ No se pudo acceder al micrófono');
                this._setState(STATES.ERROR);
            }
        }

        _getBestFormat() {
            const formats = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/ogg',
            ];

            for (const fmt of formats) {
                if (MediaRecorder.isTypeSupported(fmt)) {
                    return fmt;
                }
            }

            return ''; // Browser default
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

        // ── VAD ────────────────────────────────────────────────────────────────
        _startVAD() {
            this.vadInterval = setInterval(() => {
                const db = this._getVolumeDB();
                this._processVAD(db);
            }, 50);
        }

        _pauseVAD() {
            if (this.vadInterval) clearInterval(this.vadInterval);
            if (this.silenceCheckInterval) clearInterval(this.silenceCheckInterval);
            this.vadInterval = null;
            this.silenceCheckInterval = null;
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
            
            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const amplitude = dataArray[i] / 255;
                sum += amplitude * amplitude;
            }
            
            const rms = Math.sqrt(sum / dataArray.length);
            return 20 * Math.log10(rms || 0.0001);
        }

        _processVAD(db) {
            const now = Date.now();

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
                
                if (this.silenceCheckInterval) {
                    clearInterval(this.silenceCheckInterval);
                    this.silenceCheckInterval = null;
                }
            } 
            // Silence
            else {
                if (this.state === STATES.USER_SPEAKING && !this.silenceCheckInterval) {
                    this.silenceCheckInterval = setInterval(() => {
                        if (Date.now() - this.lastVoiceTime > CONFIG.vadSilenceTimeout) {
                            this._onVoiceEnd();
                        }
                    }, 100);
                }
            }

            // Max speaking time
            if (this.state === STATES.USER_SPEAKING && this.voiceDetectedTime) {
                if (now - this.voiceDetectedTime > CONFIG.vadMaxSpeakingTime) {
                    this._onVoiceEnd();
                }
            }
        }

        _onVoiceStart() {
            if (this.isRecording) return;
            
            this.isRecording = true;
            this.currentRecordingChunks = [];
            this._setState(STATES.USER_SPEAKING);
            this._setStatus('🎤 Hablando...');
            this.$micBtn.classList.add('recording');
        }

        _onVoiceEnd() {
            if (!this.isRecording) return;
            
            this.isRecording = false;
            this.voiceDetectedTime = null;
            
            if (this.silenceCheckInterval) {
                clearInterval(this.silenceCheckInterval);
                this.silenceCheckInterval = null;
            }

            this.$micBtn.classList.remove('recording');
            this._setState(STATES.PROCESSING);
            this._setStatus('Convirtiendo audio...');

            this._sendRecordedAudio();
        }

        // ── CONVERSIÓN A WAV Y ENVÍO ───────────────────────────────────────────
        async _sendRecordedAudio() {
            if (this.currentRecordingChunks.length === 0) {
                console.warn('[Venzio] No hay chunks para enviar');
                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
                return;
            }

            try {
                // 1. Crear blob original (WebM/OGG)
                const originalBlob = new Blob(
                    this.currentRecordingChunks,
                    { type: this.recordingFormat }
                );
                
                console.log('[Venzio] Audio original:', {
                    format: originalBlob.type,
                    size: `${(originalBlob.size / 1024).toFixed(1)} KB`,
                    chunks: this.currentRecordingChunks.length
                });

                // 2. ⭐ CONVERTIR A WAV
                const wavBlob = await this.audioProcessor.convertToWAV(originalBlob);
                
                console.log('[Venzio] ✓ Convertido a WAV:', {
                    size: `${(wavBlob.size / 1024).toFixed(1)} KB`,
                    ratio: `${(wavBlob.size / originalBlob.size).toFixed(1)}x`
                });

                // 3. Enviar WAV al backend
                const arrayBuffer = await wavBlob.arrayBuffer();
                
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(arrayBuffer);
                    console.log('[Venzio] ✓ WAV enviado');
                    this._setStatus('Transcribiendo...');
                } else {
                    console.error('[Venzio] WebSocket cerrado');
                    this._setState(STATES.LISTENING);
                    this._setStatus('Escuchando...');
                }

            } catch (err) {
                console.error('[Venzio] Error conversión/envío:', err);
                this._addMessage('error', '⚠️ Error procesando audio');
                this._setState(STATES.LISTENING);
                this._setStatus('Escuchando...');
            } finally {
                this.currentRecordingChunks = [];
            }
        }

        _endSession() {
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

        _setState(state) {
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

    // ── Auto-init ──────────────────────────────────────────────────────────────
    function init() {
        if (document.getElementById('vz-widget')) return;
        window.VenzioWidget = new VenzioWidget();
        console.log('[Venzio] Widget v3.0 - WAV conversion enabled');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window, document);