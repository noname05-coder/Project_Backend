import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import Router from 'express'
import { getAvailablePortML, startMLInterviewWebSocket } from '../webSockets/ML_ws';

export const mlRouter = Router();

const prisma = new PrismaClient();


mlRouter.post("/ml_project",async(req,res)=>{
    try{
        const description = req.body;

        const sessionId = uuidv4();
        const port = getAvailablePortML();

        try{
            await prisma.mL_Interview.create({
            data: {
                session: sessionId,
                description: JSON.stringify(description)
            }
            });
            try{
                const websocketUrl = await startMLInterviewWebSocket(sessionId, port);
                res.json({ websocketUrl });

            }catch(wsError) {
                console.error("WebSocket server error:", wsError);
                res.status(500).json({ error: "Failed to start ML interview session" });
            }
        }catch(dbError){
            console.error("Database error:", dbError);
            res.status(500).json({ error: "Internal server error" });
        }
    }catch(e){
        console.error("Error in /ml_project route:", e);
        res.status(500).json({ error: "Internal server error" });
    }
});
