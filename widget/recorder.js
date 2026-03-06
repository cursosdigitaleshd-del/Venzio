/**
 * Audio Recorder Module
 * Gestiona grabación de frases con prebuffer circular y WAV encoder
 */

import { CONFIG } from './config.js';

class WAVEncoder {
    constructor(sampleRate = 16000, numChannels = 1) {
        this.sampleRate = sampleRate;
        this.numChannels = numChannels;
    }

    encode(samples) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        // WAV Header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        this._writeString(view, 8, 'WAVE');

        // fmt chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, this.numChannels, true);
        view.setUint32(24, this.sampleRate, true);
        view.setUint32(28, this.sampleRate * 2 * this.numChannels, true);
        view.setUint16(32, this.numChannels * 2, true);
        view.setUint16(34, 16, true);

        // data chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // PCM samples
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

class CircularBuffer {
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
}

class Recorder {
    constructor() {
        this.onAudioReady = null; // callback: (wavBuffer: ArrayBuffer) => void

        this.wavEncoder = new WAVEncoder(CONFIG.audio.sampleRate, CONFIG.audio.channels);

        // Prebuffer: 300ms at 16kHz = 4800 samples
        const prebufferSamples = Math.floor(CONFIG.audio.sampleRate * CONFIG.prebuffer.durationMs / 1000);
        this.prebuffer = new CircularBuffer(prebufferSamples);

        this.recordingBuffer = [];
        this.isRecording = false;

        this.maxRecordingSamples = Math.floor(CONFIG.audio.sampleRate * CONFIG.recording.maxRecordingMs / 1000);
    }

    processAudioFrame(samples) {
        // Always add to prebuffer
        for (let i = 0; i < samples.length; i++) {
            this.prebuffer.push(samples[i]);
        }

        // Add to recording buffer if recording
        if (this.isRecording) {
            for (let i = 0; i < samples.length; i++) {
                this.recordingBuffer.push(samples[i]);

                // Check max recording time
                if (this.recordingBuffer.length >= this.maxRecordingSamples) {
                    this.stopRecording();
                    break;
                }
            }
        }
    }

    startRecording() {
        if (this.isRecording) return;

        console.log('[Recorder] Start recording');

        // Copy prebuffer to recording buffer
        const prebufferContents = this.prebuffer.getContents();
        this.recordingBuffer = Array.from(prebufferContents);

        this.isRecording = true;
    }

    stopRecording() {
        if (!this.isRecording) return;

        console.log('[Recorder] Stop recording');

        this.isRecording = false;

        if (this.recordingBuffer.length === 0) {
            console.log('[Recorder] No audio to process');
            return;
        }

        // Generate WAV
        const samples = new Float32Array(this.recordingBuffer);
        const wavBuffer = this.wavEncoder.encode(samples);

        console.log(`[Recorder] Generated WAV: ${samples.length} samples, ${(samples.length / CONFIG.audio.sampleRate).toFixed(2)}s`);

        // Emit event
        if (this.onAudioReady) {
            this.onAudioReady(wavBuffer);
        }

        // Reset
        this.recordingBuffer = [];
    }

    reset() {
        this.recordingBuffer = [];
        this.isRecording = false;
    }
}

export { Recorder };