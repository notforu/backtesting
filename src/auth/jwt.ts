import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
}

function getSecret(): string {
  return process.env.JWT_SECRET || 'backtesting-dev-secret-change-in-production';
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}
