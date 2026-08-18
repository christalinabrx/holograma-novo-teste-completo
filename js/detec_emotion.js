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
        
        // ── Segmentação da pessoa ─────────────────────────────
        this.segmentation = null;
        this.segmentationReady = false;
        this.segmentationMask = null;

        // Canvas invisível usado para processar a imagem
        this.processingCanvas = document.createElement('canvas');
        this.processingCtx = this.processingCanvas.getContext('2d');
        
        this._renderLoop();
    }
    // ─────────────────────────────────────────────────────────
    // INICIALIZA A SEGMENTAÇÃO
    // ─────────────────────────────────────────────────────────
    async initSegmentation() {
        this.segmentation = new SelfieSegmentation({
             locateFile: (file) => {
             return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
        }
    });

        this.segmentation.setOptions({
            modelSelection: 1
    });

    this.segmentation.onResults((results) => {
        this.segmentationMask = results.segmentationMask;
        this.segmentationReady = true;
    });
}
    // ─────────────────────────────────────────────────────────
    // INICIA A CÂMERA
    // ─────────────────────────────────────────────────────────
    async startDetection(stream) {
        this.video = document.createElement('video');
        this.video.srcObject = stream;
        this.video.muted     = true;
        this.video.autoplay  = true;
        await this.video.play();
        this.active = true;
        this._segmentationLoop();
        this._detectLoop();
    }
    // ─────────────────────────────────────────────────────────
    // LOOP DA SEGMENTAÇÃO
    // ─────────────────────────────────────────────────────────
    async _segmentationLoop() {
    if (!this.active) {
        return;
    }

    try {
        if (
            this.segmentation &&
            this.video &&
            this.video.readyState >= 2
        ) {
            await this.segmentation.send({
                image: this.video
            });
        }
    } catch (e) {
        console.error('Erro na segmentação:', e);
    }

    setTimeout(() => this._segmentationLoop(), 50);
}
     // ─────────────────────────────────────────────────────────
    // LOOP DA DETECÇÃO FACIAL
    // ─────────────────────────────────────────────────────────  
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
        } catch(e) {
            console.error('Erro na detecção facial:', e);
        }

        setTimeout(() => this._detectLoop(), 250);
    }

   // ─────────────────────────────────────────────────────────
    // LOOP VISUAL
    // ─────────────────────────────────────────────────────────
    
    _renderLoop() {
        this._drawAll();
        requestAnimationFrame(() => this._renderLoop());
    }
    
 // ─────────────────────────────────────────────────────────
    // REGISTRA OS CANVAS
    // ─────────────────────────────────────────────────────────
    
    registerCanvas(id, canvas, videoEl) {
        this.canvases[id] = { canvas, videoEl, ctx: canvas.getContext('2d') };
    }
    
// ─────────────────────────────────────────────────────────
    // DESENHA AS QUATRO FACES
    // ─────────────────────────────────────────────────────────
    
    _drawAll() {
        for (const [id, { canvas, videoEl, ctx }] of Object.entries(this.canvases)) {
            if (!videoEl || !ctx || videoEl.readyState < 2) continue;
            const w = canvas.width;
            const h = canvas.height;

            this._drawPersonOnly(ctx, w, h);

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

     // ─────────────────────────────────────────────────────────
    // DESENHA SOMENTE A PESSOA
    // ─────────────────────────────────────────────────────────
    
    _drawPersonOnly(ctx, w, h) {
    // Fundo preto
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Se ainda não temos uma máscara,
    // não desenhamos a câmera.
    if (!this.segmentationMask) {
        return;
    }

    // Ajusta o canvas intermediário
    this.processingCanvas.width = w;
    this.processingCanvas.height = h;

    const pctx = this.processingCtx;

    // Limpa o canvas intermediário
    pctx.clearRect(0, 0, w, h);

    // Desenha a câmera
    pctx.drawImage(
        this.video,
        0,
        0,
        w,
        h
    );

    // Usa a máscara para manter somente a pessoa
    pctx.globalCompositeOperation = 'destination-in';

    pctx.drawImage(
        this.segmentationMask,
        0,
        0,
        w,
        h
    );

    // Volta ao modo normal
    pctx.globalCompositeOperation = 'source-over';

    // Coloca a pessoa no canvas do holograma
    ctx.drawImage(
        this.processingCanvas,
        0,
        0,
        w,
        h
    );
        
}
    // ─────────────────────────────────────────────────────────
    // LANDMARKS
    // ─────────────────────────────────────────────────────────
    _drawLandmarks(ctx, w, h) {
        const scaleX = w / (this.video.videoWidth || w);
        const scaleY = h / (this.video.videoHeight || h);

        const pts = this._landmarks.positions;

        ctx.save();

        ctx.fillStyle = 'rgba(0, 255, 200, 0.85)';
        ctx.strokeStyle = 'rgba(0, 255, 200, 0.4)';
        ctx.lineWidth = 0.8;

        pts.forEach(p => {
            ctx.beginPath();

            ctx.arc(
                p.x * scaleX,
                p.y * scaleY,
                2,
                0,
                Math.PI * 2
            );

            ctx.fill();
        });

        const groups = [
            [0,16],
            [17,21],
            [22,26],
            [27,30],
            [30,35],
            [36,41],
            [42,47],
            [48,59],
            [60,67]
        ];

        groups.forEach(([start, end]) => {
            ctx.beginPath();

            for (let i = start; i <= end; i++) {
                const p = pts[i];

                i === start
                    ? ctx.moveTo(
                        p.x * scaleX,
                        p.y * scaleY
                    )
                    : ctx.lineTo(
                        p.x * scaleX,
                        p.y * scaleY
                    );
            }

            if ([36,42,48,60].includes(start)) {
                ctx.closePath();
            }

            ctx.stroke();
        });

        ctx.restore();
    }


     
    
}
