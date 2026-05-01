// DBD Skill Check Game - Phase 1
// Build order: 1. Static render → 2. Animation → 3. Input → 4. Hit/miss states → 5. Score/combo → 6. Speed scaling → 7. Game over → 8. High score → 9. Deploy

// ===== CONSTANTS (tune these to feel) =====
const CONFIG = {
    rotationPeriod: 1200,        // ms for full rotation (~1.2s)
    speedupRate: 0.05,           // 5% faster every speedup interval
    speedupInterval: 5,          // hits before speeding up
    successArcWidth: 60,         // degrees - the "good" zone
    greatZoneWidth: 15,          // degrees - leading edge (bonus zone)
    checkGap: 400,               // ms between checks
    checkGapGreat: 900,          // ms pause after a great hit
    scoreGood: 100,
    scoreGreat: 250,
    maxMultiplier: 5,
};

// ===== GAME STATE =====
const gameState = {
    isRunning: false,
    isGameOver: false,
    score: 0,
    combo: 0,
    highScore: localStorage.getItem('skillCheckHighScore') || 0,
    currentSpeed: 1,             // multiplier on rotation speed
    checkCount: 0,               // greats since last speed increase
    lastCheckTime: 0,
    checkActive: true,
    canInput: true,
    pointerFrozen: false,
    frozenAngle: 0,
    hitFlashTime: 0,             // visual feedback timer
    missFlashTime: 0,
};

// ===== CANVAS SETUP =====
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Skill check position — defaults to screen center; hard mode will randomize this
const skillCheckPos = { x: 0, y: 0 };

const GAME = {
    radius: 150,
    pointerLength: 140,
    successArc: null,
};

function recalcConstants() {
    skillCheckPos.x = canvas.width / 2;
    skillCheckPos.y = canvas.height / 2;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    recalcConstants();
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ===== SKILL CHECK LOGIC =====

function createNewCheck() {
    // Randomize arc position, avoid putting it directly under pointer
    const arcStartAngle = Math.random() * 360;

    // Ensure arc is not directly under pointer (angle between 160-200 degrees)
    if (arcStartAngle > 160 && arcStartAngle < 200) {
        return createNewCheck(); // retry
    }

    GAME.successArc = {
        start: arcStartAngle,
        end: arcStartAngle + CONFIG.successArcWidth,
        greatEnd: arcStartAngle + CONFIG.greatZoneWidth,
    };

    gameState.checkActive = true;
    gameState.canInput = true;
    gameState.pointerFrozen = false;
    gameState.lastCheckTime = Date.now();
    playSound('checkStart');
}

function getPointerAngle() {
    if (gameState.pointerFrozen) return gameState.frozenAngle;
    const elapsed = Date.now() - gameState.lastCheckTime;
    const rotationSpeed = (360 / CONFIG.rotationPeriod) * gameState.currentSpeed;
    return (elapsed * rotationSpeed) % 360;
}

function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
}

function isAngleInArc(angle, arcStart, arcEnd) {
    const start = normalizeAngle(arcStart);
    const end = normalizeAngle(arcEnd);
    const normalized = normalizeAngle(angle);

    if (start < end) {
        return normalized >= start && normalized <= end;
    } else {
        return normalized >= start || normalized <= end;
    }
}

function checkInput() {
    if (!gameState.isRunning || !gameState.canInput || !gameState.checkActive) {
        return;
    }

    const pointerAngle = getPointerAngle();
    const arc = GAME.successArc;

    gameState.canInput = false;

    // Check if in great zone
    if (isAngleInArc(pointerAngle, arc.start, arc.greatEnd)) {
        onGreatHit();
    }
    // Check if in success arc
    else if (isAngleInArc(pointerAngle, arc.start, arc.end)) {
        onGoodHit();
    }
    // Miss
    else {
        onMiss();
    }
}

function onGoodHit() {
    const multiplier = Math.min(gameState.combo / 10, CONFIG.maxMultiplier);
    const points = CONFIG.scoreGood * multiplier;

    gameState.score += points;
    gameState.combo++;
    gameState.hitFlashTime = 200;

    playSound('good');
    updateUI();

    setTimeout(() => {
        createNewCheck();
    }, CONFIG.checkGap);
}

function onGreatHit() {
    const multiplier = Math.min(gameState.combo / 10, CONFIG.maxMultiplier);
    const points = CONFIG.scoreGreat * multiplier;

    gameState.score += points;
    gameState.combo++;
    gameState.checkCount++;
    gameState.hitFlashTime = 200;
    gameState.frozenAngle = getPointerAngle();
    gameState.pointerFrozen = true;

    playSound('great');

    if (gameState.checkCount >= CONFIG.speedupInterval) {
        gameState.currentSpeed *= (1 + CONFIG.speedupRate);
        gameState.checkCount = 0;
    }

    updateUI();

    setTimeout(() => {
        createNewCheck();
    }, CONFIG.checkGapGreat);
}

function onMiss() {
    gameState.combo = 0;
    gameState.missFlashTime = 300;
    gameState.checkActive = false;

    playSound('miss');

    setTimeout(() => {
        endGame();
    }, 200);
}

function endGame() {
    gameState.isRunning = false;
    gameState.isGameOver = true;

    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        localStorage.setItem('skillCheckHighScore', gameState.highScore);
    }

    document.getElementById('finalScore').textContent = gameState.combo;
    document.getElementById('finalHighScore').textContent = gameState.highScore;
    document.getElementById('gameOverScreen').classList.remove('hidden');
}

function startNewGame() {
    gameState.isRunning = true;
    gameState.isGameOver = false;
    gameState.score = 0;
    gameState.combo = 0;
    gameState.currentSpeed = 1;
    gameState.checkCount = 0;
    gameState.pointerFrozen = false;

    document.getElementById('gameOverScreen').classList.add('hidden');

    createNewCheck();
}

// ===== UI UPDATES =====
function updateUI() {
    document.getElementById('streakValue').textContent = gameState.combo;
    document.getElementById('highScoreValue').textContent = gameState.highScore;
}

// ===== RENDERING =====
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Circle ring — gray stroke, no fill
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(skillCheckPos.x, skillCheckPos.y, GAME.radius, 0, Math.PI * 2);
    ctx.stroke();

    if (gameState.isRunning && GAME.successArc) {
        // Success arc — white block
        drawArc(GAME.successArc.start, GAME.successArc.end, '#ffffff', 8);
        // Great zone — thicker notch at leading edge
        drawArc(GAME.successArc.start, GAME.successArc.greatEnd, '#ffffff', 14);
    }

    // Pointer
    if (gameState.isRunning) {
        drawPointer();
    }

    // Hit flash — subtle green tint
    if (gameState.hitFlashTime > 0) {
        ctx.fillStyle = `rgba(0, 255, 0, ${gameState.hitFlashTime / 200 * 0.15})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        gameState.hitFlashTime = 0;
    }

    // Miss flash — subtle red tint
    if (gameState.missFlashTime > 0) {
        ctx.fillStyle = `rgba(255, 0, 0, ${gameState.missFlashTime / 300 * 0.25})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        gameState.missFlashTime = 0;
    }
}

function drawArc(startDeg, endDeg, color, lineWidth) {
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = (endDeg * Math.PI) / 180;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(skillCheckPos.x, skillCheckPos.y, GAME.radius, startRad, endRad);
    ctx.stroke();
}

function drawPointer() {
    const angle = getPointerAngle();
    const rad = (angle * Math.PI) / 180;

    const startX = skillCheckPos.x;
    const startY = skillCheckPos.y;
    const endX = skillCheckPos.x + Math.cos(rad) * GAME.pointerLength;
    const endY = skillCheckPos.y + Math.sin(rad) * GAME.pointerLength;

    ctx.strokeStyle = '#cc0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
}

// ===== AUDIO =====
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioContext.createGain();
masterGain.gain.value = 0.2;
masterGain.connect(audioContext.destination);

let isMuted = false;

function toggleMute() {
    isMuted = !isMuted;
    masterGain.gain.value = isMuted ? 0 : 0.2;
    document.getElementById('muteBtn').textContent = isMuted ? 'Unmute' : 'Mute';
}

const soundBuffers = {
    checkStart: null,
    good: null,
    great: null,
};

async function loadSoundBuffers() {
    const files = {
        checkStart: 'assets/sounds/dbd-check-start.mp3',
        good:       'assets/sounds/dbd-good-skill-check.mp3',
        great:      'assets/sounds/dbd-great-skill-check.mp3',
    };
    for (const [key, path] of Object.entries(files)) {
        try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            soundBuffers[key] = await audioContext.decodeAudioData(arrayBuffer);
        } catch (err) {
            console.warn(`Audio load failed for "${key}":`, err);
        }
    }
}

function playSound(type) {
    if (audioContext.state === 'suspended') audioContext.resume();

    if (type === 'checkStart' || type === 'good' || type === 'great') {
        const buffer = soundBuffers[type];
        if (!buffer) return;
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(masterGain);
        source.start(0);
        return;
    }

    // miss — synthesized (no MP3 file)
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(masterGain);
    osc.frequency.value = 200;
    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
}

// ===== CURSOR AUTO-HIDE =====
let cursorTimer = null;

function onMouseMove() {
    document.body.classList.remove('cursor-idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
        document.body.classList.add('cursor-idle');
    }, 2000);
}

document.addEventListener('mousemove', onMouseMove);
document.body.classList.add('cursor-idle'); // hidden by default

// ===== INPUT =====
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();

        if (gameState.isGameOver) {
            startNewGame();
        } else if (!gameState.isRunning) {
            startNewGame();
        } else {
            checkInput();
        }
    }
});

// ===== GAME LOOP =====
function gameLoop() {
    render();
    requestAnimationFrame(gameLoop);
}

// ===== INITIALIZATION =====
updateUI();
gameLoop();
loadSoundBuffers();
document.getElementById('muteBtn').addEventListener('click', toggleMute);

console.log('Game initialized. Press SPACE to start.');
