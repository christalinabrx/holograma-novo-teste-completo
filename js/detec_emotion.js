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

    async startDetection(stream) {

        this.video =
            document.createElement('video');

        this.video.srcObject = stream;
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.playsInline = true;

        await this.video.play();

        this.active = true;

        // A segmentação continua disponível
        // para compatibilidade com outras partes
        // do projeto.
        if (this.segmentation) {
            this._segmentationLoop();
        }

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

        if (!this.active) {

            setTimeout(
                () => this._detectLoop(),
                250
            );

            return;
        }

        try {

            const detection =
                await faceapi
                    .detectSingleFace(
                        this.video,
                        new faceapi.TinyFaceDetectorOptions()
                    )
                    .withFaceLandmarks(true)
                    .withFaceExpressions();

            // -----------------------------------------------------
            // ROSTO DETECTADO
            // -----------------------------------------------------

            if (detection) {

                this._faceBox =
                    detection.detection.box;

                this._landmarks =
                    detection.landmarks;

                // -------------------------------------------------
                // EMOÇÕES
                // -------------------------------------------------

                this._stabilizeEmotion(
                    detection.expressions
                );

            } else {

                this._faceBox = null;
                this._landmarks = null;
            }

        } catch (e) {

            console.error(
                'Erro na detecção facial:',
                e
            );
        }

        setTimeout(
            () => this._detectLoop(),
            250
        );
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

    _drawFaceOnly(
        ctx,
        w,
        h
    ) {

        // ---------------------------------------------------------
        // FUNDO PRETO
        // ---------------------------------------------------------

        ctx.save();

        ctx.globalCompositeOperation =
            'source-over';

        ctx.fillStyle = '#000000';

        ctx.fillRect(
            0,
            0,
            w,
            h
        );

        ctx.restore();

        // ---------------------------------------------------------
        // SEM ROSTO
        // ---------------------------------------------------------

        if (
            !this.video ||
            !this._landmarks ||
            !this._landmarks.positions
        ) {
            return;
        }

        const points =
            this._landmarks.positions;

        if (points.length < 68) {
            return;
        }

        // ---------------------------------------------------------
        // DIMENSÕES DA CÂMERA
        // ---------------------------------------------------------

        const videoW =
            this.video.videoWidth;

        const videoH =
            this.video.videoHeight;

        if (
            !videoW ||
            !videoH
        ) {
            return;
        }

        const scaleX =
            w / videoW;

        const scaleY =
            h / videoH;

        // ---------------------------------------------------------
        // FUNÇÃO PARA CONVERTER LANDMARK
        // PARA O CANVAS
        // ---------------------------------------------------------

        const point = (index) => {

            return {
                x:
                    points[index].x *
                    scaleX,

                y:
                    points[index].y *
                    scaleY
            };
        };

        // =========================================================
        // MANDÍBULA
        // =========================================================

        const jaw = [];

        for (
            let i = 0;
            i <= 16;
            i++
        ) {

            jaw.push(
                point(i)
            );
        }

        // =========================================================
        // SOBRANCELHAS
        // =========================================================

        let browMinY =
            Infinity;

        for (
            let i = 17;
            i <= 26;
            i++
        ) {

            const p =
                point(i);

            browMinY =
                Math.min(
                    browMinY,
                    p.y
                );
        }

        const leftJaw =
            jaw[0];

        const rightJaw =
            jaw[16];

        // =========================================================
        // CENTRO DO ROSTO
        // =========================================================

        const centerX =
            (
                leftJaw.x +
                rightJaw.x
            ) / 2;

        // =========================================================
        // ALTURA DA MANDÍBULA
        // =========================================================

        let jawMaxY =
            -Infinity;

        for (
            const p of jaw
        ) {

            jawMaxY =
                Math.max(
                    jawMaxY,
                    p.y
                );
        }

        const faceHeight =
            Math.max(
                jawMaxY -
                browMinY,
                1
            );

        // =========================================================
        // ESTIMATIVA DA TESTA
        // =========================================================

        /*
         * O modelo de 68 landmarks não possui
         * pontos reais na testa.
         *
         * Por isso usamos as sobrancelhas
         * como referência.
         */

        const foreheadY =
            browMinY -
            faceHeight * 0.55;

        // =========================================================
        // REDIMENSIONA OS CANVASES INTERNOS
        // SOMENTE QUANDO NECESSÁRIO
        // =========================================================

        this._resizeCanvas(
            this.faceImageCanvas,
            w,
            h
        );

        this._resizeCanvas(
            this.faceMaskCanvas,
            w,
            h
        );

        this._resizeCanvas(
            this.faceBlurCanvas,
            w,
            h
        );

        const imageCtx =
            this.faceImageCtx;

        const maskCtx =
            this.faceMaskCtx;

        const blurCtx =
            this.faceBlurCtx;

        imageCtx.clearRect(
            0,
            0,
            w,
            h
        );

        maskCtx.clearRect(
            0,
            0,
            w,
            h
        );

        blurCtx.clearRect(
            0,
            0,
            w,
            h
        );

        // =========================================================
        // CONSTRÓI O CONTORNO DO ROSTO
        // =========================================================

        maskCtx.save();

        maskCtx.fillStyle =
            '#ffffff';

        maskCtx.beginPath();

        // ---------------------------------------------------------
        // COMEÇA NA MANDÍBULA ESQUERDA
        // ---------------------------------------------------------

        maskCtx.moveTo(
            jaw[0].x,
            jaw[0].y
        );

        // ---------------------------------------------------------
        // SEGUE OS 17 LANDMARKS DA MANDÍBULA
        // ---------------------------------------------------------

        for (
            let i = 1;
            i <= 16;
            i++
        ) {

            maskCtx.lineTo(
                jaw[i].x,
                jaw[i].y
            );
        }

        // =========================================================
        // LADO DIREITO → TESTA
        // =========================================================

        maskCtx.bezierCurveTo(

            rightJaw.x,

            rightJaw.y -
                faceHeight * 0.30,

            centerX +
                (
                    rightJaw.x -
                    centerX
                ) * 0.92,

            foreheadY +
                faceHeight * 0.18,

            centerX,

            foreheadY
        );

        // =========================================================
        // TESTA → LADO ESQUERDO
        // =========================================================

        maskCtx.bezierCurveTo(

            centerX -
                (
                    centerX -
                    leftJaw.x
                ) * 0.92,

            foreheadY +
                faceHeight * 0.18,

            leftJaw.x,

            leftJaw.y -
                faceHeight * 0.30,

            leftJaw.x,

            leftJaw.y
        );

        maskCtx.closePath();

        maskCtx.fill();

        maskCtx.restore();

        // =========================================================
        // SUAVIZA SOMENTE A MÁSCARA
        // =========================================================

        blurCtx.save();

        /*
         * A imagem da câmera NÃO recebe blur.
         *
         * Apenas o alpha da máscara é suavizado.
         */

        blurCtx.filter =
            'blur(3px)';

        blurCtx.drawImage(
            this.faceMaskCanvas,
            0,
            0,
            w,
            h
        );

        blurCtx.restore();

        // =========================================================
        // DESENHA A CÂMERA NO CANVAS INTERNO
        // =========================================================

        imageCtx.drawImage(
            this.video,

            0,
            0,
            videoW,
            videoH,

            0,
            0,
            w,
            h
        );

        // =========================================================
        // APLICA O ALPHA DA MÁSCARA
        // =========================================================

        imageCtx.globalCompositeOperation =
            'destination-in';

        imageCtx.drawImage(
            this.faceBlurCanvas,

            0,
            0,
            w,
            h
        );

        imageCtx.globalCompositeOperation =
            'source-over';

        // =========================================================
        // CANVAS PRINCIPAL
        // =========================================================

        ctx.save();

        ctx.globalCompositeOperation =
            'source-over';

        // Fundo preto.
        ctx.fillStyle =
            '#000000';

        ctx.fillRect(
            0,
            0,
            w,
            h
        );

        // Rosto recortado.
        ctx.drawImage(
            this.faceImageCanvas,

            0,
            0,
            w,
            h
        );

        ctx.restore();
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
