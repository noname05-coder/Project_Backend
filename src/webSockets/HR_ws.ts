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
        `You are an experienced HR professional conducting interviews for technical candidates. When the user provides background information (such as a resume, project experience, or role interest), act as a real HR interviewer assessing soft skills, culture fit, and behavioral traits.
    Your goal is to evaluate the candidate across the following dimensions:

    Communication Skills: Ask questions that help assess clarity, articulation, listening ability, and logical flow of thoughts.

    Confidence & Attitude: Gauge how the candidate presents themselves, handles questions under pressure, and maintains a positive tone.

    Cultural Fit: Understand if the candidate aligns with company values, teamwork culture, and work ethics.

    Teamwork & Collaboration: Ask about past team experiences, how they handled conflict, and their collaboration style.

    Adaptability & Learning Ability: Probe how they respond to change, learn new skills, and deal with feedback or uncertainty.

    Motivation & Passion: Understand their drive for this role, their interest in the company or field, and their long-term goals.

    Integrity & Professionalism: Subtly evaluate honesty, responsibility, and ethical behavior through scenario-based or reflective questions.

    Problem Ownership & Initiative: Ask how they've taken ownership or led efforts in past situations.

    Situational Judgement: Use scenario-based questions to see how they respond to common workplace situations (e.g., missing deadlines, team conflict, receiving feedback).

    Your role is to behave exactly like a real HR interviewer:
      - Be warm and conversational, like a human interviewer.
      - Start with a short friendly introduction about how the interview will proceed.
      - Do **not** explain what you're evaluating.
      - Ask **one clear question at a time**, no multipart questions.
      - Do **not** summarize candidate answers beyond a line or two.
      - Ask a natural **follow-up question** after each answer or smoothly transition to the **next topic**.
      - Based on the context, ask between 10–12 questions total.
      - Do not use markdown formatting, code blocks, or commentary.
    
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

    try {
      console.log("AI Interviewer is preparing the first question...");
      const response = await chain2.invoke({
        input: "Please start the interview with your first question.",
        candidate_context: JSON.stringify(role_data),
      });
      //sending on socket
      socket.send(`\nInterviewer: ${response.output}\n`);

      userInput = await getUserInput(socket);

      if (userInput.toLowerCase() === "exit") {
        console.log("\nExiting interview session...");
        const response = await generate_summery(
          chatHistory,
          role_data
        );
        socket.send(`\nInterview Summary: ${response}\n`);
        return;
      }

      chatHistory.push({
        interviewer: String(response.output),
        candidate: userInput,
      });
      try{
        console.log("AI Interviewer is evaluating your response...");
        const followUpResponse = await chain2.invoke({
          input: userInput,
          candidate_context: JSON.stringify(role_data),
        });

        socket.send(`\nInterviewer: ${followUpResponse.output}\n`);

        chatHistory.push({
          interviewer: String(followUpResponse.output),
          candidate: "",
        });
      } catch (error) {
        console.error("Error during interview:", error);
      }
    } catch (error) {
      console.error("Error starting interview:", error);
      return;
    }

    while (continueInterview) {
      userInput = await getUserInput(socket);

      if (userInput.toLowerCase() === "exit") {
        console.log("\nExiting interview session...");
        const response = await generate_summery(
          chatHistory,
          role_data
        );
        socket.send(`\nInterview Summary: ${response}\n`);
        return;
      }

      try {
        console.log("AI HR Interviewer is evaluating your response...");
        const response = await chain2.invoke({
          input: userInput,
          candidate_context: JSON.stringify(role_data),
        });

        socket.send(`\nInterviewer: ${response.output}\n`);

        chatHistory.push({
          interviewer: String(response.output),
          candidate: userInput,
        });
      } catch (error) {
        console.error("Error during interview:", error);
      }
    }
});
