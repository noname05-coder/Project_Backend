import { Router } from "express";

export const hr_data = Router();


hr_data.get("/hr_data" , async(req,res)=>{
    try{
        const { name, role, experience, company_applying, job_description } = req.query;

        // Validate the input
        if (!name || !role || !experience || !company_applying || !job_description) {
            res.status(400).json({ error: "All fields are required" });
            return;
        }

        // Create the data object
        const data = {
            name: String(name),
            role: String(role),
            experience: String(experience),
            company_applying: String(company_applying),
            job_description: String(job_description)
        };
        res.json(data);
    }catch (error) {
        console.error("Error in /hr_data route:", error);
        res.status(500).json({ error: "Internal server error" });
    }


    
})