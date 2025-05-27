import { Router } from "express";
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { startHRInterviewWebSocket, getAvailablePort } from '../webSockets/HR_ws';

const prisma = new PrismaClient();

export const hr_data = Router();

hr_data.post("/hr_data", async (req, res) => {
    try {
        const { name, role, experience, company_applying, job_description, interview_duration } = req.body;
        if (!name || !role || !experience || !company_applying || !job_description || !interview_duration) {
            res.status(400).json({ error: "All fields are required" });
            return;
        }
        const sessionId = uuidv4();
        const port = getAvailablePort();
        
        try {
            const hr_interview = await prisma.hR_Interview.create({
                data: {
                    session: sessionId,
                    name,
                    role,
                    experience,
                    company_applying,
                    job_description,
                    interview_duration
                }
            });

            // Start WebSocket server for this session
            try {
                const websocketUrl = await startHRInterviewWebSocket(sessionId, port);
                res.json({ websocketUrl});
            } catch (wsError) {
                console.error("WebSocket server error:", wsError);
                res.status(500).json({ error: "Failed to start interview session" });
            }
        } catch (dbError) {
            console.error("Database error:", dbError);
        }
    } catch (error) {
        console.error("Error in /hr_data route:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});