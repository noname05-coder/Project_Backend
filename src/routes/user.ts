import { Request, Router, Response} from "express";
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { usermiddleware } from "../middleware/usermiddleware";



export const userRouter = Router();
const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';


interface updatedUser{
    email?: string;
    username?: string;
    password?: string;
}



// Signup endpoint
userRouter.post('/signup', async (req:Request, res:Response) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });
        
        if (existingUser) {
            res.status(400).json({ message: 'User already exists' });
            return;
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword
            }
        });
        const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '24h' });
        
        res.status(200).json({
            message: 'User created successfully',
            token,
            user: { id: newUser.id, username: newUser.username, email: newUser.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error: error });
    }
});

// Login endpoint
userRouter.post('/login',async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({where: { email }});
        if (user == null) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            res.status(401).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
        
        res.status(200).json({
            message: 'Login successful',
            token,
            user: { id: user.id, username: user.username, email: user.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error: error });
    }
});

//update 
userRouter.post("/update",usermiddleware,async (req:Request, res:Response) => {
    try {
        const {username, email, password } = req.body;
        const userId = req.userId;
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        if (existingUser == null) {
            res.status(404).json({ message: 'User not found' });
            return;
        }
        const updateData: updatedUser = {};
        
        if (username !== undefined) {
            updateData.username = username;
        }
        
        if (email !== undefined) {
            updateData.email = email;
        }
        
        if (password !== undefined) {
            updateData.password = await bcrypt.hash(password, 10);
        }
        if (Object.keys(updateData).length === 0) {
            res.status(400).json({ message: 'No fields to update provided' });
            return;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updateData
        });
        
        res.status(200).json({
            message: 'User updated successfully',
            user: { id: updatedUser.id, username: updatedUser.username, email: updatedUser.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error updating user', error: error });
    }
});