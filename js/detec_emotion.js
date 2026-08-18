export class EmotionController {
    constructor() {
        this.onEmotionChange  = null;
        this.active           = false;
        this.video            = null;
        this.canvases         = {};
        this._faceBox         = null;
        this._landmarks       = null;
        this.showLandmarks    = false;
        this.carouselMode     = false;

        this._renderLoop();
    }

    async startDetection(stream) {
        this.video = document.createElement('video');
        this.video.srcObject = stream;
        this.video.muted     = true;
        this.video.autoplay  = true;
        await this.video.play();
        this.active = true;
        this._detectLoop();
    }

    async _detectLoop() {
        if (!this.active) {
            setTimeout(() => this._detectLoop(), 250);
            return;
        }

        try {
            let detection;
            if (this.showLandmarks) {
                detection = await faceapi
                    .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks(true)
                    .withFaceExpressions();
                if (detection) this._landmarks = detection.landmarks;
            } else {
                detection = await faceapi
                    .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceExpressions();
                this._landmarks = null;
            }

            if (detection) {
                this._faceBox = detection.detection.box;
                if (this.onEmotionChange) {
                    const exp = detection.expressions;
                    const top = Object.keys(exp).reduce((a, b) => exp[a] > exp[b] ? a : b);
                    this.onEmotionChange(top, exp[top]);
                }
            }
        } catch(e) {}

        setTimeout(() => this._detectLoop(), 250);
    }

    _renderLoop() {
        this._drawAll();
        requestAnimationFrame(() => this._renderLoop());
    }

    registerCanvas(id, canvas, videoEl) {
        this.canvases[id] = { canvas, videoEl, ctx: canvas.getContext('2d') };
    }

    _drawAll() {
        for (const [id, { canvas, videoEl, ctx }] of Object.entries(this.canvases)) {
            if (!videoEl || !ctx || videoEl.readyState < 2) continue;
            const w = canvas.width;
            const h = canvas.height;

            ctx.drawImage(videoEl, 0, 0, w, h);

            // Landmarks só no modo IA e se ativo
            if (!this.carouselMode && this.showLandmarks && this._landmarks) {
                this._drawLandmarks(ctx, w, h);
            }
        }
    }

    _drawLandmarks(ctx, w, h) {
        const scaleX = w / (this.video.videoWidth  || w);
        const scaleY = h / (this.video.videoHeight || h);
        const pts    = this._landmarks.positions;

        ctx.save();
        ctx.fillStyle   = 'rgba(0, 255, 200, 0.85)';
        ctx.strokeStyle = 'rgba(0, 255, 200, 0.4)';
        ctx.lineWidth   = 0.8;

        pts.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * scaleX, p.y * scaleY, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        const groups = [
            [0,16], [17,21], [22,26], [27,30],
            [30,35], [36,41], [42,47], [48,59], [60,67]
        ];

        groups.forEach(([start, end]) => {
            ctx.beginPath();
            for (let i = start; i <= end; i++) {
                const p = pts[i];
                i === start
                    ? ctx.moveTo(p.x * scaleX, p.y * scaleY)
                    : ctx.lineTo(p.x * scaleX, p.y * scaleY);
            }
            if ([36,42,48,60].includes(start)) ctx.closePath();
            ctx.stroke();
        });

        ctx.restore();
    }
}