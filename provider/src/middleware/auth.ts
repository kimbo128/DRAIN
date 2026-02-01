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

            const logAttempt = (reason: string) => {
                console.warn(
                    `[Suspicious] ${reason}. Method: ${req.method}, Path: ${req.originalUrl}, IP: ${req.ip}, UA: ${req.get('User-Agent')}`
                );
            };

            // Fail fast if no header
            if (!authHeader) {
                logAttempt('Missing Authorization header');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Robust parsing: split by first space
            // Expect standard format "Bearer <token>"
            const parts = authHeader.split(' ');
            if (parts.length !== 2 || parts[0] !== 'Bearer') {
                logAttempt('Invalid Auth format');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const token = parts[1];
            if (!token) {
                logAttempt('Empty token');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const tokenBuffer = Buffer.from(token);

            // Check length match first (timingSafeEqual requires equal length)
            if (tokenBuffer.length !== adminKeyBuffer.length) {
                logAttempt('Invalid key length');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Constant-time comparison
            const isValid = crypto.timingSafeEqual(tokenBuffer, adminKeyBuffer);

            if (!isValid) {
                logAttempt('Invalid key signature');
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
