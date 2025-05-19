import jwt , {JwtPayload} from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

export async function usermiddleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers['authorization'];
    if (!token) {
        res.status(401).json({ message: 'Token not provided , User might not be login' });
        return;
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
        req.userId = (decoded as JwtPayload).userId;
        next();
    } catch (error) {
        res.status(403).json({ message: 'Invalid or expired token' });
        return;
    }
}