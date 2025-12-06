import { state, localPlayer } from './game.js';
import { CONFIG, MAP_DATA } from './config.js';
import { triggerHit } from './game.js';

export function spawnProjectile(x, y, dx, dy, ownerId) {
    // Life is now in seconds (0.5s)
    state.projectiles.push({ x, y, dx, dy, ownerId, life: 0.5 });
}

export function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const p = state.projectiles[i];
        p.x += p.dx * CONFIG.PROJECTILE_SPEED * dt;
        p.y += p.dy * CONFIG.PROJECTILE_SPEED * dt;
        p.life -= dt;

        // Wall collision
        const gx = Math.floor(p.x);
        const gy = Math.floor(p.y);
        const gateX = Math.floor(CONFIG.GRID_W / 2);
        const gateY = Math.floor(CONFIG.GRID_H / 2);
        const isGate = (gx === gateX && (gy === 0 || gy === CONFIG.GRID_H - 1)) || 
                       (gy === gateY && (gx === 0 || gx === CONFIG.GRID_W - 1));

        if (gx >= 0 && gx < CONFIG.GRID_W && gy >= 0 && gy < CONFIG.GRID_H) {
            if (MAP_DATA[gy][gx] === 1 && !isGate) p.life = 0;
        }

        // Entity Collision
        if (p.life > 0) {
            const hitRadius = 0.5; // Roughly the character size

            // 1. Check Local Player
            // Avoid hitting self immediately if we just shot it (ownerId check)
            // But usually in spawn we want to see effects. 
            // However, usually you don't hit yourself.
            if (p.ownerId !== state.myId) {
                const dx = localPlayer.x - p.x;
                const dy = localPlayer.y - p.y;
                if (dx*dx + dy*dy < hitRadius*hitRadius) {
                    triggerHit(localPlayer, p.dx, p.dy);
                    p.life = 0;
                }
            }

            // 2. Check NPCs
            if (p.life > 0) {
                for (const npc of state.npcs) {
                    const dx = npc.x - p.x;
                    const dy = npc.y - p.y;
                    if (dx*dx + dy*dy < hitRadius*hitRadius) {
                        triggerHit(npc, p.dx, p.dy);
                        p.life = 0;
                        break;
                    }
                }
            }

            // 3. Check Other Players
            if (p.life > 0) {
                for (const id in state.players) {
                    // state.players only contains others
                    if (id === p.ownerId) continue; // Don't hit shooter
                    const target = state.players[id];
                    const dx = target.x - p.x;
                    const dy = target.y - p.y;
                    if (dx*dx + dy*dy < hitRadius*hitRadius) {
                        triggerHit(target, p.dx, p.dy);
                        p.life = 0;
                        break;
                    }
                }
            }
        }

        if (p.life <= 0) state.projectiles.splice(i, 1);
    }
}