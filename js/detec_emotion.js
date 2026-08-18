export class EmotionController {
    constructor() {
        this.onEmotionChange = null;
        this.active = false;
        this.video = null;
        this.canvases = {};

        this._faceBox = null;
        this._landmarks = null;

        // Controla apenas a visualização dos landmarks.
        // Os landmarks são calculados sempre.
        this.showLandmarks = false;
        this.carouselMode = false;

        // ---------------------------------------------------------
        // SEGMENTAÇÃO DA PESSOA
        // Mantida para compatibilidade com o projeto.
        // O recorte visual atual usa os landmarks faciais.
        // ---------------------------------------------------------

        this.segmentation = null;
        this.segmentationReady = false;
        this.segmentationMask = null;

        // ---------------------------------------------------------
        // ESTABILIZAÇÃO DAS EMOÇÕES
        // ---------------------------------------------------------

        this.currentEmotion = 'neutral';
        this.pendingEmotion = null;
        this.pendingCount = 0;

        this.emotionHistory = [];

        this.minEmotionConfidence = 0.55;
        this.minEmotionMargin = 0.12;
        this.requiredConfirmations = 3;
        this.historySize = 5;

        // ---------------------------------------------------------
        // CANVASES INTERNOS PARA O RECORTE DO ROSTO
        // ---------------------------------------------------------

        this.faceImageCanvas = document.createElement('canvas');
        this.faceImageCtx =
            this.faceImageCanvas.getContext('2d');

        this.faceMaskCanvas = document.createElement('canvas');
        this.faceMaskCtx =
            this.faceMaskCanvas.getContext('2d');

        this.faceBlurCanvas = document.createElement('canvas');
        this.faceBlurCtx =
            this.faceBlurCanvas.getContext('2d');

        // ---------------------------------------------------------
        // LOOP DE RENDERIZAÇÃO
        // ---------------------------------------------------------

        this._renderLoop();
    }

    // =============================================================
    // INICIALIZAÇÃO DA SEGMENTAÇÃO
    // =============================================================

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

            this.segmentationMask =
                results.segmentationMask;

            this.segmentationReady = true;
        });
    }

    // =============================================================
    // INICIA A CÂMERA / DETECÇÃO
    // =============================================================

    async startDetection(stream, existingVideo = null) {

    if (existingVideo) {
        this.video = existingVideo;

        if (this.video.paused) {
            await this.video.play();
        }

    } else {
        this.video = document.createElement('video');

        this.video.srcObject = stream;
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.playsInline = true;

        await this.video.play();
    }

    this.active = true;

    this._detectLoop();
}

    // =============================================================
    // LOOP DA SEGMENTAÇÃO
    // =============================================================

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

            console.error(
                'Erro na segmentação:',
                e
            );
        }

        setTimeout(
            () => this._segmentationLoop(),
            50
        );
    }

    // =============================================================
    // LOOP DA DETECÇÃO FACIAL
    // =============================================================

    async _detectLoop() {
    if (!this.active || !this.video) {
        setTimeout(() => this._detectLoop(), 100);
        return;
    }

    try {
        if (this.video.readyState < 2) {
            setTimeout(() => this._detectLoop(), 100);
            return;
        }

        const options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 416,
            scoreThreshold: 0.45
        });

        const detection = await faceapi
            .detectSingleFace(this.video, options)
            .withFaceLandmarks(true)
            .withFaceExpressions();

        if (detection) {
            // Guarda a caixa principal do rosto.
            this._faceBox = detection.detection.box;

            // Guarda landmarks apenas para visualização opcional.
            this._landmarks = detection.landmarks || null;

            // Analisa a expressão.
            this._stabilizeEmotion(detection.expressions);

            console.log(
                'ROSTO DETECTADO',
                this._faceBox,
                detection.expressions
            );

        } else {
            this._faceBox = null;
            this._landmarks = null;
        }

    } catch (e) {
        console.error('ERRO NA DETECÇÃO FACIAL:', e);
    }

    setTimeout(() => this._detectLoop(), 100);
}
    // =============================================================
    // ESTABILIZAÇÃO DAS EMOÇÕES
    // =============================================================

    _stabilizeEmotion(expressions) {

        if (!expressions) {
            return;
        }

        const sorted =
            Object.entries(expressions)
                .sort(
                    (a, b) => b[1] - a[1]
                );

        if (sorted.length === 0) {
            return;
        }

        const [
            topEmotion,
            topScore
        ] = sorted[0];

        const secondScore =
            sorted.length > 1
                ? sorted[1][1]
                : 0;

        // ---------------------------------------------------------
        // CONFIANÇA MÍNIMA
        // ---------------------------------------------------------

        if (
            topScore <
            this.minEmotionConfidence
        ) {
            return;
        }

        // ---------------------------------------------------------
        // DIFERENÇA ENTRE AS DUAS EMOÇÕES
        // ---------------------------------------------------------

        if (
            (topScore - secondScore) <
            this.minEmotionMargin
        ) {
            return;
        }

        // ---------------------------------------------------------
        // HISTÓRICO
        // ---------------------------------------------------------

        this.emotionHistory.push({
            emotion: topEmotion,
            score: topScore
        });

        if (
            this.emotionHistory.length >
            this.historySize
        ) {

            this.emotionHistory.shift();
        }

        // ---------------------------------------------------------
        // QUANTAS VEZES A EMOÇÃO APARECEU
        // ---------------------------------------------------------

        const recentMatches =
            this.emotionHistory.filter(
                item =>
                    item.emotion === topEmotion
            ).length;

        if (
            recentMatches <
            this.requiredConfirmations
        ) {
            return;
        }

        // Já é a emoção atual.
        if (
            topEmotion ===
            this.currentEmotion
        ) {
            return;
        }

        // ---------------------------------------------------------
        // CONFIRMA A NOVA EMOÇÃO
        // ---------------------------------------------------------

        this.currentEmotion =
            topEmotion;

        this.pendingEmotion = null;
        this.pendingCount = 0;

        if (this.onEmotionChange) {

            this.onEmotionChange(
                topEmotion,
                topScore
            );
        }
    }

    // =============================================================
    // LOOP VISUAL
    // =============================================================

    _renderLoop() {

        this._drawAll();

        requestAnimationFrame(
            () => this._renderLoop()
        );
    }

    // =============================================================
    // REGISTRA CANVAS
    // =============================================================

    registerCanvas(
        id,
        canvas,
        videoEl
    ) {

        this.canvases[id] = {
            canvas,
            videoEl,
            ctx: canvas.getContext('2d')
        };
    }

    // =============================================================
    // DESENHA OS CANVASES
    // =============================================================

    _drawAll() {

        for (
            const [
                id,
                {
                    canvas,
                    videoEl,
                    ctx
                }
            ]
            of Object.entries(this.canvases)
        ) {

            if (
                !videoEl ||
                !ctx ||
                videoEl.readyState < 2
            ) {
                continue;
            }

            const w = canvas.width;
            const h = canvas.height;

            // -----------------------------------------------------
            // MOSTRA SOMENTE O ROSTO
            // -----------------------------------------------------

            this._drawFaceOnly(
                ctx,
                w,
                h
            );

            // -----------------------------------------------------
            // LANDMARKS VISÍVEIS
            // -----------------------------------------------------

            if (
                !this.carouselMode &&
                this.showLandmarks &&
                this._landmarks
            ) {

                this._drawLandmarks(
                    ctx,
                    w,
                    h
                );
            }
        }
    }

    // =============================================================
    // RECORTE DO ROSTO USANDO LANDMARKS
    // =============================================================

   _drawFaceOnly(ctx, w, h) {

    // =========================================================
    // FUNDO PRETO
    // =========================================================

    ctx.save();

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.restore();

    // =========================================================
    // SEM DETECÇÃO
    // =========================================================

    if (!this.video || !this._faceBox) {
        return;
    }

    const videoW = this.video.videoWidth;
    const videoH = this.video.videoHeight;

    if (!videoW || !videoH) {
        return;
    }

    // =========================================================
    // CAIXA DO ROSTO
    // =========================================================

    const box = this._faceBox;

    // =========================================================
    // EXPANDE O ROSTO PARA PEGAR A CABEÇA
    // =========================================================

    // Quanto maior, mais cabelo/pescoço entram.
    const expandX = box.width * 0.65;
    const expandTop = box.height * 0.85;
    const expandBottom = box.height * 0.55;

    let sx = box.x - expandX;
    let sy = box.y - expandTop;

    let sw = box.width + expandX * 2;
    let sh = box.height + expandTop + expandBottom;

    // =========================================================
    // NÃO DEIXA O RECORTE SAIR DA CÂMERA
    // =========================================================

    sx = Math.max(0, sx);
    sy = Math.max(0, sy);

    sw = Math.min(sw, videoW - sx);
    sh = Math.min(sh, videoH - sy);

    if (sw <= 0 || sh <= 0) {
        return;
    }

    // =========================================================
    // DESENHA SOMENTE A ÁREA DA CABEÇA
    // =========================================================

    ctx.save();

    ctx.beginPath();

    // Máscara oval suave para a cabeça.
    const centerX = w / 2;
    const centerY = h / 2;

    const radiusX = w * 0.42;
    const radiusY = h * 0.48;

    ctx.ellipse(
        centerX,
        centerY,
        radiusX,
        radiusY,
        0,
        0,
        Math.PI * 2
    );

    ctx.clip();

    ctx.drawImage(
        this.video,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        w,
        h
    );

    ctx.restore();

    // =========================================================
    // GARANTE QUE O FUNDO CONTINUE PRETO
    // =========================================================

    // Nada além da área recortada é desenhado.
}

    // =============================================================
    // REDIMENSIONA CANVAS SOMENTE QUANDO NECESSÁRIO
    // =============================================================

    _resizeCanvas(
        canvas,
        w,
        h
    ) {

        if (
            canvas.width !== w ||
            canvas.height !== h
        ) {

            canvas.width = w;
            canvas.height = h;
        }
    }

    // =============================================================
    // DESENHA LANDMARKS
    // =============================================================

    _drawLandmarks(
        ctx,
        w,
        h
    ) {

        if (
            !this._landmarks ||
            !this.video
        ) {
            return;
        }

        const scaleX =
            w /
            (
                this.video.videoWidth ||
                w
            );

        const scaleY =
            h /
            (
                this.video.videoHeight ||
                h
            );

        const pts =
            this._landmarks.positions;

        ctx.save();

        ctx.fillStyle =
            'rgba(0, 255, 200, 0.85)';

        ctx.strokeStyle =
            'rgba(0, 255, 200, 0.4)';

        ctx.lineWidth =
            0.8;

        // ---------------------------------------------------------
        // PONTOS
        // ---------------------------------------------------------

        pts.forEach(
            (p) => {

                ctx.beginPath();

                ctx.arc(
                    p.x * scaleX,
                    p.y * scaleY,
                    2,
                    0,
                    Math.PI * 2
                );

                ctx.fill();
            }
        );

        // ---------------------------------------------------------
        // LINHAS
        // ---------------------------------------------------------

        const groups = [
            [0, 16],
            [17, 21],
            [22, 26],
            [27, 30],
            [30, 35],
            [36, 41],
            [42, 47],
            [48, 59],
            [60, 67]
        ];

        groups.forEach(
            ([start, end]) => {

                ctx.beginPath();

                for (
                    let i = start;
                    i <= end;
                    i++
                ) {

                    const p =
                        pts[i];

                    if (
                        i === start
                    ) {

                        ctx.moveTo(
                            p.x * scaleX,
                            p.y * scaleY
                        );

                    } else {

                        ctx.lineTo(
                            p.x * scaleX,
                            p.y * scaleY
                        );
                    }
                }

                if (
                    [
                        36,
                        42,
                        48,
                        60
                    ].includes(start)
                ) {

                    ctx.closePath();
                }

                ctx.stroke();
            }
        );

        ctx.restore();
    }

    // =============================================================
    // MÉTODO ANTIGO DE SEGMENTAÇÃO
    // MANTIDO PARA COMPATIBILIDADE
    // =============================================================

    _drawPersonOnly(
        ctx,
        w,
        h
    ) {

        ctx.fillStyle =
            '#000000';

        ctx.fillRect(
            0,
            0,
            w,
            h
        );

        if (
            !this.segmentationMask
        ) {
            return;
        }

        const tempCanvas =
            document.createElement(
                'canvas'
            );

        tempCanvas.width =
            w;

        tempCanvas.height =
            h;

        const tempCtx =
            tempCanvas.getContext(
                '2d'
            );

        tempCtx.drawImage(
            this.video,
            0,
            0,
            w,
            h
        );

        tempCtx.globalCompositeOperation =
            'destination-in';

        tempCtx.drawImage(
            this.segmentationMask,
            0,
            0,
            w,
            h
        );

        tempCtx.globalCompositeOperation =
            'source-over';

        ctx.drawImage(
            tempCanvas,
            0,
            0,
            w,
            h
        );
    }
}
