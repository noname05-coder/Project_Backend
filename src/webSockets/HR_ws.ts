import { WebSocketServer } from "ws";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ConversationSummaryMemory } from "langchain/memory";
import * as readline from "readline";
import dotenv from "dotenv";
import FirecrawlApp from "@mendable/firecrawl-js";
import { ConversationChain } from "langchain/chains";
import { PrismaClient } from "@prisma/client";

import { ChatPerplexity } from "@langchain/community/chat_models/perplexity";

import * as fs from 'fs/promises';
import * as path from 'path';

async function loadSampleQA() {
  try {
    const filePath = path.join(__dirname, '../../data/sample_qa.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Parse the content into Q&A pairs
    const qaPairs = content.split('\n\n').map(pair => {
      const [question, answer] = pair.split('\nA: ');
      return {
        question: question.replace('Q: ', '').trim(),
        expectedAnswer: answer.trim()
      };
    });
    
    return qaPairs;
  } catch (error) {
    console.error('Error loading sample Q&A:', error);
    return [];
  }
}


dotenv.config();
const prisma = new PrismaClient();


const llm = new ChatPerplexity({
  model: "sonar",
  temperature: 0.7,
  topP: 0.85,
  // frequencyPenalty: 0.2,
  presencePenalty: 0.7,
  apiKey: process.env.PERPLEXITY_API_KEY
});

interface IntervieweeData {
  name: string;
  role: string;
  experience: string;
  company_applying: string;
  job_description: string;
}

interface ChatHistoryEntry {
  interviewer: string;
  candidate: string;
}
const memory = new ConversationSummaryMemory({
  memoryKey: "chat_history",
  inputKey: "input",
  outputKey: "output",
  returnMessages: true,
  llm: llm,
});

let chatHistory: ChatHistoryEntry[] = [];

async function generate_summery(
  chat_history: ChatHistoryEntry[],
  interviewee_data: IntervieweeData
) {
  try {
    // Format the chat history into a more readable string
    const formattedHistory = chat_history
      .map(
        (entry) =>
          `Interviewer: ${entry.interviewer}\nCandidate: ${entry.candidate}`
      )
      .join("\n\n");

    // Create the prompt with proper template variables
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a HR. Based on the project description and interview chat history provided, please assess the candidate's performance in the interview. Your task is to evaluate the candidate's responses and provide a detailed performance report.generated in JSON format.
        
        The JSON should follow this structure (with percentages that reflect your assessment:
          "Communication Skills": "X%",
          "Confidence & Attitude": "X%",
          "Cultural Fit": "X%",
          "Teamwork & Collaboration": "X%",
          "Adaptability & Learning Ability": "X%",
          "Motivation & Passion": "X%",
          "Problem Ownership": "X%",
          "Integrity & Professionalism": "X%",
          "Situational Judgement": "X%"
          
        Here's the interview details: {interview_details}
        Here is the interview transcript: {transcript}`,
      ],
    ]);

    // Format the prompt with the variables
    const formattedPrompt = await prompt.format({
      interview_details: JSON.stringify(interviewee_data),
      transcript: formattedHistory,
    });

    const response = await llm.invoke(formattedPrompt);
    return response.content;
  } catch (error) {
    console.error("Error in generate_summary:", error);
    return "Failed to generate summary due to an error.";
  }
}

const wss = new WebSocketServer({ port: 5000 });






//websocket server--------------------------------------
wss.on("connection",async function (socket, req) {
    // Parse sessionId from query string
    const url = new URL(req.url || '', 'http://localhost');
    console.log(url);
    const sessionId = url.searchParams.get('sessionId');
  
    let role_data: IntervieweeData = {
      name: "",
      role: "",
      experience: "",
      company_applying: "",
      job_description: ""
    };

    const hr_interview = await prisma.hR_Interview.findUnique({
      where: {
        session: sessionId || ""
      }
    });
    if(hr_interview){
      role_data = {
        name: hr_interview.name,
        role: hr_interview.role,
        experience: hr_interview.experience,
        company_applying: hr_interview.company_applying,
        job_description: hr_interview.job_description
    }}
    await prisma.hR_Interview.delete({
      where: {
        session: sessionId || ""
      }
    })

    const hrInterviewerPrompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are an experienced HR professional conducting interviews for technical candidates. Your role is to conduct a natural, flowing conversation while evaluating the candidate.

        Key Guidelines:
        - Ask only ONE question at a time
        - Wait for the candidate's response before asking the next question
        - Never provide multiple questions or summaries in a single response
        - Maintain a warm, professional tone
        - Respond naturally to the candidate's previous answer before transitioning to your next question
        - Do not reveal your evaluation criteria
        - Do not provide summaries of the conversation
        - Stay focused on behavioral and situational questions

        Topics to cover throughout the interview:
        - Communication skills
        - Team collaboration
        - Problem-solving approach
        - Adaptability
        - Cultural fit
        - Leadership potential
        - Conflict resolution
        - Career motivation

        Here are the sample Question and Answers: {sampleQA}
        Here is the candidate context: {candidate_context}`,
    
      ],
      new MessagesPlaceholder("chat_history"),
      ["human", "{input}"],
    ]);

    const chain2 = new ConversationChain({
      llm: llm,
      memory: memory,
      prompt: hrInterviewerPrompt,
      outputKey: "output",
    });

    function getUserInput(socket: any): Promise<string> {
      return new Promise<string>((resolve) => {
        socket.on("message", (message: string) => {
          resolve(message.toString());
        });
      });
    }

    let continueInterview = true;
    let userInput: string;
    const sampleQAData = await loadSampleQA();

    try {
      console.log("AI Interviewer is preparing the first question...");
      let response = await chain2.invoke({
        input: "Please start the interview with your first question.",
        candidate_context: JSON.stringify(role_data),
        sampleQA: JSON.stringify(sampleQAData, null, 2),
      });
      
      socket.send(`\nInterviewer: ${response.output}\n`);
      
      // Store the first question in chat history
      chatHistory.push({
        interviewer: String(response.output),
        candidate: "",
      });

      while(continueInterview) {
        userInput = await getUserInput(socket);

        if (userInput.toLowerCase() === "exit") {
          console.log("\nExiting interview session...");
          const response = await generate_summery(
            chatHistory,
            role_data
          );
          socket.send(`\nInterview Summary: ${response}\n`);
          wss.close();
          socket.close();
          return;
        }
        
        // Update the last chat history entry with the candidate's response
        chatHistory[chatHistory.length - 1].candidate = userInput;
        
        try {
          console.log("AI Interviewer is evaluating your response...");
          response = await chain2.invoke({
            input: userInput,
            candidate_context: JSON.stringify(role_data),
            sampleQA: JSON.stringify(sampleQAData, null, 2),
          });
          
          socket.send(`\nInterviewer: ${response.output}\n`);
          
          // Add the new interviewer question to chat history
          chatHistory.push({
            interviewer: String(response.output),
            candidate: "",
          });
        } catch (error) {
          console.error("Error during interview:", error);
        }
      }

    } catch (error) {
      console.error("Error starting interview:", error);
      return;
    }

});
