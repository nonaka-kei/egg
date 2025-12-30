/**
 * Egg Game - Core Logic & UI Controller
 */

/* --- CONSTANTS & CONFIG --- */
const CONFIG = {
    MAX_HP: 5,
    EGG_TIMER: 2, // Explodes after 2 turns (end of N+2)
    SAUSAGE_LIMIT: 2
};

const MOVES = {
    ATTACK: 'attack',
    EGG: 'egg',
    SAUSAGE: 'sausage',
    BARRIER: 'barrier'
};

/* --- STATE MANAGEMENT --- */
class PlayerState {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.hp = CONFIG.MAX_HP;
        this.eggs = []; // Array of { turnsRemaining: number, isReflected: boolean }
        this.history = []; // History of moves
        this.isDead = false;
    }

    addEgg(isReflected = false) {
        // Rule: If already has egg, instant death
        if (this.eggs.length > 0) {
            this.hp = 0;
            this.isDead = true;
            return true; // Exploded
        }
        this.eggs.push({ turnsRemaining: CONFIG.EGG_TIMER, isReflected });
        return false;
    }

    removeEgg(onlyCurable = true) {
        if (this.eggs.length === 0) return false;

        // Filter out uncurable eggs if specified
        // FIX: Also filter out "New" eggs (those just applied this turn, i.e., turnsRemaining == CONFIG.EGG_TIMER)
        // Sausage only cures "Existing" status.
        const curableEggs = this.eggs.filter(e => {
            if (onlyCurable && e.isReflected) return false;
            // Note: In resolveTurn, we decrement turns AFTER interaction. 
            // So a new egg has turnsRemaining == 2. Old eggs have < 2.
            if (e.turnsRemaining === CONFIG.EGG_TIMER) return false;
            return true;
        });

        if (curableEggs.length === 0) return false;

        // Remove ALL curable old eggs (usually just 1)
        this.eggs = this.eggs.filter(e => !curableEggs.includes(e));
        return true;
    }

    updateEggs() {
        // Decrease timer
        this.eggs.forEach(egg => egg.turnsRemaining--);

        // Check explosion
        const exploded = this.eggs.some(egg => egg.turnsRemaining < 0);
        if (exploded) {
            this.hp = 0;
            this.isDead = true;
        }
        return exploded;
    }

    canUseSausage() {
        if (this.history.length < CONFIG.SAUSAGE_LIMIT) return true;
        // Check last N moves
        const lastMoves = this.history.slice(-CONFIG.SAUSAGE_LIMIT);
        return !lastMoves.every(m => m === MOVES.SAUSAGE);
    }
}

class GameEngine {
    constructor() {
        this.player = new PlayerState('player', 'You');
        this.opponent = new PlayerState('opponent', 'CPU');
        this.turn = 1;
        this.isGameOver = false;
        this.logs = [];
        this.onStateChange = null; // Callback for UI
    }

    log(message) {
        this.logs.push(message);
        if (this.onStateChange) this.onStateChange('log', message);
    }

    // Main Turn Resolution
    resolveTurn(playerMove) {
        if (this.isGameOver) return;

        // 1. CPU Move
        const opponentMove = this.decideCpuMove();

        this.log(`--- Turn ${this.turn} ---`);
        this.log(`You: [${playerMove.toUpperCase()}] vs CPU: [${opponentMove.toUpperCase()}]`);

        // Record history
        this.player.history.push(playerMove);
        this.opponent.history.push(opponentMove);

        // 2. Resolve Interactions
        this.resolveInteraction(this.player, playerMove, this.opponent, opponentMove);
        this.resolveInteraction(this.opponent, opponentMove, this.player, playerMove);

        // 3. Process End of Turn (Egg Timers & Death Checks)
        this.processEndOfTurn();

        // 4. Update UI
        if (this.onStateChange) this.onStateChange('update');

        this.turn++;
    }

    decideCpuMove() {
        // Simple AI for now
        const availableMoves = Object.values(MOVES);
        // Filter sausage if limit reached
        if (!this.opponent.canUseSausage()) {
            const idx = availableMoves.indexOf(MOVES.SAUSAGE);
            if (idx > -1) availableMoves.splice(idx, 1);
        }
        return availableMoves[Math.floor(Math.random() * availableMoves.length)];
    }

    /*
     * Resolves action of Attacker vs Defender
     * Note: Since moves are simultaneous, we call this twice:
     * once for P1 acting on P2, and once for P2 acting on P1.
     * BUT we need to be careful with "Reflect" logic.
     * 
     * Better approach: Handle pairs strictly.
     */
    resolveInteraction(p1, m1, p2, m2) {
        // We only care about P1's offensive actions impacting P2 here.
        // Or specific self-actions like curing.

        // -- P1 USES ATTACK --
        if (m1 === MOVES.ATTACK) {
            if (m2 === MOVES.SAUSAGE) {
                // P2 Reflects Attack?
                // Rule: "Sausage reflects attack"
                // EXCEPTION: If P2 has Egg, Sausage cures Egg but CANNOT reflect attack.
                if (p2.eggs.length > 0) {
                    this.log(`${p2.name} uses Sausage! It cures their Egg, but they take damage!`);
                    p2.removeEgg();
                    p2.hp -= 1;
                } else {
                    this.log(`${p2.name} Reflects the Attack with Sausage! ${p1.name} takes damage!`);
                    p1.hp -= 1;
                }
            } else if (m2 === MOVES.BARRIER) {
                // Barrier fails vs Attack
                this.log(`${p2.name}'s Barrier failed! Hit by Attack.`);
                p2.hp -= 1;
            } else {
                // Direct Hit (vs Attack or Egg)
                this.log(`${p1.name} Attacks! ${p2.name} takes damage.`);
                p2.hp -= 1;
            }
        }

        // -- P1 USES EGG --
        else if (m1 === MOVES.EGG) {
            if (m2 === MOVES.BARRIER) {
                // Barrier Reflects Egg
                this.log(`${p2.name}'s Barrier reflects the Egg! ${p1.name} receives an Uncurable Egg!`);
                const instantDeath = p1.addEgg(true); // Reflected egg is uncurable
                if (instantDeath) this.log(`${p1.name} already had an Egg! DOUBLE EGG!`);
            } else if (m2 === MOVES.SAUSAGE) {
                // Sausage vs New Egg
                // Rule: Sausage DOES NOT stop new egg.
                // FIX: It MIGHT cure an OLD egg first. 
                // We must check and cure OLD egg before adding NEW egg to prevent Death.
                const cured = p2.removeEgg(true);
                if (cured) this.log(`${p2.name} ate a Sausage and cured their Old Egg!`);

                this.log(`${p1.name} plants an Egg on ${p2.name}!`);
                const instant = p2.addEgg();
                if (instant) this.log(`${p2.name} already had an Egg! DOUBLE EGG!`);
            } else {
                // Vs Attack or Egg
                this.log(`${p1.name} plants an Egg on ${p2.name}!`);
                const instant = p2.addEgg();
                if (instant) this.log(`${p2.name} already had an Egg! DOUBLE EGG!`);
            }
        }

        // -- P1 USES SAUSAGE (Self-Cure part) --
        /* 
           We need to be careful not to double-count.
           Sausage Reflect logic is handled in "P2 Attacks" block.
           Here we handle the "Cure" aspect.
        */
        if (m1 === MOVES.SAUSAGE) {
            // Try to cure self
            // Note: If we were attacked, we might have reflected it (handled above).
            // If we had an egg, we cure it.
            // Special case: If we are HOLDING an egg, Sausage ALWAYS cures it.
            // Even if we fail to reflect an attack (handled above), the CURE still happens?
            // Rule: "Sausage... Cures Egg (at this time attack is not returned)".
            // This implies Cure happens.

            // So, unconditionally try to cure if we used Sausage.
            // Wait, if it was a Barrier Reflected egg, we can't cure it.
            const cured = p1.removeEgg(true);
            if (cured) this.log(`${p1.name} ate a Sausage and cured their Egg!`);
        }
    }

    processEndOfTurn() {
        // Update Eggs (Timer tick)
        if (this.player.updateEggs()) this.log(`${this.player.name}'s Egg EXPLODED!`);
        if (this.opponent.updateEggs()) this.log(`${this.opponent.name}'s Egg EXPLODED!`);

        // Check HP
        if (this.player.hp <= 0 && this.opponent.hp <= 0) {
            // Sudden Death
            this.log("DOUBLE KO! Sudden Death triggered! Setting HP to 1.");
            this.player.hp = 1;
            this.opponent.hp = 1;
            this.player.eggs = [];
            this.opponent.eggs = [];
            this.player.isDead = false;
            this.opponent.isDead = false;
        } else if (this.player.hp <= 0) {
            this.isGameOver = true;
            this.log("You Lost! Game Over.");
            if (this.onStateChange) this.onStateChange('gameover', 'lose');
        } else if (this.opponent.hp <= 0) {
            this.isGameOver = true;
            this.log("You Won! Game Over.");
            if (this.onStateChange) this.onStateChange('gameover', 'win');
        }
    }
}

/* --- UI CONTROLLER --- */
const engine = new GameEngine();

const UI = {
    els: {
        playerHpBar: document.getElementById('player-hp-bar'),
        playerHpText: document.getElementById('player-hp-text'),
        opponentHpBar: document.getElementById('opponent-hp-bar'),
        opponentHpText: document.getElementById('opponent-hp-text'),
        playerStatus: document.getElementById('player-status'),
        opponentStatus: document.getElementById('opponent-status'),
        gameLog: document.getElementById('game-log'),
        buttons: document.querySelectorAll('.action-btn'),
        turnIndicator: document.getElementById('turn-indicator'),
        playerMove: document.getElementById('player-move'),
        opponentMove: document.getElementById('opponent-move'),
        stateMessage: document.getElementById('state-message')
    },

    init() {
        // Bind Buttons
        UI.els.buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (engine.isGameOver) {
                    location.reload(); // Quick restart
                    return;
                }
                const action = btn.dataset.action;

                // Validate Sausage limit
                if (action === MOVES.SAUSAGE && !engine.player.canUseSausage()) {
                    UI.logSystem("Overate sausages! Cannot use more than 2 in a row.");
                    return;
                }

                UI.els.buttons.forEach(b => b.disabled = true);

                // Reveal Animation Flow
                UI.playRound(action);
            });
        });

        // Link Engine
        engine.onStateChange = (type, data) => {
            if (type === 'log') UI.logSystem(data);
            if (type === 'update') UI.render();
            if (type === 'gameover') UI.handleGameOver(data);
        };

        UI.render();
    },

    async playRound(playerAction) {
        // 1. Show Player Move Placeholder
        UI.els.playerMove.textContent = "?";
        UI.els.playerMove.classList.add('anim-pop');

        // Short delay for tension
        await new Promise(r => setTimeout(r, 500));

        // 2. Resolve Logic
        engine.resolveTurn(playerAction);

        // 3. Reveal Moves (Visuals)
        const lastP = engine.player.history[engine.player.history.length - 1];
        const lastO = engine.opponent.history[engine.opponent.history.length - 1];

        UI.els.playerMove.innerHTML = UI.getIcon(lastP); // textContent vs innerHTML for emoji
        UI.els.opponentMove.innerHTML = UI.getIcon(lastO);

        // Re-enable buttons if game not over
        if (!engine.isGameOver) {
            UI.updateButtonStates();
        }
    },

    getIcon(move) {
        switch (move) {
            case MOVES.ATTACK: return '⚔️';
            case MOVES.EGG: return '🥚';
            case MOVES.SAUSAGE: return '🌭';
            case MOVES.BARRIER: return '🛡️';
            default: return '?';
        }
    },

    logSystem(msg) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = msg;
        UI.els.gameLog.prepend(div);
    },

    render() {
        // HP
        UI.updateHp(UI.els.playerHpBar, UI.els.playerHpText, engine.player.hp);
        UI.updateHp(UI.els.opponentHpBar, UI.els.opponentHpText, engine.opponent.hp);

        // Status
        UI.renderStatus(UI.els.playerStatus, engine.player);
        UI.renderStatus(UI.els.opponentStatus, engine.opponent);

        // Turn
        UI.els.turnIndicator.textContent = `Turn ${engine.turn}`;
    },

    updateHp(bar, text, hp) {
        const pct = (hp / CONFIG.MAX_HP) * 100;
        bar.style.width = `${pct}%`;
        text.textContent = `${hp}/${CONFIG.MAX_HP}`;

        // Reset classes to ensure animation triggers if needed (simplified)
        bar.className = 'health-fill';
        void bar.offsetWidth; // Trigger reflow
        if (hp <= 2) bar.classList.add('low');
        if (hp <= 1) bar.classList.add('critical');
    },

    renderStatus(container, player) {
        container.innerHTML = '';
        player.eggs.forEach(egg => {
            const div = document.createElement('div');
            div.className = 'status-icon';
            div.innerHTML = '🥚';

            const badge = document.createElement('div');
            badge.className = 'status-badge';
            badge.textContent = egg.turnsRemaining + 1; // +1 because it explodes at END of 0

            div.appendChild(badge);
            container.appendChild(div);
        });
    },

    updateButtonStates() {
        UI.els.buttons.forEach(btn => {
            btn.disabled = false;
            if (btn.dataset.action === MOVES.SAUSAGE && !engine.player.canUseSausage()) {
                btn.disabled = true;
            }
        });
    },

    handleGameOver(result) {
        UI.els.stateMessage.textContent = result === 'win' ? "VICTORY!" : "DEFEAT";
        const restartBtn = document.createElement('button');
        restartBtn.className = 'action-btn';
        restartBtn.textContent = "Play Again";
        restartBtn.style.gridColumn = "span 2";
        restartBtn.onclick = () => location.reload();

        const controls = document.querySelector('.action-buttons');
        controls.innerHTML = '';
        controls.appendChild(restartBtn);
    }
};

// Start
document.addEventListener('DOMContentLoaded', UI.init);
