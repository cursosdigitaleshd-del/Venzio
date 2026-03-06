/**
 * Voice Activity Detection Module
 * Detecta inicio y fin de voz usando RMS y timers
 */

import { CONFIG } from './config.js';

class VAD {
    constructor() {
        this.onVoiceStart = null; // callback: () => void
        this.onVoiceEnd = null;   // callback: () => void

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
            // Voice detected
            this.lastVoiceTime = now;

            if (!this.isVoiceActive) {
                if (!this.voiceStartTime) {
                    this.voiceStartTime = now;
                } else if (now - this.voiceStartTime > this.minSpeechMs) {
                    this._triggerVoiceStart();
                }
            }

            // Clear silence timer
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
        } else {
            // Silence
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
        console.log('[VAD] Voice start detected');

        if (this.onVoiceStart) {
            this.onVoiceStart();
        }
    }

    _triggerVoiceEnd() {
        if (!this.isVoiceActive) return;

        this.isVoiceActive = false;
        this.voiceStartTime = null;
        this.lastVoiceTime = null;

        console.log('[VAD] Voice end detected');

        if (this.onVoiceEnd) {
            this.onVoiceEnd();
        }
    }
}

export { VAD };