import { Router } from "express";
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const hr_data = Router();

hr_data.post("/hr_data", async (req, res) => {
    try {
        const { name, role, experience, company_applying, job_description } = req.body;
        if (!name || !role || !experience || !company_applying || !job_description) {
            res.status(400).json({ error: "All fields are required" });
            return;
        }
        const sessionId = uuidv4();
        
        try {
            const hr_interview = await prisma.hR_Interview.create({
                data: {
                    session: sessionId,
                    name,
                    role,
                    experience,
                    company_applying,
                    job_description
                }
            });
            res.json({ 
                sessionId, 
                websocketUrl: `ws://localhost:5000?sessionId=${sessionId}`,
                data: {
                    name,
                    role,
                    experience,
                    company_applying,
                    job_description
                }
            });
        } catch (dbError) {
            console.error("Database error:", dbError);
            res.json({ 
                sessionId, 
                websocketUrl: `ws://localhost:5000?sessionId=${sessionId}`,
                data: {
                    name,
                    role,
                    experience,
                    company_applying,
                    job_description
                },
                notice: "Session data not stored in database"
            });
        }
    } catch (error) {
        console.error("Error in /hr_data route:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});