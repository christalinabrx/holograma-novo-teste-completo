export class EmotionController {
    constructor() {
        this.onEmotionChange = null;

        this.active = false;
        this.video = null;

        this.canvases = {};

        this._faceBox = null;
        this._landmarks = null;

        // Mostra visualmente os pontos/linhas dos landmarks
        this.showLandmarks = false;

        this.carouselMode = false;

        // ─────────────────────────────────────────────
        // SEGMENTAÇÃO
        // Mantida para compatibilidade com o projeto.
        // Não é mais utilizada para o recorte do rosto.
        // ─────────────────────────────────────────────

        this.segmentation = null;
        this.segmentationReady = false;
        this.segmentationMask = null;

        // ─────────────────────────────────────────────
        // ESTABILIZAÇÃO DAS EMOÇÕES
        // ─────────────────────────────────────────────

        this.currentEmotion = 'neutral';

        this.pendingEmotion = null;
        this.pendingCount = 0;

        this.emotionHistory = [];

        this.minEmotionConfidence = 0.55;
        this.minEmotionMargin = 0.12;

        this.requiredConfirmations = 3;
        this.historySize = 5;

        // ─────────────────────────────────────────────
        // CANVAS PARA MÁSCARA DO ROSTO
        // ─────────────────────────────────────────────

        this.faceMaskCanvas = document.createElement('canvas');
        this.faceMaskCtx = this.faceMaskCanvas.getContext('2d');

        // Canvas usado para suavizar a máscara
        this.faceBlurCanvas = document.createElement('canvas');
        this.faceBlurCtx = this.faceBlurCanvas.getContext('2d');

        // ─────────────────────────────────────────────
        // LOOP DE RENDERIZAÇÃO
        // ─────────────────────────────────────────────

        this._renderLoop();
    }

    // ============================================================
    // SEGMENTAÇÃO
    // ============================================================

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

    // ============================================================
    // INICIA A DETECÇÃO
    // ============================================================

    async startDetection(stream) {

        this.video = document.createElement('video');

        this.video.srcObject = stream;
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.playsInline = true;

        await this.video.play();

        this.active = true;

        this._detectLoop();
    }

    // ============================================================
    // DETECÇÃO FACIAL
    // ============================================================

    async _detectLoop() {

        if (!this.active) {
            setTimeout(() => this._detectLoop(), 250);
            return;
        }

        try {

            let detection;

            /*
             * IMPORTANTE:
             *
             * Os landmarks são calculados SEMPRE.
             *
             * showLandmarks controla apenas se eles
             * serão desenhados visualmente.
             */

            detection = await faceapi
                .detectSingleFace(
                    this.video,
                    new faceapi.TinyFaceDetectorOptions()
                )
                .withFaceLandmarks(true)
                .withFaceExpressions();

            // ────────────────────────────────────────
            // ROSTO DETECTADO
            // ────────────────────────────────────────

            if (detection) {

                this._faceBox = detection.detection.box;

                this._landmarks = detection.landmarks;

                // ────────────────────────────────────
                // EMOÇÕES
                // ────────────────────────────────────

                const expressions = detection.expressions;

                this._stabilizeEmotion(expressions);

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

    // ============================================================
    // ESTABILIZAÇÃO DAS EMOÇÕES
    // ============================================================

    _stabilizeEmotion(expressions) {

        const sorted = Object.entries(expressions)
            .sort((a, b) => b[1] - a[1]);

        if (!sorted.length) {
            return;
        }

        const [topEmotion, topScore] = sorted[0];

        const secondScore =
            sorted.length > 1
                ? sorted[1][1]
                : 0;

        // ────────────────────────────────────────────
        // CONFIANÇA MÍNIMA
        // ────────────────────────────────────────────

        if (
            topScore <
            this.minEmotionConfidence
        ) {
            return;
        }

        // ────────────────────────────────────────────
        // DIFERENÇA ENTRE AS DUAS EMOÇÕES
        // ────────────────────────────────────────────

        if (
            (topScore - secondScore) <
            this.minEmotionMargin
        ) {
            return;
        }

        // ────────────────────────────────────────────
        // HISTÓRICO
        // ────────────────────────────────────────────

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

        // ────────────────────────────────────────────
        // QUANTAS VEZES A EMOÇÃO APARECEU
        // ────────────────────────────────────────────

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

        // Já é a emoção atual
        if (
            topEmotion ===
            this.currentEmotion
        ) {
            return;
        }

        // ────────────────────────────────────────────
        // CONFIRMA NOVA EMOÇÃO
        // ────────────────────────────────────────────

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

    // ============================================================
    // LOOP DE RENDERIZAÇÃO
    // ============================================================

    _renderLoop() {

        this._drawAll();

        requestAnimationFrame(
            () => this._renderLoop()
        );
    }

    // ============================================================
    // REGISTRA CANVAS
    // ============================================================

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

    // ============================================================
    // DESENHA TODOS OS CANVASES
    // ============================================================

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

            /*
             * Agora o canvas principal mostra
             * SOMENTE O ROSTO.
             */

            this._drawFaceOnly(
                ctx,
                w,
                h
            );

            // ────────────────────────────────────────
            // LANDMARKS VISÍVEIS
            // ────────────────────────────────────────

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

    // ============================================================
    // ROSTO ISOLADO
    // ============================================================

    _drawFaceOnly(
        ctx,
        w,
        h
    ) {

        // ────────────────────────────────────────────
        // FUNDO PRETO
        // ────────────────────────────────────────────

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

        // Sem rosto ou landmarks
        if (
            !this.video ||
            !this._landmarks
        ) {
            return;
        }

        // ────────────────────────────────────────────
        // DIMENSÕES DO VÍDEO
        // ────────────────────────────────────────────

        const videoW =
            this.video.videoWidth || w;

        const videoH =
            this.video.videoHeight || h;

        const scaleX =
            w / videoW;

        const scaleY =
            h / videoH;

        // ────────────────────────────────────────────
        // PONTOS DO ROSTO
        // ────────────────────────────────────────────

        const points =
            this._landmarks.positions;

        if (
            !points ||
            points.length < 68
        ) {
            return;
        }

        // ────────────────────────────────────────────
        // CONVERTE LANDMARK PARA O CANVAS
        // ────────────────────────────────────────────

        const p = (index) => {

            const point =
                points[index];

            return {
                x: point.x * scaleX,
                y: point.y * scaleY
            };
        };

        // ========================================================
        // GEOMETRIA DO ROSTO
        // ========================================================

        /*
         * Jawline:
         *
         * 0 ---------------------- 16
         *  \                      /
         *   \                    /
         *    \                  /
         *     \________________/
         *
         * Esses são os 17 pontos reais
         * do contorno inferior/lateral.
         */

        const jawStart = p(0);
        const jawEnd = p(16);

        // ────────────────────────────────────────────
        // CENTRO DO ROSTO
        // ────────────────────────────────────────────

        const faceCenterX =
            (jawStart.x + jawEnd.x) / 2;

        /*
         * Para determinar a parte superior,
         * usamos os landmarks das sobrancelhas.
         */

        let browMinY = Infinity;

        for (let i = 17; i <= 26; i++) {

            const point = p(i);

            if (
                point.y < browMinY
            ) {
                browMinY = point.y;
            }
        }

        // ────────────────────────────────────────────
        // ALTURA DA MANDÍBULA
        // ────────────────────────────────────────────

        let jawMinY = Infinity;
        let jawMaxY = -Infinity;

        for (let i = 0; i <= 16; i++) {

            const point = p(i);

            jawMinY =
                Math.min(
                    jawMinY,
                    point.y
                );

            jawMaxY =
                Math.max(
                    jawMaxY,
                    point.y
                );
        }

        /*
         * Estimativa da testa.
         *
         * O modelo de 68 landmarks não possui
         * pontos na testa. Portanto usamos as
         * sobrancelhas como referência e criamos
         * uma curva orgânica acima delas.
         */

        const faceHeight =
            jawMaxY - browMinY;

        const foreheadY =
            browMinY -
            faceHeight * 0.55;

        // ========================================================
        // CONSTRUÇÃO DO CONTORNO
        // ========================================================

        this.faceMaskCanvas.width = w;
        this.faceMaskCanvas.height = h;

        this.faceBlurCanvas.width = w;
        this.faceBlurCanvas.height = h;

        const maskCtx =
            this.faceMaskCtx;

        const blurCtx =
            this.faceBlurCtx;

        maskCtx.clearRect(
            0,
            0,
            w,
            h
        );

        // ────────────────────────────────────────────
        // MÁSCARA BRANCA
        // ────────────────────────────────────────────

        maskCtx.fillStyle =
            '#ffffff';

        maskCtx.beginPath();

        // Começa na mandíbula esquerda
        maskCtx.moveTo(
            jawStart.x,
            jawStart.y
        );

        // ────────────────────────────────────────────
        // LADO ESQUERDO → QUEIXO → LADO DIREITO
        // ────────────────────────────────────────────

        for (
            let i = 1;
            i <= 16;
            i++
        ) {

            const point = p(i);

            maskCtx.lineTo(
                point.x,
                point.y
            );
        }

        // ────────────────────────────────────────────
        // LADO DIREITO → TESTA
        // ────────────────────────────────────────────

        /*
         * Curva superior direita.
         */

        maskCtx.bezierCurveTo(

            jawEnd.x,
            jawEnd.y -

                faceHeight * 0.35,

            faceCenterX +
                (jawEnd.x - faceCenterX) *
                0.90,

            foreheadY +
                faceHeight * 0.15,

            faceCenterX,
            foreheadY
        );

        // ────────────────────────────────────────────
        // TESTA → LADO ESQUERDO
        // ────────────────────────────────────────────

        maskCtx.bezierCurveTo(

            faceCenterX -
                (faceCenterX - jawStart.x) *
                0.90,

            foreheadY +
                faceHeight * 0.15,

            jawStart.x,
            jawStart.y -
                faceHeight * 0.35,

            jawStart.x,
            jawStart.y
        );

        maskCtx.closePath();

        maskCtx.fill();

        // ========================================================
        // SUAVIZAÇÃO DA MÁSCARA
        // ========================================================

        /*
         * A câmera NÃO recebe blur.
         *
         * Apenas a máscara recebe blur.
         *
         * Isso deixa o rosto nítido e suaviza
         * somente a borda.
         */

        blurCtx.clearRect(
            0,
            0,
            w,
            h
        );

        blurCtx.save();

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

        // ========================================================
        // DESENHA A CÂMERA ATRÁS DA MÁSCARA
        // ========================================================

        ctx.save();

        ctx.globalCompositeOperation =
            'source-over';

        ctx.drawImage(
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

        // ========================================================
        // MANTÉM SOMENTE A REGIÃO DO ROSTO
        // ========================================================

        ctx.globalCompositeOperation =
            'destination-in';

        ctx.drawImage(
            this.faceBlurCanvas,
            0,
            0,
            w,
            h
        );

        ctx.restore();

        // ========================================================
        // RECOLOCA FUNDO PRETO
        // ========================================================

        /*
         * Como destination-in torna o resto
         * transparente, desenhamos o preto
         * antes do rosto.
         *
         * O canvas já começou preto, então
         * o resultado permanece:
         *
         *       ROSTO
         *          +
         *       FUNDO PRETO
         */

    }

    // ============================================================
    // DESENHO DOS LANDMARKS
    // ============================================================

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
            (this.video.videoWidth || w);

        const scaleY =
            h /
            (this.video.videoHeight || h);

        const pts =
            this._landmarks.positions;

        ctx.save();

        ctx.fillStyle =
            'rgba(0, 255, 200, 0.85)';

        ctx.strokeStyle =
            'rgba(0, 255, 200, 0.4)';

        ctx.lineWidth = 0.8;

        // ────────────────────────────────────────────
        // PONTOS
        // ────────────────────────────────────────────

        pts.forEach((point) => {

            ctx.beginPath();

            ctx.arc(
                point.x * scaleX,
                point.y * scaleY,
                2,
                0,
                Math.PI * 2
            );

            ctx.fill();
        });

        // ────────────────────────────────────────────
        // LINHAS DO ROSTO
        // ────────────────────────────────────────────

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

                    const point =
                        pts[i];

                    if (
                        i === start
                    ) {

                        ctx.moveTo(
                            point.x * scaleX,
                            point.y * scaleY
                        );

                    } else {

                        ctx.lineTo(
                            point.x * scaleX,
                            point.y * scaleY
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

    // ============================================================
    // MÉTODO ANTIGO — MANTIDO PARA COMPATIBILIDADE
    // ============================================================

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

        /*
         * Canvas intermediário temporário.
         *
         * Este método não é mais utilizado
         * pelo _drawAll(), mas fica preservado
         * caso você queira voltar à segmentação
         * da pessoa futuramente.
         */

        const tempCanvas =
            document.createElement(
                'canvas'
            );

        tempCanvas.width = w;
        tempCanvas.height = h;

        const tempCtx =
            tempCanvas.getContext('2d');

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
