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
          "Machine Learning Concepts": "X%",
          "Data Preprocessing & Feature Engineering": "X%",
          "Model Selection & Architecture": "X%",
          "Training & Optimization": "X%",
          "Evaluation Metrics & Validation": "X%",
          "Problem-Solving Approach": "X%",
          "Mathematical Foundation": "X%",
          "Communication of Technical Concepts": "X%"
          "strengths": ["strength 1", "strength 2", ...],
          "areasToImprove": ["area 1", "area 2", ...]
        
        Important:
        - DO NOT provide any explanations for the scores - only include the percentage values
        - Include at minimum 2-3 and atmaximum 6-7 specific areas where the candidate could improve

          
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

let INTERVIEW_DURATION_MINUTES = 15; 
const WARNING_BEFORE_END_MINUTES = 5;

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
        // Clean up and close server for invalid session
        socket.close(1008, 'Invalid session ID');
        
        const wss = activeServers.get(sessionId);
        if (wss) {
          wss.close(() => {
            console.log(`WebSocket server for session ${sessionId} closed due to invalid session ID`);
          });
          activeServers.delete(sessionId);
        }
        
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

      const ml_interview = await prisma.mL_Interview.findUnique({where: {session: sessionId}});
      
      if (ml_interview) {
        project_data = {
          description: ml_interview.description
        };
        await prisma.mL_Interview.delete({where:{session: sessionId}});
        INTERVIEW_DURATION_MINUTES = parseInt(ml_interview.interview_duration? ml_interview.interview_duration : "15");
      }else{
        // If no record found, close the connection
        // Clean up session data
        sessionData.delete(sessionId);
        
        // Close socket and server
        socket.close(1008, 'ML Interview session not found');
        
        // Close and clean up the WebSocket server
        const wss = activeServers.get(sessionId);
        if (wss) {
          wss.close(() => {
            console.log(`WebSocket server for session ${sessionId} closed due to ML session not found`);
          });
          activeServers.delete(sessionId);
        }
        
        return;
      }

      const mlInterviewerPrompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are an experienced ML/AI technical interviewer conducting a real-time technical interview with a candidate applying for a machine learning role. Your goal is to ask natural, well-informed, and technically rigorous questions based on the candidate's project and the broader domain of machine learning.

## Guidelines
- Ask only **one** question at a time  
- Wait for the candidate’s response before asking the next question  
- Do **not** include labels like “Question:”  
- Do **not** provide any summaries, commentary, or answer reviews  
- Do **not** reveal any evaluation criteria  
- Do **not** offer multiple questions in a single response  
- Maintain a natural, professional, technical tone as in a real interview  
- Stay focused on asking about relevant ML/AI topics, implementation details, and reasoning  

## Topics to Cover Throughout the Interview
- Machine learning algorithms and core concepts  
- Data preprocessing and feature engineering techniques  
- Model architecture, selection, and trade-offs  
- Training procedures, optimization strategies, and hyperparameters  
- Evaluation metrics, validation techniques, and model generalization  
- Programming, tools, and implementation-level decisions  
- Mathematical foundations where appropriate  
- Real-world problem-solving and application design  
- Scenario-based technical challenges  


Base your questions strictly on the following project context:{project_context}

Ask clear, technically challenging, and role-appropriate questions as you would in a real-world ML/AI interview. Stay entirely in the role of an interviewer.`,
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
          const messageHandler = (message: string) => {
            // Remove the listener after receiving the message
            socket.removeListener("message", messageHandler);
            resolve(message.toString());
          };
          socket.on("message", messageHandler);
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

        console.log(`Interview started at: ${new Date(startTime).toLocaleTimeString()}`);
        console.log(`Interview will end at: ${new Date(endTime).toLocaleTimeString()}`);
        console.log(`Warning will be sent at: ${new Date(warningTime).toLocaleTimeString()}`);

        // Set up timers for warning and ending the interview
        const warningTimer = setTimeout(() => {
          console.log("Sending warning message...");
          socket.send(`\nNote: ${WARNING_BEFORE_END_MINUTES} minutes remaining in the interview.\n`);
          isWarningSent = true;
          isEnding = true;
        }, warningTime - startTime);

        const endTimer = setTimeout(async () => {
          console.log("Interview time limit reached, ending interview...");
          const summary = await generate_summery(chatHistory, project_data);
          socket.send(`\nInterview time is up! Thank you for participating.\n`);
          socket.send("END");
          socket.send(`\nML Interview Summary: ${summary}\n`);
          continueInterview = false;
          socket.close();
        }, endTime - startTime);

        while (continueInterview) {
          userInput = await getUserInput(socket);

          if (userInput.toLowerCase() === "exit") {
            console.log("\nExiting ML interview session...");
            socket.send(`\nInterview Interrupted\n`);
            continueInterview = false;
            clearTimeout(warningTimer);
            clearTimeout(endTimer);
            
            // Clean up session data
            sessionData.delete(sessionId);
            
            // Close socket first
            socket.close();
            
            // Close and clean up the WebSocket server
            const wss = activeServers.get(sessionId);
            if (wss) {
              wss.close(() => {
                console.log(`WebSocket server for session ${sessionId} closed due to exit command`);
              });
              activeServers.delete(sessionId);
            }
            
            return;
          }

          chatHistory[chatHistory.length - 1].candidate = userInput;
          
          try {
            console.log("ML AI Interviewer is evaluating your response...");
            
            if (isEnding) {
              response = await chain.invoke({
                input: userInput + " [Please wrap up the interview with a final thank you message, no more questions.]",
                project_context: JSON.stringify(project_data),
              });
                  
              socket.send(`\nML Interviewer: ${response.output}\n`);
              
              // Don't immediately end if we've just entered ending mode
              if (Date.now() >= endTime) {
                const summary = await generate_summery(chatHistory, project_data);
                socket.send("END");
                socket.send(`\nML Interview Summary: ${summary}\n`);
                continueInterview = false;
                clearTimeout(warningTimer);
                clearTimeout(endTimer);
                socket.close();
                return;
              }
            } else {
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

        // Clean up timers if loop exits
        clearTimeout(warningTimer);
        clearTimeout(endTimer);
      } catch (error) {
        console.error("Error starting ML interview:", error);
        return;
      }


      // Handle socket close to cleanup session data
      socket.on('close', () => {
        console.log(`ML Interview session ${sessionId} ended, cleaning up session data`);
        sessionData.delete(sessionId);
        
        // Clean up the WebSocket server if it still exists
        const wss = activeServers.get(sessionId);
        if (wss && wss.clients.size === 0) {
          // Only close the server if there are no other clients
          wss.close(() => {
            console.log(`WebSocket server for session ${sessionId} closed - no active clients`);
          });
          activeServers.delete(sessionId);
        }
        
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