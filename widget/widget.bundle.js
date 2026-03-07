var VenzioWidget = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // widget.js
  var widget_exports = {};
  __export(widget_exports, {
    VenzioWidget: () => VenzioWidget
  });

  // config.js
  var CONFIG = {
    // Audio settings
    audio: {
      sampleRate: 16e3,
      channels: 1,
      bitDepth: 16
    },
    // VAD settings
    vad: {
      threshold: 0.01,
      minSpeechMs: 200,
      silenceMs: 700
    },
    // Prebuffer settings
    prebuffer: {
      durationMs: 300
    },
    // Recording settings
    recording: {
      maxRecordingMs: 15e3
    },
    // WebSocket settings
    websocket: {
      maxAttempts: 3,
      delayMs: 2e3
    },
    // API settings
    api: {
      baseUrl: "https://venzio.online",
      wsBaseUrl: "wss://venzio.online"
    }
  };

  // audio_capture.js
  var AudioCapture = class {
    constructor() {
      this.audioContext = null;
      this.audioStream = null;
      this.workletNode = null;
      this.isCapturing = false;
      this.onAudioFrame = null;
    }
    async start() {
      console.log("[Venzio][DEBUG] starting audio capture");
      if (this.isCapturing) return;
      try {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: CONFIG.audio.channels,
            sampleRate: CONFIG.audio.sampleRate
          }
        });
        this.audioContext = new AudioContext({ sampleRate: CONFIG.audio.sampleRate });
        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume();
        }
        await this.audioContext.audioWorklet.addModule(this._createWorkletUrl());
        this.workletNode = new AudioWorkletNode(this.audioContext, "audio-capture-processor");
        this.workletNode.port.onmessage = (event) => {
          if (this.onAudioFrame && event.data.samples) {
            this.onAudioFrame(event.data.samples);
          }
        };
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        source.connect(this.workletNode);
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0;
        this.workletNode.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        this.isCapturing = true;
        console.log("[AudioCapture] Started");
      } catch (error) {
        console.error("[AudioCapture] Error starting:", error);
        throw error;
      }
    }
    stop() {
      if (!this.isCapturing) return;
      if (this.audioStream) {
        this.audioStream.getTracks().forEach((track) => track.stop());
      }
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      this.isCapturing = false;
      console.log("[AudioCapture] Stopped");
    }
    _createWorkletUrl() {
      const workletCode = `
            class AudioCaptureProcessor extends AudioWorkletProcessor {
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input && input[0]) {
                        const samples = input[0];
                        this.port.postMessage({
                            samples: new Float32Array(samples)
                        });
                    }
                    return true;
                }
            }

            registerProcessor('audio-capture-processor', AudioCaptureProcessor);
        `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      return URL.createObjectURL(blob);
    }
  };

  // vad.js
  var VAD = class {
    constructor() {
      this.onVoiceStart = null;
      this.onVoiceEnd = null;
      this.isVoiceActive = false;
      this.voiceStartTime = null;
      this.lastVoiceTime = null;
      this.silenceTimer = null;
      this.threshold = CONFIG.vad.threshold;
      this.minSpeechMs = CONFIG.vad.minSpeechMs;
      this.silenceMs = CONFIG.vad.silenceMs;
    }
    processAudioFrame(samples) {
      const rms = this._calculateRMS(samples);
      const now = Date.now();
      if (rms > this.threshold) {
        this.lastVoiceTime = now;
        if (!this.isVoiceActive) {
          if (!this.voiceStartTime) {
            this.voiceStartTime = now;
          } else if (now - this.voiceStartTime > this.minSpeechMs) {
            this._triggerVoiceStart();
          }
        }
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        if (this.isVoiceActive && !this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this._triggerVoiceEnd();
          }, this.silenceMs);
        }
      }
    }
    reset() {
      this.isVoiceActive = false;
      this.voiceStartTime = null;
      this.lastVoiceTime = null;
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    }
    _calculateRMS(samples) {
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }
      return Math.sqrt(sum / samples.length);
    }
    _triggerVoiceStart() {
      if (this.isVoiceActive) return;
      this.isVoiceActive = true;
      console.log("[VAD] Voice start detected");
      if (this.onVoiceStart) {
        this.onVoiceStart();
      }
    }
    _triggerVoiceEnd() {
      if (!this.isVoiceActive) return;
      this.isVoiceActive = false;
      this.voiceStartTime = null;
      this.lastVoiceTime = null;
      console.log("[VAD] Voice end detected");
      if (this.onVoiceEnd) {
        this.onVoiceEnd();
      }
    }
  };

  // recorder.js
  var WAVEncoder = class {
    constructor(sampleRate = 16e3, numChannels = 1) {
      this.sampleRate = sampleRate;
      this.numChannels = numChannels;
    }
    encode(samples) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      this._writeString(view, 0, "RIFF");
      view.setUint32(4, 36 + samples.length * 2, true);
      this._writeString(view, 8, "WAVE");
      this._writeString(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, this.numChannels, true);
      view.setUint32(24, this.sampleRate, true);
      view.setUint32(28, this.sampleRate * 2 * this.numChannels, true);
      view.setUint16(32, this.numChannels * 2, true);
      view.setUint16(34, 16, true);
      this._writeString(view, 36, "data");
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
      }
      return buffer;
    }
    _writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
  };
  var CircularBuffer = class {
    constructor(size) {
      this.buffer = new Float32Array(size);
      this.size = size;
      this.writeIndex = 0;
      this.isFull = false;
    }
    push(sample) {
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.size;
      if (this.writeIndex === 0) {
        this.isFull = true;
      }
    }
    getContents() {
      if (!this.isFull) {
        return this.buffer.slice(0, this.writeIndex);
      }
      const result = new Float32Array(this.size);
      const firstPart = this.buffer.slice(this.writeIndex);
      const secondPart = this.buffer.slice(0, this.writeIndex);
      result.set(firstPart);
      result.set(secondPart, firstPart.length);
      return result;
    }
  };
  var Recorder = class {
    constructor() {
      this.onAudioReady = null;
      this.wavEncoder = new WAVEncoder(CONFIG.audio.sampleRate, CONFIG.audio.channels);
      const prebufferSamples = Math.floor(CONFIG.audio.sampleRate * CONFIG.prebuffer.durationMs / 1e3);
      this.prebuffer = new CircularBuffer(prebufferSamples);
      this.recordingBuffer = [];
      this.isRecording = false;
      this.maxRecordingSamples = Math.floor(CONFIG.audio.sampleRate * CONFIG.recording.maxRecordingMs / 1e3);
    }
    processAudioFrame(samples) {
      for (let i = 0; i < samples.length; i++) {
        this.prebuffer.push(samples[i]);
      }
      if (this.isRecording) {
        for (let i = 0; i < samples.length; i++) {
          this.recordingBuffer.push(samples[i]);
          if (this.recordingBuffer.length >= this.maxRecordingSamples) {
            this.stopRecording();
            break;
          }
        }
      }
    }
    startRecording() {
      if (this.isRecording) return;
      console.log("[Recorder] Start recording");
      const prebufferContents = this.prebuffer.getContents();
      this.recordingBuffer = Array.from(prebufferContents);
      this.isRecording = true;
    }
    stopRecording() {
      if (!this.isRecording) return;
      console.log("[Recorder] Stop recording");
      this.isRecording = false;
      if (this.recordingBuffer.length === 0) {
        console.log("[Recorder] No audio to process");
        return;
      }
      const samples = new Float32Array(this.recordingBuffer);
      const wavBuffer = this.wavEncoder.encode(samples);
      console.log(`[Recorder] Generated WAV: ${samples.length} samples, ${(samples.length / CONFIG.audio.sampleRate).toFixed(2)}s`);
      if (this.onAudioReady) {
        this.onAudioReady(wavBuffer);
      }
      this.recordingBuffer = [];
    }
    reset() {
      this.recordingBuffer = [];
      this.isRecording = false;
    }
  };

  // websocket.js
  var WebSocketClient = class {
    constructor() {
      this.ws = null;
      this.isConnected = false;
      this.onTranscript = null;
      this.onReply = null;
      this.onAudio = null;
      this.onError = null;
      this.onConnected = null;
      this.onDisconnected = null;
    }
    async connect(voiceId, token) {
      if (this.isConnected) return;
      try {
        const wsUrl = `${CONFIG.api.wsBaseUrl}/ws/public/voice/${voiceId}?token=${token}`;
        this.ws = new WebSocket(wsUrl);
        return new Promise((resolve, reject) => {
          this.ws.onopen = () => {
            console.log("[WebSocket] Connected");
            this.isConnected = true;
            if (this.onConnected) this.onConnected();
            resolve();
          };
          this.ws.onmessage = (event) => {
            this._handleMessage(event);
          };
          this.ws.onerror = (error) => {
            console.error("[WebSocket] Error:", error);
            if (this.onError) this.onError("Connection error");
            reject(error);
          };
          this.ws.onclose = () => {
            console.log("[WebSocket] Disconnected");
            this.isConnected = false;
            if (this.onDisconnected) this.onDisconnected();
          };
        });
      } catch (error) {
        console.error("[WebSocket] Connection failed:", error);
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
        console.error("[WebSocket] Not connected");
        return;
      }
      try {
        console.log(`[WebSocket] Sending audio: ${audioBuffer.byteLength} bytes`);
        this.ws.send(audioBuffer);
      } catch (error) {
        console.error("[WebSocket] Error sending audio:", error);
        if (this.onError) this.onError("Error sending audio");
      }
    }
    sendEndSession() {
      if (!this.isConnected || !this.ws) return;
      try {
        this.ws.send(JSON.stringify({ type: "end_session" }));
      } catch (error) {
        console.error("[WebSocket] Error sending end_session:", error);
      }
    }
    _handleMessage(event) {
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((audioBuffer) => {
          console.log(`[WebSocket] Received audio: ${audioBuffer.byteLength} bytes`);
          if (this.onAudio) this.onAudio(audioBuffer);
        });
      } else {
        try {
          const msg = JSON.parse(event.data);
          this._handleTextMessage(msg);
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      }
    }
    _handleTextMessage(msg) {
      switch (msg.type) {
        case "session_ready":
          console.log("[WebSocket] Session ready:", msg.voice);
          break;
        case "final_transcript":
          console.log("[WebSocket] Transcript:", msg.text);
          if (this.onTranscript) this.onTranscript(msg.text);
          break;
        case "reply_text":
          console.log("[WebSocket] Reply:", msg.text);
          if (this.onReply) this.onReply(msg.text);
          break;
        case "error":
          console.error("[WebSocket] Error:", msg.message);
          if (this.onError) this.onError(msg.message);
          break;
        default:
          console.log("[WebSocket] Unknown message type:", msg.type);
      }
    }
  };

  // player.js
  var AudioPlayer = class {
    constructor() {
      this.audioContext = null;
      this.currentSource = null;
      this.isPlaying = false;
      this.onEnd = null;
    }
    async play(audioBuffer) {
      if (this.isPlaying) {
        this.stop();
      }
      try {
        if (!this.audioContext) {
          this.audioContext = new AudioContext({ sampleRate: CONFIG.audio.sampleRate });
          if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
          }
        }
        const audioBufferDecoded = await this.audioContext.decodeAudioData(audioBuffer.slice());
        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = audioBufferDecoded;
        this.currentSource.connect(this.audioContext.destination);
        this.currentSource.onended = () => {
          this.isPlaying = false;
          this.currentSource = null;
          console.log("[Player] Playback ended");
          if (this.onEnd) this.onEnd();
        };
        this.currentSource.start(0);
        this.isPlaying = true;
        console.log(`[Player] Started playback: ${audioBufferDecoded.duration.toFixed(2)}s`);
      } catch (error) {
        console.error("[Player] Error playing audio:", error);
        this.isPlaying = false;
      }
    }
    stop() {
      if (this.currentSource && this.isPlaying) {
        try {
          this.currentSource.stop();
          console.log("[Player] Playback stopped");
        } catch (error) {
          console.error("[Player] Error stopping playback:", error);
        }
      }
      this.currentSource = null;
      this.isPlaying = false;
    }
    destroy() {
      this.stop();
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
    }
  };

  // widget.js
  var STATES = {
    IDLE: "idle",
    CONNECTING: "connecting",
    LISTENING: "listening",
    RECORDING: "recording",
    PROCESSING: "processing",
    PLAYING: "playing",
    ERROR: "error"
  };
  var VenzioWidget = class {
    constructor(options = {}) {
      console.log("[Venzio][DEBUG] widget constructor called");
      if (!options.siteId || !options.voiceId || !options.token) {
        throw new Error("siteId, voiceId y token son requeridos");
      }
      this.options = {
        apiBase: options.apiBase || CONFIG.api.baseUrl,
        agentName: options.agentName || "Agente Venzio",
        siteId: options.siteId,
        voiceId: options.voiceId,
        token: options.token,
        ...options
      };
      this.state = STATES.IDLE;
      this.audioCapture = new AudioCapture();
      this.vad = new VAD();
      this.recorder = new Recorder();
      this.wsClient = new WebSocketClient();
      this.player = new AudioPlayer();
      this._setupEventHandlers();
      this.elements = {};
      this.isOpen = false;
      this._buildUI();
    }
    // ── State Management ──────────────────────────────────────────────────────
    _setState(newState) {
      console.log(`[Widget] State: ${this.state} \u2192 ${newState}`);
      this.state = newState;
      this._updateUI();
    }
    // ── Module Event Handlers ─────────────────────────────────────────────────
    _setupEventHandlers() {
      this.audioCapture.onAudioFrame = (samples) => {
        this.vad.processAudioFrame(samples);
        this.recorder.processAudioFrame(samples);
      };
      this.vad.onVoiceStart = () => {
        console.log("[Venzio][DEBUG] VAD voice start detected");
        console.log("[Venzio][DEBUG] current state:", this.state);
        if (this.state === STATES.PLAYING) {
          if (this.playingStartedAt && Date.now() - this.playingStartedAt < 150) {
            console.log("[Venzio][DEBUG] voice ignored (anti-echo protection)");
            return;
          }
          console.log("[Venzio][DEBUG] barge-in triggered");
          console.log("[Venzio][DEBUG] stopping player");
          this.player.stop();
          this.recorder.startRecording();
          this._setState(STATES.RECORDING);
          return;
        }
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
      this.recorder.onAudioReady = (wavBuffer) => {
        this.wsClient.sendAudio(wavBuffer);
      };
      this.wsClient.onConnected = () => {
        this._startAudioPipeline();
        this._setState(STATES.LISTENING);
      };
      this.wsClient.onDisconnected = () => {
        this._stopAudioPipeline();
        this._setState(STATES.IDLE);
      };
      this.wsClient.onTranscript = (text) => {
        this._addMessage("user", text);
      };
      this.wsClient.onReply = (text) => {
        this._addMessage("agent", text);
      };
      this.wsClient.onAudio = (audioBuffer) => {
        this.playingStartedAt = Date.now();
        this.player.play(audioBuffer);
        this._setState(STATES.PLAYING);
      };
      this.wsClient.onError = (message) => {
        this._addMessage("error", message);
        this._setState(STATES.ERROR);
      };
      this.player.onEnd = () => {
        this._setState(STATES.LISTENING);
      };
    }
    // ── Audio Pipeline Control ────────────────────────────────────────────────
    async _startAudioPipeline() {
      try {
        await this.audioCapture.start();
        console.log("[Widget] Audio pipeline started");
      } catch (error) {
        console.error("[Widget] Failed to start audio pipeline:", error);
        this._setState(STATES.ERROR);
      }
    }
    _stopAudioPipeline() {
      this.audioCapture.stop();
      this.vad.reset();
      this.recorder.reset();
      console.log("[Widget] Audio pipeline stopped");
    }
    // ── WebSocket Connection ──────────────────────────────────────────────────
    async _connectWebSocket() {
      if (!this.options.voiceId || !this.options.token) {
        this._addMessage("error", "Configuraci\xF3n incompleta");
        return;
      }
      this._setState(STATES.CONNECTING);
      try {
        await this.wsClient.connect(this.options.voiceId, this.options.token);
      } catch (error) {
        console.error("[Widget] Connection failed:", error);
        this._setState(STATES.ERROR);
      }
    }
    // ── UI Management ────────────────────────────────────────────────────────
    _buildUI() {
      console.log("[Venzio][DEBUG] building UI");
      if (!document.getElementById("vz-styles")) {
        const link = document.createElement("link");
        link.id = "vz-styles";
        link.rel = "stylesheet";
        link.href = `${this.options.apiBase.replace("/api", "")}/widget/widget.css`;
        document.head.appendChild(link);
      }
      const wrapper = document.createElement("div");
      wrapper.className = "vz-widget";
      wrapper.id = "vz-widget";
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
                        <p><span class="vz-status-dot"></span>En l\xEDnea</p>
                    </div>
                </div>

                <div class="vz-messages" id="vz-messages">
                    <div class="vz-msg agent">
                        \u{1F44B} \xA1Hola! Soy tu agente de ventas virtual. Te escucho autom\xE1ticamente.
                    </div>
                </div>

                <div class="vz-visualizer" id="vz-visualizer">
                    ${Array.from({ length: 10 }, () => '<div class="vz-bar"></div>').join("")}
                </div>

                <div class="vz-controls">
                    <div class="vz-status-text" id="vz-status-text">
                        <span>Listo</span> \u2014 Abre el panel para conectar
                    </div>
                    <button class="vz-end-btn" id="vz-end-btn">Terminar</button>
                </div>
            </div>
        `;
      document.body.appendChild(wrapper);
      this.elements.trigger = document.getElementById("vz-trigger");
      this.elements.panel = document.getElementById("vz-panel");
      this.elements.messages = document.getElementById("vz-messages");
      this.elements.status = document.getElementById("vz-status-text");
      this.elements.endBtn = document.getElementById("vz-end-btn");
      this.elements.visualizer = document.getElementById("vz-visualizer");
      this.elements.trigger.addEventListener("click", () => this.togglePanel());
      this.elements.endBtn.addEventListener("click", () => this.endSession());
    }
    togglePanel() {
      this.isOpen = !this.isOpen;
      this.elements.panel.classList.toggle("open", this.isOpen);
      this.elements.trigger.classList.toggle("active", this.isOpen);
      if (this.isOpen && this.state === STATES.IDLE) {
        this._connectWebSocket();
      }
    }
    _updateUI() {
      const viz = this.elements.visualizer;
      viz.className = "vz-visualizer";
      switch (this.state) {
        case STATES.LISTENING:
          viz.classList.add("listening");
          this._setStatus("Escuchando...");
          break;
        case STATES.RECORDING:
          viz.classList.add("user_speaking");
          this._setStatus("Hablando...");
          break;
        case STATES.PROCESSING:
          viz.classList.add("processing");
          this._setStatus("Procesando...");
          break;
        case STATES.PLAYING:
          viz.classList.add("speaking");
          this._setStatus("Respondiendo...");
          break;
        case STATES.CONNECTING:
          this._setStatus("Conectando...");
          break;
        case STATES.ERROR:
          this._setStatus("Error");
          break;
        default:
          this._setStatus("Listo");
      }
    }
    _setStatus(text) {
      this.elements.status.innerHTML = `<span>${text}</span>`;
    }
    _addMessage(type, text) {
      const div = document.createElement("div");
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
      this._setStatus("Sesi\xF3n terminada");
    }
    destroy() {
      this.endSession();
      if (this.elements.trigger) {
        this.elements.trigger.remove();
      }
    }
  };
  if (typeof window !== "undefined") {
    window.VenzioWidget = VenzioWidget;
  }
  return __toCommonJS(widget_exports);
})();
