export class HologramController {
    constructor() {
        // Busca canvas (substituíram os videos) ou videos se ainda existirem
        this._faceIds = ['videoBottom', 'videoLeft', 'videoTop', 'videoRight'];

        // Tradução das emoções para português
        this.emotionPT = {
            happy:     'FELIZ',
            sad:       'TRISTE',
            angry:     'RAIVA',
            surprised: 'SURPRESO',
            fearful:   'MEDO',
            disgusted: 'NOJO',
            neutral:   'NEUTRO'
        };

        this.filters = {
            happy:     { css: 'saturate(2) brightness(1.2) sepia(0.2)',          color: '#FFD700' },
            sad:       { css: 'hue-rotate(180deg) saturate(0.5) brightness(0.8)', color: '#4A90D9' },
            angry:     { css: 'hue-rotate(320deg) saturate(3) contrast(1.5)',     color: '#FF3B30' },
            surprised: { css: 'brightness(1.5) saturate(1.5)',                    color: '#FF9F0A' },
            fearful:   { css: 'hue-rotate(260deg) saturate(2) brightness(0.9)',   color: '#BF5AF2' },
            disgusted: { css: 'hue-rotate(90deg) saturate(2) contrast(1.2)',      color: '#34C759' },
            neutral:   { css: 'none',                                             color: '#8E8E93' }
        };

        this.carouselMode  = false;
        this.emotionQueue  = ['happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted', 'neutral'];
        this.queueOffset   = 0;
        this._onCarouselChange = null;
    }

    // Retorna os elementos de face (canvas ou video)
    _getEls() {
        return this._faceIds.map(id =>
            document.getElementById(id + '_canvas') || document.getElementById(id)
        );
    }

    // ── Modo IA ───────────────────────────────────────────────────────────────
    applyEmotionFilter(emotion, confidence) {
        if (this.carouselMode) return;
        const f = this.filters[emotion] || this.filters.neutral;
        this._getEls().forEach(el => {
            if (el) { el.style.filter = f.css; el.style.opacity = 0.5 + confidence * 0.5; }
        });
    }

    // Alias para quando main.js chama com canvases
    applyEmotionFilterToCanvases(emotion, confidence) {
        this.applyEmotionFilter(emotion, confidence);
    }

    // ── Modo Carrossel ────────────────────────────────────────────────────────
    enableCarousel() {
        this.carouselMode = true;
        this._applyCarouselFrame();
    }

    disableCarousel() {
        this.carouselMode = false;
        this._getEls().forEach(el => {
            if (el) { el.style.filter = 'none'; el.style.opacity = 1; }
        });
    }

    rotateCarousel(direction) {
        if (!this.carouselMode) return;
        const len = this.emotionQueue.length;
        const prev = this.queueOffset;
        this.queueOffset = ((this.queueOffset + direction) % len + len) % len;

        const inEmotion  = direction > 0
            ? this.emotionQueue[(this.queueOffset + 3) % len]
            : this.emotionQueue[this.queueOffset];
        const outEmotion = direction > 0
            ? this.emotionQueue[prev % len]
            : this.emotionQueue[(prev + 3) % len];

        this._applyCarouselFrame(direction, inEmotion, outEmotion);
        return { inEmotion, outEmotion, direction };
    }

    _applyCarouselFrame(direction = 0, inEmotion = null, outEmotion = null) {
        const len  = this.emotionQueue.length;
        const els  = this._getEls();
        const faceEmotions = this._faceIds.map((id, i) => {
            const em = this.emotionQueue[(this.queueOffset + i) % len];
            return {
                face:    id,
                emotion: em,
                label:   this.emotionPT[em] || em.toUpperCase(),
                color:   (this.filters[em] || this.filters.neutral).color
            };
        });

        faceEmotions.forEach(({ emotion }, i) => {
            const el = els[i];
            if (!el) return;
            const f = this.filters[emotion] || this.filters.neutral;
            el.style.filter  = f.css;
            el.style.opacity = 1;
        });

        if (this._onCarouselChange) {
            this._onCarouselChange(faceEmotions, inEmotion, outEmotion, direction);
        }
    }

    getCurrentFaceEmotions() {
        const len = this.emotionQueue.length;
        return this._faceIds.map((id, i) => {
            const em = this.emotionQueue[(this.queueOffset + i) % len];
            return {
                face:    id,
                emotion: em,
                label:   this.emotionPT[em] || em.toUpperCase(),
                color:   (this.filters[em] || this.filters.neutral).color
            };
        });
    }

    getEmotionLabel(emotion) {
        return this.emotionPT[emotion] || emotion.toUpperCase();
    }

    getFilterColor(emotion) {
        return (this.filters[emotion] || this.filters.neutral).color;
    }
}