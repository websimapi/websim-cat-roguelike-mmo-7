export function triggerHit(entity, dx, dy) {
    // bounce down (squash) and back (direction of hit)
    entity.hitAnim = {
        vx: dx * 0.5, // Direction of hit
        vy: dy * 0.5,
        startTime: Date.now(),
        duration: 500
    };
}

