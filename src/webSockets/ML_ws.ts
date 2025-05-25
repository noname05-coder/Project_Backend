import { WebSocketServer } from "ws";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ConversationSummaryMemory } from "langchain/memory";
import dotenv from "dotenv";
import { ConversationChain } from "langchain/chains";
import { PrismaClient } from "@prisma/client";
import { ChatPerplexity } from "@langchain/community/chat_models/perplexity";

dotenv.config();
const prisma = new PrismaClient();

const llm = new ChatPerplexity({
  model: "sonar",
  temperature: 0.7,
  topP: 0.85,
  presencePenalty: 0.7,
  apiKey: process.env.PERPLEXITY_API_KEY
});

interface MLProjectData {
  description: string;
}

interface ChatHistoryEntry {
  interviewer: string;
  candidate: string;
}

// Store session-specific data
const sessionData = new Map<string, {
  memory: ConversationSummaryMemory;
  chatHistory: ChatHistoryEntry[];
}>();

async function generate_summery(
  chat_history: ChatHistoryEntry[],
  project_data: MLProjectData
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
        `You are an ML/AI Technical Interviewer. Based on the project description and interview chat history provided, please assess the candidate's performance in the ML/AI technical interview. Your task is to evaluate the candidate's responses and provide a detailed performance report in JSON format.
        
        The JSON should follow this structure (with percentages that reflect your assessment):
        {
          "Machine Learning Concepts": "X%",
          "Data Preprocessing & Feature Engineering": "X%",
          "Model Selection & Architecture": "X%",
          "Training & Optimization": "X%",
          "Evaluation Metrics & Validation": "X%",
          "Programming & Implementation": "X%",
          "Problem-Solving Approach": "X%",
          "Mathematical Foundation": "X%",
          "Communication of Technical Concepts": "X%"
        }
          
        Here's the ML project description: {project_details}
        Here is the interview transcript: {transcript}`,
      ],
    ]);

    // Format the prompt with the variables
    const formattedPrompt = await prompt.format({
      project_details: JSON.stringify(project_data),
      transcript: formattedHistory,
    });

    const response = await llm.invoke(formattedPrompt);
    return response.content;
  } catch (error) {
    console.error("Error in generate_summary:", error);
    return "Failed to generate summary due to an error.";
  }
}

const INTERVIEW_DURATION_MINUTES = 5; 
const WARNING_BEFORE_END_MINUTES = 2;

const activeServers = new Map<string, WebSocketServer>();

export function startMLInterviewWebSocket(sessionId: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if server already exists for this session
    if (activeServers.has(sessionId)) {
      resolve(`ws://localhost:${port}?sessionId=${sessionId}`);
      return;
    }

    const wss = new WebSocketServer({ port });
    activeServers.set(sessionId, wss);

    wss.on("connection", async function (socket, req) {
      // Parse sessionId from query string
      const url = new URL(req.url || '', 'http://localhost');
      console.log(url);
      const requestSessionId = url.searchParams.get('sessionId');
      
      // Validate that the connection is for the correct session
      if (requestSessionId !== sessionId) {
        socket.close(1008, 'Invalid session ID');
        return;
      }
    
      let project_data: MLProjectData = {
        description: ""
      };

      // Initialize session-specific data
      if (!sessionData.has(sessionId)) {
        const memory = new ConversationSummaryMemory({
          memoryKey: "chat_history",
          inputKey: "input",
          outputKey: "output",
          returnMessages: true,
          llm: llm,
        });
        
        sessionData.set(sessionId, {
          memory,
          chatHistory: []
        });
      }
      
      const { memory, chatHistory } = sessionData.get(sessionId)!;

      const ml_interview = await prisma.mL_Interview.findUnique({
        where: {
          session: sessionId || ""
        }
      });
      
      if (ml_interview) {
        project_data = {
          description: ml_interview.description
        };
      } else {
        // If no record found, close the connection
        socket.close(1008, 'ML Interview session not found');
        return;
      }

      const mlInterviewerPrompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are an experienced ML/AI Technical Interviewer conducting a technical interview for machine learning candidates. Your role is to conduct a natural, flowing conversation while evaluating the candidate's technical knowledge.

          Key Guidelines:
          - Ask only ONE question at a time
          - Wait for the candidate's response before asking the next question
          - Never provide multiple questions or summaries in a single response
          - Maintain a professional, technical tone
          - Respond naturally to the candidate's previous answer before transitioning to your next question
          - Do not reveal your evaluation criteria
          - Do not provide summaries of the conversation
          - Focus on technical ML/AI concepts and implementation details

          Topics to cover throughout the interview:
          - Machine learning algorithms and concepts
          - Data preprocessing and feature engineering
          - Model architecture and selection
          - Training methodologies and optimization
          - Evaluation metrics and validation techniques
          - Programming implementation
          - Mathematical foundations
          - Problem-solving approach
          - Real-world application scenarios

          Here is the ML project description to base your questions on: {project_context}`,
        ],
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
      ]);

      const chain = new ConversationChain({
        llm: llm,
        memory: memory,
        prompt: mlInterviewerPrompt,
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
        console.log("ML AI Interviewer is preparing the first question...");
        let response = await chain.invoke({
          input: "Please start the ML technical interview with your first question.",
          project_context: JSON.stringify(project_data),
        });
        
        socket.send(`\nML Interviewer: ${response.output}\n`);
        
        // Store the first question in chat history
        chatHistory.push({
          interviewer: String(response.output),
          candidate: "",
        });

        const startTime = Date.now();
        const endTime = startTime + (INTERVIEW_DURATION_MINUTES * 60 * 1000);
        const warningTime = endTime - (WARNING_BEFORE_END_MINUTES * 60 * 1000);
        let isWarningSent = false;
        let isEnding = false;

        while (continueInterview) {
          const currentTime = Date.now();
          
          // Check if interview should end
          if (currentTime >= endTime) {
            const summary = await generate_summery(chatHistory, project_data);
            socket.send(`\nInterview time is up! Thank you for participating.\n\nML Interview Summary: ${summary}\n`);
            socket.close();
            return;
          }

          // Send warning when approaching end time
          if (!isWarningSent && currentTime >= warningTime) {
            socket.send(`\nNote: ${WARNING_BEFORE_END_MINUTES} minutes remaining in the interview.\n`);
            isWarningSent = true;
            isEnding = true;
          }

          userInput = await getUserInput(socket);

          if (userInput.toLowerCase() === "exit") {
            console.log("\nExiting ML interview session...");
            const response = await generate_summery(
              chatHistory,
              project_data
            );
            socket.send(`\nML Interview Summary: ${response}\n`);
            socket.close();
            return;
          }
          
          // Update the last chat history entry with the candidate's response
          chatHistory[chatHistory.length - 1].candidate = userInput;
          
          try {
            console.log("ML AI Interviewer is evaluating your response...");
            
            // If we're in the ending period, modify the prompt to wrap up
            if (isEnding) {
              response = await chain.invoke({
                input: userInput + " [Please wrap up the interview with a final thank you message, no more questions.]",
                project_context: JSON.stringify(project_data),
              });
              
              
              socket.send(`\nML Interviewer: ${response.output}\n`);
              const summary = await generate_summery(chatHistory, project_data);
              socket.send(`\nML Interview Summary: ${summary}\n`);
              socket.close();
              return;
            }else{
              response = await chain.invoke({
                input: userInput,
                project_context: JSON.stringify(project_data)
              });
              socket.send(`\nML Interviewer: ${response.output}\n`);
              
              chatHistory.push({
                interviewer: String(response.output),
                candidate: "",
              });
            }
          } catch (error) {
            console.error("Error during ML interview:", error);
          }
        }

      } catch (error) {
        console.error("Error starting ML interview:", error);
        return;
      }


      // Handle socket close to cleanup session data
      socket.on('close', () => {
        console.log(`ML Interview session ${sessionId} ended, cleaning up session data`);
        sessionData.delete(sessionId);
        prisma.mL_Interview.delete({
          where: {
            session: sessionId
          }
        }).catch(error => {
          console.log(`Cleanup: Record for session ${sessionId} was already deleted`);
        });
      });
    });

    wss.on('listening', () => {
      console.log(`ML Interview WebSocket server started for session ${sessionId} on port ${port}`);
      resolve(`ws://localhost:${port}?sessionId=${sessionId}`);
    });

    wss.on('error', (error) => {
      console.error(`WebSocket server error for session ${sessionId}:`, error);
      activeServers.delete(sessionId);
      reject(error);
    });

    wss.on('close', () => {
      console.log(`ML Interview WebSocket server closed for session ${sessionId}`);
      activeServers.delete(sessionId);
    });
  });
}


export function stopMLInterviewWebSocket(sessionId: string): void {
  const wss = activeServers.get(sessionId);
  if (wss) {
    wss.close();
    activeServers.delete(sessionId);
    console.log(`Stopped ML Interview WebSocket server for session ${sessionId}`);
  }
}


export function getAvailablePortML(): number {
  const basePort = 6000;
  let port = basePort;
  const usedPorts = new Set<number>();
  for (const [sessionId, server] of activeServers) {
    const address = server.address();
    if (address && typeof address === 'object' && 'port' in address) {
      usedPorts.add(address.port);
    }
  }
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}