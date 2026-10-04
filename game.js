// DBD Skill Check Game - Phase 1
// Build order: 1. Static render → 2. Animation → 3. Input → 4. Hit/miss states → 5. Score/combo → 6. Speed scaling → 7. Game over → 8. High score → 9. Deploy

// ===== CONSTANTS (tune these to feel) =====
const CONFIG = {
    rotationPeriod: 1200,        // ms for full rotation (~1.2s)
    speedupRate: 0.05,           // 5% faster every speedup interval
    speedupInterval: 5,          // hits before speeding up
    successArcWidth: 55,         // degrees - the "good" zone
    greatZoneWidth: 10,          // degrees - leading edge (bonus zone)
    arcMinLead: 120,             // degrees - earliest arc start, clockwise from 12 o'clock
    arcEndMargin: 20,            // degrees - arc must end this far before returning to 12 o'clock
    stormZoneWidth: 35,          // degrees - Merciless Storm's smaller hollow zone
    missPauseLimit: 5,           // consecutive misses before the game pauses (player is AFK)
    defaultRadius: 150,          // px - ring radius until the size slider is moved
    minRadius: 60,               // px - smallest ring the size slider allows
    maxRadius: 250,              // px - largest ring the size slider allows
    defaultVolume: 50,           // % - volume until the volume slider is moved (100% = full master gain)
    soundPeakDb: -15,            // dBFS - every sound effect is peak-normalized to this level
    madnessOffsetX: 3,           // Madness: max horizontal jump from screen center, in ring radii
    madnessOffsetY: 1.5,         // Madness: max vertical jump from screen center, in ring radii
    hintPlayingOpacity: 0.25,    // SPACE key hint opacity while a game is being played
    ringFlashDuration: 1000,     // ms the ring stays tinted after a hit or miss, fading out at the end
    ringFlashFade: 300,          // ms of that duration spent fading back to the normal ring
    scoreGood: 100,
    scoreGreat: 250,
    maxMultiplier: 5,
};

// ===== SETTINGS (all remembered between visits; the modes are off by default) =====
// mercilessStorm: killer perk - random arc anywhere, smaller hollow zone
// madness: Doctor's Madness - the skill check jumps around the screen
// effects: ring tint and sparks after each check (the one setting that is on by default)
// radius: ring size in px, from the size slider
const settings = {
    mercilessStorm: localStorage.getItem('skillCheckMercilessStorm') === 'true',
    madness: localStorage.getItem('skillCheckMadness') === 'true',
    effects: localStorage.getItem('skillCheckEffects') !== 'false',
    radius: CONFIG.defaultRadius,
};

const savedRadius = Number(localStorage.getItem('skillCheckRadius'));
if (savedRadius >= CONFIG.minRadius && savedRadius <= CONFIG.maxRadius) settings.radius = savedRadius;

// volume: 0-100 from the volume slider, used as the master gain / 100
settings.volume = CONFIG.defaultVolume;
const savedVolume = localStorage.getItem('skillCheckVolume');
if (savedVolume !== null && savedVolume !== '' && Number(savedVolume) >= 0 && Number(savedVolume) <= 100) {
    settings.volume = Number(savedVolume);
}

// ===== GAME STATE =====
const gameState = {
    isRunning: false,
    isPaused: false,             // too many misses in a row
    score: 0,
    combo: 0,
    bestStreak: Number(localStorage.getItem('skillCheckBestStreak')) || 0,
    misses: 0,                   // total misses this session
    missStreak: 0,               // consecutive misses
    currentSpeed: 1,             // multiplier on rotation speed
    checkCount: 0,               // greats since last speed increase
    lastCheckTime: 0,
    ringFlash: null,             // { result: 'good' | 'great' | 'miss', time } - tints the ring after a check
    checkActive: true,
    canInput: true,
};

// ===== CANVAS SETUP =====
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Skill check position — screen center plus an offset that Madness randomizes per check
const skillCheckPos = { x: 0, y: 0 };
const skillCheckOffset = { x: 0, y: 0 };

const GAME = {
    radius: 0,
    pointerLength: { inner: 0, outer: 0 },
    successArc: null,
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Keeps a position inside [margin, size - margin]; centers it if the check can't fit at all
function clampToScreen(value, size, margin) {
    if (size < margin * 2) return size / 2;
    return clamp(value, margin, size - margin);
}

function recalcConstants() {
    // Keep the whole check, pointer tip included, on screen
    const margin = GAME.pointerLength.outer + 10;
    skillCheckPos.x = clampToScreen(canvas.width / 2 + skillCheckOffset.x, canvas.width, margin);
    skillCheckPos.y = clampToScreen(canvas.height / 2 + skillCheckOffset.y, canvas.height, margin);
}

// Everything that scales with the ring derives from the radius here
function setRadius(radius) {
    GAME.radius = radius;
    GAME.pointerLength.inner = radius * 0.55;
    GAME.pointerLength.outer = radius * 1.45;
    recalcConstants();
}

// Ring-relative scale for strokes and the key hint (1 at the default size)
function sizeScale() {
    return GAME.radius / CONFIG.defaultRadius;
}

function randomizeCheckPosition() {
    skillCheckOffset.x = settings.madness ? (Math.random() * 2 - 1) * CONFIG.madnessOffsetX * GAME.radius : 0;
    skillCheckOffset.y = settings.madness ? (Math.random() * 2 - 1) * CONFIG.madnessOffsetY * GAME.radius : 0;
    recalcConstants();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    recalcConstants();
}

setRadius(settings.radius);
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ===== SKILL CHECK LOGIC =====

// Angles are degrees clockwise from 12 o'clock, matching DBD: the pointer
// always starts at 0 and the arc never wraps past 360.
// Normal: arc is placed ahead of the pointer so there's always reaction time.
// Merciless Storm: arc can be anywhere, even under the pointer, and is a smaller hollow zone.
// The arc remembers which mode made it, so toggling mid-check only affects the next check.
function createNewCheck() {
    const storm = settings.mercilessStorm;
    const width = storm ? CONFIG.stormZoneWidth : CONFIG.successArcWidth;
    const minStart = storm ? 0 : CONFIG.arcMinLead;
    const maxStart = 360 - (storm ? 0 : CONFIG.arcEndMargin) - width;
    const arcStartAngle = minStart + Math.random() * (maxStart - minStart);

    GAME.successArc = {
        start: arcStartAngle,
        end: arcStartAngle + width,
        greatEnd: storm ? null : arcStartAngle + CONFIG.greatZoneWidth, // storm zone has no great notch
        storm,
    };

    randomizeCheckPosition();
    gameState.checkActive = true;
    gameState.canInput = true;
    gameState.lastCheckTime = Date.now();
    playSound('checkStart');
}

// Unwrapped: keeps growing past 360 so the loop can detect a missed check
function getPointerAngle() {
    const elapsed = Date.now() - gameState.lastCheckTime;
    const rotationSpeed = (360 / CONFIG.rotationPeriod) * gameState.currentSpeed;
    return elapsed * rotationSpeed;
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

    // Check if in great zone (Merciless Storm has none; any hit there is a good)
    if (arc.greatEnd !== null && isAngleInArc(pointerAngle, arc.start, arc.greatEnd)) {
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

function flashRing(result) {
    if (!settings.effects) return;
    gameState.ringFlash = { result, time: Date.now() };
    spawnSparks(result);
}

function registerHit() {
    gameState.combo++;
    gameState.missStreak = 0;

    if (gameState.combo > gameState.bestStreak) {
        gameState.bestStreak = gameState.combo;
        localStorage.setItem('skillCheckBestStreak', gameState.bestStreak);
    }
}

function onGoodHit() {
    const multiplier = Math.min(gameState.combo / 10, CONFIG.maxMultiplier);
    const points = CONFIG.scoreGood * multiplier;

    gameState.score += points;
    registerHit();

    flashRing('good');
    playSound('good');
    updateUI();

    createNewCheck();
}

function onGreatHit() {
    const multiplier = Math.min(gameState.combo / 10, CONFIG.maxMultiplier);
    const points = CONFIG.scoreGreat * multiplier;

    gameState.score += points;
    registerHit();
    gameState.checkCount++;

    flashRing('great');
    playSound('great');

    if (gameState.checkCount >= CONFIG.speedupInterval) {
        gameState.currentSpeed *= (1 + CONFIG.speedupRate);
        gameState.checkCount = 0;
    }

    updateUI();

    createNewCheck();
}

function onMiss() {
    gameState.combo = 0;
    gameState.checkActive = false;

    flashRing('miss');
    playSound('miss');

    // This is practice: a miss is counted and the next check starts. There is no game over;
    // only a run of misses (the player is AFK) stops the game.
    gameState.misses++;
    gameState.missStreak++;
    updateUI();

    if (gameState.missStreak >= CONFIG.missPauseLimit) {
        pauseGame();
    } else {
        createNewCheck();
    }
}

// Stops the check spinning when the player has walked away
function pauseGame() {
    gameState.isPaused = true;
    gameState.checkActive = false;
    gameState.canInput = false;
    document.getElementById('pauseScreen').classList.remove('hidden');
}

function resumeGame() {
    gameState.isPaused = false;
    gameState.missStreak = 0;
    document.getElementById('pauseScreen').classList.add('hidden');
    createNewCheck();
}

function startNewGame() {
    gameState.isRunning = true;
    gameState.isPaused = false;
    gameState.score = 0;
    gameState.combo = 0;
    gameState.misses = 0;
    gameState.missStreak = 0;
    gameState.currentSpeed = 1;
    gameState.checkCount = 0;

    document.getElementById('pauseScreen').classList.add('hidden');
    updateUI();

    createNewCheck();
}

// ===== UI UPDATES =====
function updateUI() {
    document.getElementById('streakValue').textContent = gameState.combo;
    document.getElementById('bestStreakValue').textContent = gameState.bestStreak;
    document.getElementById('missValue').textContent = gameState.misses;
}

// ===== SETTING TOGGLES =====
const toggleButtons = [
    { id: 'stormBtn', setting: 'mercilessStorm', storageKey: 'skillCheckMercilessStorm', label: 'Merciless Storm' },
    { id: 'madnessBtn', setting: 'madness', storageKey: 'skillCheckMadness', label: 'Madness' },
    { id: 'effectsBtn', setting: 'effects', storageKey: 'skillCheckEffects', label: 'Effects' },
];

function refreshToggleButtons() {
    for (const { id, setting, label } of toggleButtons) {
        const button = document.getElementById(id);
        button.querySelector('.label').textContent = `${label}: ${settings[setting] ? 'On' : 'Off'}`;
        button.classList.toggle('on', settings[setting]);
        button.setAttribute('aria-pressed', settings[setting]);
    }
}

// Resizing mid-check is safe: the check only stores angles, never pixel positions
function onSizeInput(e) {
    settings.radius = Number(e.target.value);
    localStorage.setItem('skillCheckRadius', settings.radius);
    setRadius(settings.radius);
}

// Changes apply from the next check, so a toggle never alters the one in flight
function onToggle(setting, storageKey) {
    settings[setting] = !settings[setting];
    localStorage.setItem(storageKey, settings[setting]);

    if (!settings.madness) randomizeCheckPosition(); // recenter right away
    if (!settings.effects) {
        // turning effects off also clears whatever is mid-flight
        sparks.length = 0;
        gameState.ringFlash = null;
    }
    refreshToggleButtons();
    updateUI();
}

// ===== RENDERING =====
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawRing();

    const isPlaying = gameState.isRunning && !gameState.isPaused;

    // Key hint: full opacity until the player starts, then faded so it doesn't distract.
    // Hidden while paused so it doesn't sit under the pause text.
    if (!gameState.isPaused) drawKeyHint(isPlaying ? CONFIG.hintPlayingOpacity : 1);

    if (isPlaying && GAME.successArc) {
        const arc = GAME.successArc;
        if (arc.storm) {
            // Merciless Storm — hollow curved bar, no great notch
            drawHollowZone(arc.start, arc.end);
        } else {
            // Success arc — white block
            drawArc(arc.start, arc.end, '#ffffff', 8 * sizeScale());
            // Great zone — thicker notch at leading edge
            drawArc(arc.start, arc.greatEnd, '#ffffff', 14 * sizeScale());
        }
    }

    // Pointer
    if (isPlaying) {
        drawPointer();
    }

    drawSparks();
}

// ===== SPARKS =====
// Hits throw green streaks off the ring. A great bursts all the way round (plus extra
// at the hit point); a good is a smaller, dimmer puff at the hit point only. A miss gets
// a few small red ones where the pointer was.
// Sparks keep the position they spawned at, so they stay put when Madness moves the ring.
const SPARK_STYLES = {
    great: { color: '#6dff8a', glow: 18, ringCount: 40, hitCount: 14, hitSpread: 50,
             dist: [0.35, 0.9], life: [450, 800], width: [2.5, 4.5] },
    good:  { color: '#35c957', glow: 6,  ringCount: 0,  hitCount: 12, hitSpread: 40,
             dist: [0.15, 0.45], life: [300, 520], width: [1.5, 2.5] },
    miss:  { color: '#e02020', glow: 4,  ringCount: 0,  hitCount: 6,  hitSpread: 30,
             dist: [0.1, 0.3], life: [250, 420], width: [1.2, 2] },
};
const SPARK_TAIL = 0.14;             // how much of its flight a spark's streak trails behind it
const sparks = [];

function randomBetween([min, max]) {
    return min + Math.random() * (max - min);
}

function spawnSparks(result) {
    const style = SPARK_STYLES[result];
    const hitAngle = getPointerAngle();
    const scale = sizeScale();
    const now = Date.now();

    const add = (angleDeg) => {
        const rad = toCanvasRad(angleDeg);
        const dirRad = rad + (Math.random() - 0.5) * 0.5; // mostly straight out from the ring
        sparks.push({
            x: skillCheckPos.x + Math.cos(rad) * GAME.radius,
            y: skillCheckPos.y + Math.sin(rad) * GAME.radius,
            dirX: Math.cos(dirRad),
            dirY: Math.sin(dirRad),
            dist: randomBetween(style.dist) * GAME.radius,
            life: randomBetween(style.life),
            width: randomBetween(style.width) * scale,
            born: now,
            style,
        });
    };

    for (let i = 0; i < style.ringCount; i++) add(Math.random() * 360);
    for (let i = 0; i < style.hitCount; i++) add(hitAngle + (Math.random() * 2 - 1) * style.hitSpread);
}

// Position is a pure function of age (ease-out), so there's nothing to step per frame
function drawSparks() {
    const now = Date.now();
    ctx.save();
    ctx.lineCap = 'round';

    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const progress = (now - s.born) / s.life;
        if (progress >= 1) {
            sparks.splice(i, 1);
            continue;
        }
        if (progress < 0) continue;

        const travel = (p) => s.dist * (1 - (1 - p) * (1 - p));
        const head = travel(progress);
        const tail = travel(Math.max(progress - SPARK_TAIL, 0));

        ctx.globalAlpha = 1 - progress * progress; // stays bright, then drops off
        ctx.strokeStyle = s.style.color;
        ctx.lineWidth = s.width * (1 - progress * 0.5);
        ctx.shadowColor = s.style.color;
        ctx.shadowBlur = s.style.glow;
        ctx.beginPath();
        ctx.moveTo(s.x + s.dirX * tail, s.y + s.dirY * tail);
        ctx.lineTo(s.x + s.dirX * head, s.y + s.dirY * head);
        ctx.stroke();
    }
    ctx.restore();
}

const RING_FLASH_STYLES = {
    miss:  { color: '#e02020', glow: 0 },
    good:  { color: '#35c957', glow: 0 },
    great: { color: '#6dff8a', glow: 24 },
};

// Grey ring, tinted red/green over the last check's result: solid, then fading out
function drawRing() {
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(skillCheckPos.x, skillCheckPos.y, GAME.radius, 0, Math.PI * 2);
    ctx.stroke();

    const flash = gameState.ringFlash;
    if (!flash) return;

    const age = Date.now() - flash.time;
    if (age >= CONFIG.ringFlashDuration) {
        gameState.ringFlash = null;
        return;
    }

    const fadeStart = CONFIG.ringFlashDuration - CONFIG.ringFlashFade;
    const strength = age <= fadeStart ? 1 : (CONFIG.ringFlashDuration - age) / CONFIG.ringFlashFade;
    const style = RING_FLASH_STYLES[flash.result];

    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 3 * sizeScale();
    if (style.glow) {
        ctx.shadowColor = style.color;
        ctx.shadowBlur = style.glow * sizeScale();
    }
    ctx.beginPath();
    ctx.arc(skillCheckPos.x, skillCheckPos.y, GAME.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

// DBD-style key prompt in the middle of the ring
function drawKeyHint(opacity) {
    const scale = sizeScale();
    const width = 110 * scale;
    const height = 34 * scale;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(skillCheckPos.x - width / 2, skillCheckPos.y - height / 2, width, height, 8 * scale);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(16 * scale)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPACE', skillCheckPos.x, skillCheckPos.y + 1);
    ctx.restore();
}

// Outlined curved rectangle: two thin arcs either side of the ring plus end caps, no fill
function drawHollowZone(startDeg, endDeg) {
    const half = GAME.radius * 0.08;
    const inner = GAME.radius - half;
    const outer = GAME.radius + half;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    for (const r of [inner, outer]) {
        ctx.beginPath();
        ctx.arc(skillCheckPos.x, skillCheckPos.y, r, toCanvasRad(startDeg), toCanvasRad(endDeg));
        ctx.stroke();
    }

    ctx.beginPath();
    for (const deg of [startDeg, endDeg]) {
        const rad = toCanvasRad(deg);
        ctx.moveTo(skillCheckPos.x + Math.cos(rad) * inner, skillCheckPos.y + Math.sin(rad) * inner);
        ctx.lineTo(skillCheckPos.x + Math.cos(rad) * outer, skillCheckPos.y + Math.sin(rad) * outer);
    }
    ctx.stroke();
}

// Game angles are clockwise from 12 o'clock; canvas angles start at 3 o'clock
function toCanvasRad(deg) {
    return ((deg - 90) * Math.PI) / 180;
}

function drawArc(startDeg, endDeg, color, lineWidth) {
    const startRad = toCanvasRad(startDeg);
    const endRad = toCanvasRad(endDeg);

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(skillCheckPos.x, skillCheckPos.y, GAME.radius, startRad, endRad);
    ctx.stroke();
}

function drawPointer() {
    const rad = toCanvasRad(getPointerAngle());

    // Short tick straddling the ring, like DBD's pointer
    const startX = skillCheckPos.x + Math.cos(rad) * GAME.pointerLength.inner;
    const startY = skillCheckPos.y + Math.sin(rad) * GAME.pointerLength.inner;
    const endX = skillCheckPos.x + Math.cos(rad) * GAME.pointerLength.outer;
    const endY = skillCheckPos.y + Math.sin(rad) * GAME.pointerLength.outer;

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
masterGain.connect(audioContext.destination);

let isMuted = false;

// The one place master gain is set, so mute and the volume slider can't disagree
function applyVolume() {
    masterGain.gain.value = isMuted ? 0 : settings.volume / 100;
}

applyVolume();

function toggleMute() {
    isMuted = !isMuted;
    applyVolume();
    document.getElementById('muteBtn').textContent = isMuted ? 'Unmute' : 'Mute';
}

function onVolumeInput(e) {
    settings.volume = Number(e.target.value);
    localStorage.setItem('skillCheckVolume', settings.volume);
    applyVolume();
}

const soundBuffers = {
    checkStart: null,
    good: null,
    great: null,
};

// Per-sound gain that brings each clip's loudest sample to CONFIG.soundPeakDb
const soundTrim = {};
const SOUND_PEAK = Math.pow(10, CONFIG.soundPeakDb / 20);

function peakTrim(buffer) {
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        for (const sample of buffer.getChannelData(c)) {
            peak = Math.max(peak, Math.abs(sample));
        }
    }
    return peak > 0 ? SOUND_PEAK / peak : 1;
}

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
            const buffer = await audioContext.decodeAudioData(arrayBuffer);
            soundTrim[key] = peakTrim(buffer);
            soundBuffers[key] = buffer;
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
        const trim = audioContext.createGain();
        trim.gain.value = soundTrim[type];
        source.connect(trim);
        trim.connect(masterGain);
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
    gain.gain.setValueAtTime(SOUND_PEAK, now); // oscillator peaks at 1, so this is its peak level
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
        if (e.repeat) return; // held key would hit the fresh check at the 12 o'clock start

        if (gameState.isPaused) {
            resumeGame();
        } else if (!gameState.isRunning) {
            startNewGame();
        } else {
            checkInput();
        }
    }
});

// ===== GAME LOOP =====
function gameLoop() {
    // Pointer passed the end of the arc without input = miss
    if (gameState.isRunning && gameState.checkActive && gameState.canInput &&
        getPointerAngle() > GAME.successArc.end) {
        gameState.canInput = false;
        onMiss();
    }

    render();
    requestAnimationFrame(gameLoop);
}

// ===== INITIALIZATION =====
refreshToggleButtons();
updateUI();
gameLoop();
loadSoundBuffers();
document.getElementById('muteBtn').addEventListener('click', toggleMute);
for (const { id, setting, storageKey } of toggleButtons) {
    document.getElementById(id).addEventListener('click', () => onToggle(setting, storageKey));
}
const sizeSlider = document.getElementById('sizeSlider');
sizeSlider.min = CONFIG.minRadius;
sizeSlider.max = CONFIG.maxRadius;
sizeSlider.value = settings.radius;
sizeSlider.addEventListener('input', onSizeInput);

const volumeSlider = document.getElementById('volumeSlider');
volumeSlider.value = settings.volume;
volumeSlider.addEventListener('input', onVolumeInput);

// A focused control would also react to SPACE, so drop focus after every click or slider release
document.querySelectorAll('#controls button').forEach((button) => {
    button.addEventListener('click', () => button.blur());
});
sizeSlider.addEventListener('change', () => sizeSlider.blur());
volumeSlider.addEventListener('change', () => volumeSlider.blur());

console.log('Game initialized. Press SPACE to start.');
