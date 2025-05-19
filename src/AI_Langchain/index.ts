import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from 'dotenv';
import axios from "axios";
dotenv.config();

async function getData(){
    try {
        const response = await axios.post("http://localhost:3000/api/v1/upload/github-upload",{
            githubUrl : "https://github.com/punyajain1/Intelliguide"
        },{
            headers: {
                "authorization": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWY3MWExMS1kNGNiLTQwYzUtYWQ2NC03ZWJhMDczMTNiMTIiLCJpYXQiOjE3NDcyMTgxMDIsImV4cCI6MTc0NzMwNDUwMn0.ds3SYKblym8nvZmbtkQC4_VdpmpnpPww6I3_wImkhMA"
            }
        });
        console.log("Retrieved repository data successfully");
        return JSON.stringify(response.data);
    } catch (error) {
        console.error("Failed to fetch repository data:", error);
        throw error;
    }
}

const data = z.object({
  description: z.string().describe("Description of the project from readme of project or any other source"),
  techstack: z.array(z.string()).describe("Tech stack used in the project from dependencies or any other source"),
});

const promptTemplate = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are an expert extraction algorithm.
    Extract relevant information from the text. you must extract breif description of the project and tech stack used in the project so that it will help me make questions to ask to interviewee .`,
  ],
  ["human", "{data}"],
  [
    "human",
    `Please extract the relevant information from the text and return it in JSON format.
    The JSON should contain the following fields:
    - description: Project description
    - techstack: List of technologies used`,
  ],
]);

const llm = new ChatOpenAI({
  model: "gpt-4o",
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
});

const structured_llm = llm.withStructuredOutput(data);

async function main(){
  try {
    console.log("Starting data extraction...");
    
    // Get repository data
    const repoData = await getData();
    
    // Format prompt with repository data
    console.log("Creating prompt...");
    const prompt = await promptTemplate.invoke({ data: repoData });
    
    // Process with LLM
    console.log("Sending to AI model...");
    const result = await structured_llm.invoke(prompt);
    
    // Output the extracted information
    console.log("\n--------- Extracted Information ---------");
    console.log("Description:", result.description);
    console.log("\nTech Stack:", result.techstack.join(", "));
    
    return result;
  } catch (error) {
    console.error("Error in extraction process:", error);
    throw error;
  }
}

// Execute the main function
console.log("Starting extraction process...");
main()
  .then(() => console.log("Extraction completed successfully"))
  .catch(error => console.error("Extraction failed:", error));

