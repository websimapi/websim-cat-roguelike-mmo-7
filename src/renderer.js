import { CONFIG, MAP_DATA } from './config.js';
import { ASSETS } from './assets.js';
import { drawCharacter } from './character-renderer.js';
import { drawWall, drawGateOverlay, getWallTopRenderInfo } from './wall-renderer.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // Shadow Buffer
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCtx = this.shadowCanvas.getContext('2d');

        // Reusable bucket arrays to reduce GC
        this.entitiesByRow = Array.from({ length: CONFIG.GRID_H }, () => []);
        
        this.cachedFloor = null;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        
        // Only force rotate for Phones (width < 760px in portrait), not Tablets
        const isPhonePortrait = h > w && w < 760;

        // When in phone portrait we rotate the game-container 90deg via CSS.
        // Make the canvas match the rotated landscape area (use the larger dimension as width).
        if (isPhonePortrait) {
            this.canvas.width = h;
            this.canvas.height = w;
        } else {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        // Resize shadow buffer
        this.shadowCanvas.width = this.canvas.width;
        this.shadowCanvas.height = this.canvas.height;

        this.ctx.imageSmoothingEnabled = false;
        
        // Invalidate floor cache on resize as tilesize might change (if we supported dynamic zoom, currently hardcoded scale)
        this.cachedFloor = null;
    }

    // Helper to convert grid coords to screen pixels
    gridToScreen(gx, gy, camX, camY) {
        const centerScreenX = this.canvas.width / 2;
        const centerScreenY = this.canvas.height / 2;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        const screenX = centerScreenX + (gx - camX) * tileSize;
        const screenY = centerScreenY + (gy - camY) * tileSize;
        
        return { x: screenX, y: screenY, size: tileSize };
    }

    render(gameState, localPlayerId, time) {
        const ctx = this.ctx;
        const { width, height } = this.canvas;
        
        // Clear
        ctx.clearRect(0, 0, width, height);

        if (!ASSETS.loaded) return;

        // Camera follows local player
        let camX = CONFIG.GRID_W / 2;
        let camY = CONFIG.GRID_H / 2;
        
        if (gameState.players[localPlayerId]) {
            const p = gameState.players[localPlayerId];
            camX = p.x;
            camY = p.y;
        }

        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;
        const gateX = 11; // 11th grid tile (Center of 23)

        // --- Day/Night Cycle Calc ---
        const dayProgress = (time % CONFIG.DAY_LENGTH) / CONFIG.DAY_LENGTH; // 0 to 1
        
        // Sun Elevation (-1 at midnight, 1 at noon)
        // 0.25 (Sunrise) -> 0
        // 0.50 (Noon) -> 1
        // 0.75 (Sunset) -> 0
        const elevation = Math.sin(dayProgress * Math.PI * 2 - Math.PI / 2);

        // Sun Azimuth (Rotation around Z)
        // 0.25 (Sunrise) -> East (PI)
        // 0.50 (Noon) -> South (3PI/2) -- shadows point North
        // 0.75 (Sunset) -> West (0)
        const sunAngle = (dayProgress - 0.25) * Math.PI * 2; 

        let shadowLen = 0;
        let shadowOpacity = 0;
        let ambientLight = 0.2; // Min brightness

        if (elevation > 0) {
            // Day
            shadowLen = 1.0 / Math.max(0.1, elevation);
            shadowLen = Math.min(shadowLen, 3.0); // Clamp length
            
            shadowOpacity = 0.4 * Math.min(1, elevation * 3); // Fade shadow near horizon
            
            // Brightness peaks at noon
            ambientLight = 0.2 + 0.8 * Math.sin(dayProgress * Math.PI); 
        }

        // Shadow Vector (Opposite to Sun)
        const shadowDir = sunAngle + Math.PI;
        const sx = Math.cos(shadowDir) * shadowLen;
        const sy = Math.sin(shadowDir) * shadowLen;

        // Clear buckets
        this.entitiesByRow.forEach(row => row.length = 0);

        // Helper to add entity to row bucket
        const addToBucket = (type, obj) => {
            const r = Math.floor(obj.y);
            if (r >= 0 && r < CONFIG.GRID_H) {
                this.entitiesByRow[r].push({ type, obj });
            }
        };

        // Add NPCs, Players, Projectiles
        gameState.npcs.forEach(npc => addToBucket('npc', npc));
        Object.values(gameState.players).forEach(p => addToBucket('player', p));
        gameState.projectiles.forEach(p => addToBucket('projectile', p));

        // Determine if local player is inside the north exit corridor
        let inNorthExit = false;
        const localPlayer = gameState.players[localPlayerId];
        if (localPlayer) {
            // Treat y < 1.5 as being in the north exit corridor region
            if (localPlayer.y < 1.5) {
                inNorthExit = true;
            }
        }

        // Create cached floor tile if needed
        if (!this.cachedFloor && ASSETS.loaded) {
            this.cachedFloor = document.createElement('canvas');
            this.cachedFloor.width = tileSize;
            this.cachedFloor.height = tileSize;
            const fCtx = this.cachedFloor.getContext('2d');
            const subSize = tileSize / 2;
            for (let oy = 0; oy < 2; oy++) {
                for (let ox = 0; ox < 2; ox++) {
                    fCtx.drawImage(ASSETS.floor, ox * subSize, oy * subSize, subSize, subSize);
                }
            }
        }

        // 1. Draw ALL Floors First (Background Layer)
        // This ensures floor exists under walls as requested
        const floorCullMarginX = tileSize * 2;
        const floorCullMarginY = tileSize * 2;
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            for (let x = 0; x < CONFIG.GRID_W; x++) {
                // Draw floor everywhere (including under the North Gate) as requested
                const pos = this.gridToScreen(x, y, camX, camY);
                // Cull off-screen with generous margin so tiles disappear later and reappear earlier
                if (
                    pos.x < -floorCullMarginX ||
                    pos.x > width + floorCullMarginX ||
                    pos.y < -floorCullMarginY ||
                    pos.y > height + floorCullMarginY
                ) continue;
                
                // Draw cached grass texture
                if (this.cachedFloor) {
                    this.ctx.drawImage(this.cachedFloor, pos.x, pos.y);
                }
            }
        }

        // 2. Draw Walls and Shop (Sorted by Row for correct occlusion)
        // NOTE: Character sprites are drawn in a separate pass AFTER shadows so they are never shadowed by themselves.
        
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            // A. Draw Shop (Base at row 3) - Drawn BEFORE Walls so Player stands in front later
            if (y === 3) {
                const shopPos = this.gridToScreen(3, 2, camX, camY);
                ctx.drawImage(ASSETS.shop, shopPos.x, shopPos.y, tileSize * 3, tileSize * 2);
            }

            // B. (Entities drawing moved to a later pass after shadows)

            // C. Draw Walls for this row - Drawn after floors/shop, before shadows
            //    Also draw South Vestibule interior pillars just before the bottom row walls
            if (y === CONFIG.GRID_H - 1) {
                // South exit interior arch walls should be behind the bottom boundary walls
                drawWall(this, gateX - 1, CONFIG.GRID_H, camX, camY);
                drawWall(this, gateX + 1, CONFIG.GRID_H, camX, camY);
            }

            // Draw North vestibule interior arch walls before top boundary walls for lower z-index
            if (y === 0) {
                const northGateX = Math.floor(CONFIG.GRID_W / 2);
                drawWall(this, northGateX - 1, 1, camX, camY);
                drawWall(this, northGateX + 1, 1, camX, camY);
            }

            for (let x = 0; x < CONFIG.GRID_W; x++) {
                if (MAP_DATA[y][x] === 1) {
                    const northGateX = Math.floor(CONFIG.GRID_W / 2);
                    const isNorthVestibulePillar =
                        (y === 1 && (x === northGateX - 1 || x === northGateX + 1));

                    // Skip north vestibule pillars here since they are drawn in the y===0 pass
                    if (isNorthVestibulePillar) continue;

                    drawWall(this, x, y, camX, camY);
                }
            }
        }

        // 3. Shadow Pass (Overlay)
        if (shadowOpacity > 0.01) {
            // Render shadows to offscreen buffer
            this.shadowCtx.clearRect(0, 0, width, height);
            
            // A. Draw Silhouettes (Black)
            this.shadowCtx.save();
            this.shadowCtx.fillStyle = '#000000';

            // 1. Draw Shop Shadow First
            const shopPos = this.gridToScreen(3, 2, camX, camY);
            this.shadowCtx.save();
            this.shadowCtx.translate(shopPos.x + tileSize * 1.5, shopPos.y + tileSize * 2);
            this.shadowCtx.transform(1, 0, -sx, -sy, 0, 0);
            this.shadowCtx.filter = 'brightness(0)';
            this.shadowCtx.drawImage(ASSETS.shop, -tileSize * 1.5, -tileSize * 2, tileSize * 3, tileSize * 2);
            this.shadowCtx.restore();

            // 2. Mask out the Shop Body (So the shop's own shadow doesn't cover the shop)
            // We use destination-out to erase the shadow buffer where the shop sprite sits
            this.shadowCtx.globalCompositeOperation = 'destination-out';
            this.shadowCtx.drawImage(ASSETS.shop, shopPos.x, shopPos.y, tileSize * 3, tileSize * 2);
            this.shadowCtx.globalCompositeOperation = 'source-over';

            // 3. Draw Entity Shadows (Drawn AFTER masking, so players CAN cast shadows onto the shop)
            const allEntities = [...gameState.npcs, ...Object.values(gameState.players)];
            allEntities.forEach(entity => {
                const pos = this.gridToScreen(entity.x - 0.5, entity.y - 0.5, camX, camY);
                if (pos.x < -tileSize || pos.x > width + tileSize || pos.y < -tileSize || pos.y > height + tileSize) return;

                this.shadowCtx.save();
                const feetOffset = tileSize * (25/32); 
                const cx = pos.x + tileSize / 2;
                const pivotY = pos.y + feetOffset;
                
                this.shadowCtx.translate(cx, pivotY);
                this.shadowCtx.transform(1, 0, -sx, -sy, 0, 0);
                drawCharacter(this.shadowCtx, entity, -tileSize/2, -feetOffset, tileSize, entity.id?.startsWith('npc'), true);
                this.shadowCtx.restore();
            });

            this.shadowCtx.restore(); // End silhouette drawing

            // B. Mask Out "Non-Receivers" (Wall Tops and Void)
            this.shadowCtx.save();
            this.shadowCtx.globalCompositeOperation = 'destination-out';

            // 1. Mask out Wall Tops
            for (let y = 0; y < CONFIG.GRID_H; y++) {
                for (let x = 0; x < CONFIG.GRID_W; x++) {
                    if (MAP_DATA[y][x] === 1) {
                         const info = getWallTopRenderInfo(x, y, camX, camY, width, height);
                         this.shadowCtx.fillRect(info.x, info.y, info.w, info.h);
                    }
                }
            }
            
            // 2. Mask out Void (Outside Game Grid)
            const gridTl = this.gridToScreen(0, 0, camX, camY);
            const gridBr = this.gridToScreen(CONFIG.GRID_W, CONFIG.GRID_H, camX, camY);
            
            // Top Void
            this.shadowCtx.fillRect(0, 0, width, gridTl.y);
            // Bottom Void
            this.shadowCtx.fillRect(0, gridBr.y, width, height - gridBr.y);
            // Left Void
            this.shadowCtx.fillRect(0, gridTl.y, gridTl.x, gridBr.y - gridTl.y);
            // Right Void
            this.shadowCtx.fillRect(gridBr.x, gridTl.y, width - gridBr.x, gridBr.y - gridTl.y);

            // 3. Special Case: North Gate Void Hole
            // The floor doesn't exist at (gateX, 0).
            const gateXCenter = Math.floor(CONFIG.GRID_W / 2);
            const holePos = this.gridToScreen(gateXCenter, 0, camX, camY);
            this.shadowCtx.fillRect(holePos.x, holePos.y, tileSize, tileSize);

            this.shadowCtx.restore();

            // C. Composite Shadow Layer onto Main Canvas
            ctx.save();
            ctx.globalAlpha = shadowOpacity;
            ctx.globalCompositeOperation = 'multiply'; // Darken the scene
            ctx.drawImage(this.shadowCanvas, 0, 0);
            ctx.restore();
        }

        // 4. Night Overlay
        if (ambientLight < 0.99) {
            ctx.fillStyle = `rgba(0, 5, 20, ${1.0 - ambientLight})`;
            ctx.fillRect(0, 0, width, height);
        }

        // 5. Final Character & Projectile Pass (On Top of Shadows)
        // This ensures characters are never darkened by their own shadows or the shop's shadow.
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            const row = this.entitiesByRow[y];
            if (!row || row.length === 0) continue;

            // Depth sort within the row
            row.sort((a, b) => a.obj.y - b.obj.y);

            row.forEach(item => {
                if (item.type === 'projectile') {
                    this.drawProjectile(ctx, item.obj, camX, camY, tileSize);
                } else {
                    const pos = this.gridToScreen(item.obj.x - 0.5, item.obj.y - 0.5, camX, camY);
                    drawCharacter(ctx, item.obj, pos.x, pos.y, tileSize, item.type === 'npc');
                }
            });
        }
    }

    drawProjectile(ctx, proj, camX, camY, tileSize) {
        const pos = this.gridToScreen(proj.x - 0.5, proj.y - 0.5, camX, camY);
        const r = (CONFIG.PROJECTILE_RADIUS || 0.1) * tileSize;
        ctx.fillStyle = '#00ffff'; 
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ffff';
        ctx.beginPath();
        ctx.arc(pos.x + tileSize/2, pos.y + tileSize/2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}