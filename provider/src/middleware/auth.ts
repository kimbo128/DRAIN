import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Create admin authentication middleware
 * Uses constant-time comparison to prevent timing attacks
 */
export function createAdminMiddleware(adminKey: string) {
    // Pre-compute the buffer for the admin key once
    const adminKeyBuffer = Buffer.from(adminKey);

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const authHeader = req.headers.authorization;

            // Fail fast if no header
            if (!authHeader) {
                console.warn(`[Suspicious] Admin access attempt without auth header from ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Check format "Bearer <token>"
            if (!authHeader.startsWith('Bearer ')) {
                console.warn(`[Suspicious] Admin access attempt with invalid auth format from ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const token = authHeader.split(' ')[1];
            const tokenBuffer = Buffer.from(token);

            // Check length match first (timingSafeEqual requires equal length)
            if (tokenBuffer.length !== adminKeyBuffer.length) {
                console.warn(`[Suspicious] Admin access attempt with wrong key length from ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Constant-time comparison
            const isValid = crypto.timingSafeEqual(tokenBuffer, adminKeyBuffer);

            if (!isValid) {
                console.warn(`[Suspicious] Admin access attempt with invalid key from ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Authorized
            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    };
}
