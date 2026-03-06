/**
 * Audio Capture Module
 * Captura audio continuamente del micrófono usando AudioWorklet
 */

import { CONFIG } from './config.js';

class AudioCapture {
    constructor() {
        this.audioContext = null;
        this.audioStream = null;
        this.workletNode = null;
        this.isCapturing = false;
        this.onAudioFrame = null; // callback: (samples: Float32Array) => void
    }

    async start() {
        if (this.isCapturing) return;

        try {
            // Get microphone access
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: CONFIG.audio.channels,
                    sampleRate: CONFIG.audio.sampleRate,
                }
            });

            // Create AudioContext
            this.audioContext = new AudioContext({ sampleRate: CONFIG.audio.sampleRate });
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // Load AudioWorklet
            await this.audioContext.audioWorklet.addModule(this._createWorkletUrl());

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');

            // Handle messages from worklet
            this.workletNode.port.onmessage = (event) => {
                if (this.onAudioFrame && event.data.samples) {
                    this.onAudioFrame(event.data.samples);
                }
            };

            // Connect microphone to worklet
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            source.connect(this.workletNode);

            // Connect worklet to destination (silent)
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0;
            this.workletNode.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            this.isCapturing = true;
            console.log('[AudioCapture] Started');

        } catch (error) {
            console.error('[AudioCapture] Error starting:', error);
            throw error;
        }
    }

    stop() {
        if (!this.isCapturing) return;

        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
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
        console.log('[AudioCapture] Stopped');
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

        const blob = new Blob([workletCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }
}

export { AudioCapture };