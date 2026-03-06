/**
 * Audio Player Module
 * Reproduce audio de respuesta del agente
 */

import { CONFIG } from './config.js';

class AudioPlayer {
    constructor() {
        this.audioContext = null;
        this.currentSource = null;
        this.isPlaying = false;
        this.onEnd = null; // callback: () => void
    }

    async play(audioBuffer) {
        if (this.isPlaying) {
            this.stop();
        }

        try {
            if (!this.audioContext) {
                this.audioContext = new AudioContext({ sampleRate: CONFIG.audio.sampleRate });
                if (this.audioContext.state === 'suspended') {
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
                console.log('[Player] Playback ended');
                if (this.onEnd) this.onEnd();
            };

            this.currentSource.start(0);
            this.isPlaying = true;

            console.log(`[Player] Started playback: ${(audioBufferDecoded.duration).toFixed(2)}s`);

        } catch (error) {
            console.error('[Player] Error playing audio:', error);
            this.isPlaying = false;
        }
    }

    stop() {
        if (this.currentSource && this.isPlaying) {
            try {
                this.currentSource.stop();
                console.log('[Player] Playback stopped');
            } catch (error) {
                console.error('[Player] Error stopping playback:', error);
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
}

export { AudioPlayer };