const CONFIG = {
    MODELS: 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
};

const AUDIO_MAP = {
    happy:     'assets/audio/Holograma3D_Feliz.mp3',
    sad:       'assets/audio/Holograma3D_Triste.mp3',
    angry:     'assets/audio/Holograma3D_Raiva.mp3',
    disgusted: 'assets/audio/Holograma3D_Nojo.mp3',
    surprised: 'assets/audio/Holograma3D_Surpresa.mp3',
    fearful:   'assets/audio/Holograma3D_Triste.mp3',
    neutral:   'assets/audio/Holograma3D_Neutro.mp3',
    carousel:  'assets/audio/Holograma3D_Carrossel.mp3'
};

const FADE_DURATION = 1000;
const FACE_IDS      = ['videoTop', 'videoLeft', 'videoRight', 'videoBottom'];

let hCtrl          = null;
let eCtrl          = null;
let carouselActive = false;
let landmarksActive = false;
let currentAudio   = null;
let currentEmotion = null;
let fadeInterval   = null;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    try {
        const progress = document.getElementById('loadingProgress');

        await faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODELS);
        if (progress) progress.style.width = "33%";

        await faceapi.nets.faceExpressionNet.loadFromUri(CONFIG.MODELS);
        if (progress) progress.style.width = "66%";

        // Carrega modelo de landmarks (necessário para pontos faciais)
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(CONFIG.MODELS);
        if (progress) progress.style.width = "100%";

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videos  = devices.filter(d => d.kind === 'videoinput');
        const select  = document.getElementById('cameraSelect');

        select.innerHTML = videos.map(d =>
            `<option value="${d.deviceId}">${d.label || 'Câmera'}</option>`
        ).join('');
        select.disabled  = false;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('loadingScreen').style.display = 'none';
        updateStatus("Pronto para iniciar", "success");
    } catch (e) {
        updateStatus("Erro ao carregar modelos", "danger");
        console.error(e);
    }
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
    const id = document.getElementById('cameraSelect').value;
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: id ? { exact: id } : undefined }
    });

    const hiddenVideo = document.createElement('video');
    hiddenVideo.srcObject = stream;
    hiddenVideo.muted     = true;
    hiddenVideo.autoplay  = true;
    hiddenVideo.style.display = 'none';
    document.body.appendChild(hiddenVideo);
    await hiddenVideo.play();

    const { EmotionController } = await import('./detec_emotion.js');
    const { HologramController } = await import('./control_holo.js');

    hCtrl = new HologramController();
    eCtrl = new EmotionController();

    // Substitui <video> por <canvas> mantendo estilos CSS
    FACE_IDS.forEach(faceId => {
        const videoEl = document.getElementById(faceId);
        if (!videoEl) return;
        const canvas    = document.createElement('canvas');
        canvas.width    = 300;
        canvas.height   = 300;
        canvas.id       = faceId + '_canvas';
        canvas.style.cssText = videoEl.style.cssText;
        canvas.className     = videoEl.className;
        videoEl.parentNode.replaceChild(canvas, videoEl);
        eCtrl.registerCanvas(faceId, canvas, hiddenVideo);
    });

    hCtrl._onCarouselChange = (faceEmotions, inEmotion, outEmotion, direction) => {
        updateInfinityWidget(faceEmotions, inEmotion, outEmotion, direction);
        updateCarouselLabels(faceEmotions);
    };

    eCtrl.onEmotionChange = (emotion, confidence) => {
        if (carouselActive) return;
        document.getElementById('expressionName').innerText = emotion.toUpperCase();
        document.getElementById('confidenceFill').style.width = (confidence * 100) + "%";
        hCtrl.applyEmotionFilter(emotion, confidence);
        playEmotionAudio(emotion);
    };

    eCtrl.startDetection(stream);

    document.getElementById('carouselToggleBtn').disabled  = false;
    document.getElementById('landmarksToggleBtn').disabled = false;
    updateStatus("Holograma Online", "success");
}

// ── Áudio com fade ────────────────────────────────────────────────────────────
function playEmotionAudio(emotion) {
    if (emotion === currentEmotion) return;
    currentEmotion = emotion;
    const src = AUDIO_MAP[emotion];
    if (!src) return;
    if (currentAudio) {
        fadeOut(currentAudio, () => { currentAudio = null; startAudio(src); });
    } else {
        startAudio(src);
    }
}

function startAudio(src) {
    const audio  = new Audio(src);
    audio.loop   = true;
    audio.volume = 0;
    audio.play().catch(() => {});
    fadeIn(audio);
    currentAudio = audio;
}

function fadeOut(audio, onDone) {
    clearInterval(fadeInterval);
    const step = Math.max(audio.volume / (FADE_DURATION / 50), 0.01);
    fadeInterval = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - step);
        if (audio.volume <= 0) {
            clearInterval(fadeInterval);
            audio.pause();
            audio.src = '';
            if (onDone) onDone();
        }
    }, 50);
}

function fadeIn(audio) {
    clearInterval(fadeInterval);
    const target = 0.7;
    const step   = target / (FADE_DURATION / 50);
    fadeInterval = setInterval(() => {
        audio.volume = Math.min(target, audio.volume + step);
        if (audio.volume >= target) clearInterval(fadeInterval);
    }, 50);
}

function stopAudio() {
    if (currentAudio) fadeOut(currentAudio, () => { currentAudio = null; });
    currentEmotion = null;
}

// ── Carousel Toggle ───────────────────────────────────────────────────────────
function toggleCarousel() {
    if (!hCtrl) return;
    carouselActive = !carouselActive;
    const btn           = document.getElementById('carouselToggleBtn');
    const infinityEl    = document.getElementById('infinityWidget');
    const aiPanel       = document.getElementById('aiPanel');
    const carouselPanel = document.getElementById('carouselPanel');
    const hintEl        = document.getElementById('keyboardHint');

    const lBtn = document.getElementById('landmarksToggleBtn');

    if (carouselActive) {
        eCtrl.active       = false;
        eCtrl.carouselMode = true;
        stopAudio();
        playEmotionAudio('carousel');
        hCtrl.enableCarousel();
        btn.classList.add('active');
        btn.innerHTML = '∞ CARROSSEL ON';
        infinityEl.classList.add('visible');
        aiPanel.classList.add('hidden');
        carouselPanel.classList.remove('hidden');
        hintEl.classList.remove('hidden');
        lBtn.classList.add('locked');
        lBtn.title = 'Indisponível no modo carrossel';
        updateStatus("Modo Carrossel Ativo", "warning");
        const faces = hCtrl.getCurrentFaceEmotions();
        updateCarouselLabels(faces);
        updateInfinityWidget(faces, null, null, 0);
    } else {
        eCtrl.active       = true;
        eCtrl.carouselMode = false;
        stopAudio();
        hCtrl.disableCarousel();
        clearCarouselLabels();
        btn.classList.remove('active');
        btn.innerHTML = '∞ CARROSSEL';
        infinityEl.classList.remove('visible');
        aiPanel.classList.remove('hidden');
        carouselPanel.classList.add('hidden');
        hintEl.classList.add('hidden');
        lBtn.classList.remove('locked');
        lBtn.title = '';
        updateStatus("Holograma Online", "success");
    }
}

// ── Landmarks Toggle ──────────────────────────────────────────────────────────
function toggleLandmarks() {
    if (!eCtrl) return;
    if (carouselActive) return; // bloqueado no modo carrossel
    landmarksActive        = !landmarksActive;
    eCtrl.showLandmarks    = landmarksActive;
    const btn = document.getElementById('landmarksToggleBtn');
    btn.classList.toggle('active', landmarksActive);
    btn.innerHTML = landmarksActive ? '⬡ PONTOS ON' : '⬡ PONTOS FACIAIS';
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (!carouselActive || !hCtrl) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); hCtrl.rotateCarousel(+1); }
    else if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); hCtrl.rotateCarousel(-1); }
});

// ── UI ────────────────────────────────────────────────────────────────────────
function updateCarouselLabels(faceEmotions) {
    const faceMap  = { videoTop: 'labelTop', videoLeft: 'labelLeft', videoRight: 'labelRight', videoBottom: 'labelBottom' };
    const panelMap = { videoTop: 'labelTopPanel', videoLeft: 'labelLeftPanel', videoRight: 'labelRightPanel', videoBottom: 'labelBottomPanel' };
    document.getElementById('hologramGrid').classList.add('carousel-active');
    faceEmotions.forEach(({ face, emotion, color }) => {
        const el = document.getElementById(faceMap[face]);
        if (el) { el.innerText = emotion.toUpperCase(); el.style.color = color; el.style.borderColor = color + '88'; }
        const pel = document.getElementById(panelMap[face]);
        if (pel) { pel.innerText = emotion.toUpperCase(); pel.style.color = color; }
    });
}

function clearCarouselLabels() {
    document.getElementById('hologramGrid').classList.remove('carousel-active');
}

function updateInfinityWidget(faceEmotions, inEmotion, outEmotion, direction) {
    const widget = document.getElementById('infinityWidget');
    if (!widget || !inEmotion) return;
    const inColor  = hCtrl.getFilterColor(inEmotion);
    const outColor = hCtrl.getFilterColor(outEmotion);
    const inEl     = widget.querySelector('.inf-in');
    const outEl    = widget.querySelector('.inf-out');
    if (inEl)  { inEl.innerText  = inEmotion;  inEl.style.color  = inColor; }
    if (outEl) { outEl.innerText = outEmotion; outEl.style.color = outColor; }
    widget.classList.remove('pulse');
    void widget.offsetWidth;
    widget.classList.add('pulse');
}

function updateStatus(m, t) {
    const s = document.getElementById('systemStatus');
    if (s) { s.innerText = m; s.className = "small mb-2 text-" + t; }
}

document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('carouselToggleBtn').addEventListener('click', toggleCarousel);
document.getElementById('landmarksToggleBtn').addEventListener('click', toggleLandmarks);
window.onload = init;