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

            // ── Estabilização das emoções ──────────────────────────
        this.currentEmotion = 'neutral';
        this.pendingEmotion = null;
        this.pendingCount = 0;

        this.emotionHistory = [];

        this.minEmotionConfidence = 0.60;
        this.minEmotionMargin = 0.15;
        this.requiredConfirmations = 3;
        this.historySize = 5;
        
        // ── Segmentação da pessoa ─────────────────────────────
        this.segmentation = null;
        this.segmentationReady = false;
        this.segmentationMask = null;

        // Canvas invisível usado para processar a imagem
        this.processingCanvas = document.createElement('canvas');
        this.processingCtx = this.processingCanvas.getContext('2d');

        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');

        this.smoothMaskCanvas = document.createElement('canvas');
        this.smoothMaskCtx = this.smoothMaskCanvas.getContext('2d');
        
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
    _stabilizeEmotion(expressions) {

    const sorted = Object.entries(expressions)
        .sort((a, b) => b[1] - a[1]);

    const [topEmotion, topScore] = sorted[0];
    const [, secondScore] = sorted[1];

    // 1. Confiança mínima
    if (topScore < this.minEmotionConfidence) {
        return;
    }

    // 2. Diferença mínima entre a primeira e a segunda emoção
    if ((topScore - secondScore) < this.minEmotionMargin) {
        return;
    }

    // Guarda no histórico
    this.emotionHistory.push({
        emotion: topEmotion,
        score: topScore
    });

    if (this.emotionHistory.length > this.historySize) {
        this.emotionHistory.shift();
    }

    // Verifica se a emoção apareceu várias vezes
    const recentMatches = this.emotionHistory.filter(
        item => item.emotion === topEmotion
    ).length;

    // Se ainda não houver confirmação suficiente
    if (recentMatches < this.requiredConfirmations) {
        return;
    }

    // Já é a emoção atual
    if (topEmotion === this.currentEmotion) {
        return;
    }

    // Nova emoção confirmada
    this.currentEmotion = topEmotion;

    this.pendingEmotion = null;
    this.pendingCount = 0;

    if (this.onEmotionChange) {
        this.onEmotionChange(
            topEmotion,
            topScore
        );
    }
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
            if (detection) {
                this._faceBox = detection.detection.box;

                const exp = detection.expressions;

                this._stabilizeEmotion(exp);
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

    if (!this.segmentationMask) {
        return;
    }

    // Ajusta os canvases
    this.processingCanvas.width = w;
    this.processingCanvas.height = h;

    this.maskCanvas.width = w;
    this.maskCanvas.height = h;

    this.smoothMaskCanvas.width = w;
    this.smoothMaskCanvas.height = h;

    const pctx = this.processingCtx;
    const mctx = this.maskCtx;
    const sctx = this.smoothMaskCtx;

    // ─────────────────────────────────────────────
    // CÂMERA
    // ─────────────────────────────────────────────

    pctx.clearRect(0, 0, w, h);

    pctx.drawImage(
        this.video,
        0,
        0,
        w,
        h
    );

    // ─────────────────────────────────────────────
    // MÁSCARA
    // ─────────────────────────────────────────────

    mctx.clearRect(0, 0, w, h);

    mctx.drawImage(
        this.segmentationMask,
        0,
        0,
        w,
        h
    );

    // ─────────────────────────────────────────────
    // SUAVIZAÇÃO DA MÁSCARA
    // ─────────────────────────────────────────────

    sctx.clearRect(0, 0, w, h);

    sctx.filter = 'blur(2px)';

    sctx.drawImage(
        this.maskCanvas,
        0,
        0,
        w,
        h
    );

    sctx.filter = 'none';

    // ─────────────────────────────────────────────
    // APLICA A MÁSCARA
    // ─────────────────────────────────────────────

    pctx.globalCompositeOperation = 'destination-in';

    pctx.drawImage(
        this.smoothMaskCanvas,
        0,
        0,
        w,
        h
    );

    pctx.globalCompositeOperation = 'source-over';

    // ─────────────────────────────────────────────
    // RESULTADO
    // ─────────────────────────────────────────────

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
