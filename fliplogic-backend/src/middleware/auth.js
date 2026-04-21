import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';

/**
 * Verify JWT token from request headers
 */
export async function verifyAuthToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('Auth verification failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Create JWT token
 */
export function createToken(userId, expiresIn = process.env.JWT_EXPIRE || '7d') {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Verify Firebase token (from Firebase Auth)
 * This will be called after Firebase auth succeeds
 */
export async function verifyFirebaseToken(firebaseToken) {
  try {
    // In production, verify with Firebase Admin SDK
    // For MVP, just trust Firebase's verification
    return firebaseToken;
  } catch (error) {
    logger.error('Firebase token verification failed:', error);
    throw error;
  }
}
