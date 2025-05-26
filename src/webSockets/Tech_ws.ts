import { WebSocketServer } from "ws";
import {ChatPromptTemplate,MessagesPlaceholder,} from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { ConversationSummaryMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

const llm = new ChatOpenAI({
  model: "gpt-4o",
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0.3,
  topP: 0.9,
  frequencyPenalty: 0.3,
  presencePenalty: 0.6,
});

// Store active WebSocket servers for each session
const activeServers = new Map<string, WebSocketServer>();

interface RepositoryData {
  session : string;
  readme: string;
  dependencies: string[] | string;
  site_data?: string | null;
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
  repositoryData: RepositoryData;
}>();

//generating the summery of the interview
async function generate_summery(chat_history: ChatHistoryEntry[]) {
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
        `You are a technical interviewer. Based on the project description and interview chat history provided, please assess the candidate's performance in the technical interview. Your task is to evaluate the candidate's responses and provide a detailed performance report generated in JSON format.

The JSON should follow this structure (with percentages that reflect your assessment):
"Technical_knowledge": "X%",
"Problem_solving": "X%",
"Coding_skills": "X%",
"System_design": "X%",
"Debugging_skills": "X%"

Focus your assessment on:

Understanding of project architecture and design decisions

Practical knowledge of the specified technologies

Ability to scale, optimize, and maintain the system

Problem-solving skills demonstrated through scenario-based or technical questions

Here is the interview transcript: {transcript}`,
      ],
    ]);

    // Format the prompt with the variables
    const formattedPrompt = await prompt.format({
      transcript: formattedHistory,
    });

    const response = await llm.invoke(formattedPrompt);
    return response.content;
  } catch (error) {
    console.error("Error in generate_summary:", error);
    return "Failed to generate summary due to an error.";
  }
}

const INTERVIEW_DURATION_MINUTES = 10; 
const WARNING_BEFORE_END_MINUTES = 2;

export function startTechInterviewWebSocket(sessionId: string, port: number): Promise<string> {
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
      const requestSessionId = url.searchParams.get('sessionId');
      
      // Validate that the connection is for the correct session
      if (requestSessionId !== sessionId) {
          // Clean up and close server for invalid session
          socket.close(1008, 'Invalid session ID');
          console.log(`Invalid session ID attempted: ${requestSessionId}, expected: ${sessionId}`);
          return;
      }

      // Initialize session-specific data
      if (!sessionData.has(sessionId)) {
        const memory = new ConversationSummaryMemory({
          memoryKey: "chat_history",
          inputKey: "input",
          outputKey: "output",
          returnMessages: true,
          llm: llm,
        });
        
        let repositoryData: RepositoryData;
        try {
          const result = await prisma.tech_Interview.findUnique({where: { session: sessionId }});
          if (!result) {
            throw new Error(`No repository data found for session ${sessionId}`);
          }
          
          // Handle dependencies parsing more safely
          let dependencies: string[];
          if (typeof result.dependencies === 'string') {
            try {
              // Try parsing as JSON first
              dependencies = JSON.parse(result.dependencies);
            } catch (parseError) {
              // If JSON parsing fails, treat it as a comma-separated string
              dependencies = result.dependencies.split(',').map(dep => dep.trim()).filter(dep => dep.length > 0);
            }
          } else {
            dependencies = result.dependencies || [];
          }
          
          repositoryData = {
            session: result.session,
            readme: result.readme,
            dependencies: dependencies,
            site_data: result.site_data,
            description: result.description
          };

          await prisma.tech_Interview.delete({
            where: { session: sessionId }
          });

          console.log("Repository data loaded successfully.\n");
        }catch(error){
          console.error("Failed to load repository data:", error);
          sessionData.delete(sessionId);
          socket.close(1011, 'Failed to load repository data');
          const wss = activeServers.get(sessionId);
          if (wss) {
            wss.close(() => {
              console.log(`WebSocket server for session ${sessionId} closed due to data loading error`);
            });
            activeServers.delete(sessionId);
          }
          return;
        }
        
        sessionData.set(sessionId, {
          memory,
          chatHistory: [],
          repositoryData
        });
      }
      
      const { memory, chatHistory, repositoryData } = sessionData.get(sessionId)!;

      const interviewerPrompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a seasoned technical interviewer with years of experience in assessing candidates for software engineering roles. Your job is to ask insightful, real-world technical questions based on:
        
                    The project description and/or README
                    Any available data from web scraping related to the project (such as website content, documentation, or public interfaces)
                    The provided tech stack used in the project
        
                    Ask detailed, context-aware interview questions that test the candidate's:
                    - Understanding of project architecture and design decisions
                    - Practical knowledge of the specified technologies
                    - Ability to scale, optimize, and maintain the system
                    - Problem-solving skills through scenario-based questions relevant to the project
        
                    Your questions should mimic those asked in real technical interviews for roles like backend developer, frontend engineer, full-stack developer, or DevOps, depending on the project's context.
        
                    Ask as if you're interviewing a candidate for a job that involves working on or maintaining this project in the real world.
                    
                    Key Guidelines:
                    - Ask only ONE question at a time
                    - Wait for the candidate's response before asking the next question
                    - Never provide multiple questions or summaries in a single response
                    - Maintain a professional, technical tone
                    - Respond naturally to the candidate's previous answer before transitioning to your next question
                    - Do not reveal your evaluation criteria
                    - Do not provide summaries of the conversation
                    - Stay focused on technical questions
                    - Based on the complexity of project ask between 10-15 questions
                    - Questions can be mix of any type like coding, design, architecture, system design, etc. and can be mix of any level like easy, medium, hard
                    
                    The repository information is: 
                    readme: ${JSON.stringify(repositoryData.readme)},
                    dependencies: ${JSON.stringify(repositoryData.dependencies)}`,
        ],
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
      ]);

      const chain = new ConversationChain({
        llm: llm,
        memory: memory,
        prompt: interviewerPrompt,
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

      console.log(
        "Technical interview simulation starting. Type 'exit' any time to end the session.\n"
      );
      console.log(
        "The AI interviewer will ask you questions about the project. Answer as if you're in a real interview.\n"
      );

      // Start interview with an empty prompt to get the first question
      try {
        console.log("AI Interviewer is preparing the first question...");
        let response = await chain.invoke({
          input: "Please start the interview with your first question.",
        });

        socket.send(`\nInterviewer: ${response.output}\n`);
        
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
          const summary = await generate_summery(chatHistory);
          socket.send(`\nInterview time is up! Thank you for participating.\n`);
          socket.send("END");
          socket.send(`\nInterview Summary: ${summary}\n`);
          continueInterview = false;
          
          // Clean up session data
          sessionData.delete(sessionId);
          
          // Close socket and server
          socket.close();
          
          // Close and clean up the WebSocket server
          const wss = activeServers.get(sessionId);
          if (wss) {
            wss.close(() => {
              console.log(`WebSocket server for session ${sessionId} closed due to timeout`);
            });
            activeServers.delete(sessionId);
          }
        }, endTime - startTime);

        while (continueInterview) {
          userInput = await getUserInput(socket);

          if (userInput.toLowerCase() === "exit") {
            console.log("\nExiting interview session...");
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

          // Update the last chat history entry with the candidate's response
          chatHistory[chatHistory.length - 1].candidate = userInput;

          try {
            console.log("AI Interviewer is evaluating your response...");

            if (isEnding) {
              response = await chain.invoke({
                  input: userInput + " [Please wrap up the interview with a final thank you message, no more questions.]",
              });
                  
              socket.send(`\nInterviewer: ${response.output}\n`);
              
              // Don't immediately end if we've just entered ending mode
              if (Date.now() >= endTime) {
                const summary = await generate_summery(chatHistory);
                socket.send("END");
                socket.send(`\nInterview Summary: ${summary}\n`);
                continueInterview = false;
                clearTimeout(warningTimer);
                clearTimeout(endTimer);
                
                // Clean up session data
                sessionData.delete(sessionId);
                
                // Close socket and server
                socket.close();
                
                // Close and clean up the WebSocket server
                const wss = activeServers.get(sessionId);
                if (wss) {
                  wss.close(() => {
                    console.log(`WebSocket server for session ${sessionId} closed due to interview completion`);
                  });
                  activeServers.delete(sessionId);
                }
                
                return;
              }
            } else {
              response = await chain.invoke({
                  input: userInput,
              });
              socket.send(`\nInterviewer: ${response.output}\n`);
              
              chatHistory.push({
                interviewer: String(response.output),
                candidate: "",
              });
            }
          } catch (error) {
            console.error("Error during interview:", error);
          }
        }

        // Clean up timers if loop exits
        clearTimeout(warningTimer);
        clearTimeout(endTimer);
      } catch (error) {
        console.error("Error starting interview:", error);
        
        // Clean up session data
        sessionData.delete(sessionId);
        
        // Close socket and server
        socket.close();
        
        // Close and clean up the WebSocket server
        const wss = activeServers.get(sessionId);
        if (wss) {
          wss.close(() => {
            console.log(`WebSocket server for session ${sessionId} closed due to error`);
          });
          activeServers.delete(sessionId);
        }
        
        return;
      }

      // Handle socket close to cleanup session data
      socket.on('close', () => {
        console.log(`Tech Interview session ${sessionId} ended, cleaning up session data`);
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
      });
    });

    wss.on('listening', () => {
      console.log(`Tech Interview WebSocket server started for session ${sessionId} on port ${port}`);
      resolve(`ws://localhost:${port}?sessionId=${sessionId}`);
    });

    wss.on('error', (error) => {
      console.error(`Tech WebSocket server error for session ${sessionId}:`, error);
      activeServers.delete(sessionId);
      reject(error);
    });

    wss.on('close', () => {
      console.log(`Tech Interview WebSocket server closed for session ${sessionId}`);
      activeServers.delete(sessionId);
    });
  });
}

// Function to stop a WebSocket server for a specific session
export function stopTechInterviewWebSocket(sessionId: string): void {
  const wss = activeServers.get(sessionId);
  if (wss) {
    wss.close();
    activeServers.delete(sessionId);
    console.log(`Stopped Tech Interview WebSocket server for session ${sessionId}`);
  }
}

// Function to get available port for Tech interview
export function getTechAvailablePort(): number {
  const basePort = 6001;
  let port = basePort;
  
  // Find an available port by checking active servers
  const usedPorts = new Set<number>();
  for (const [sessionId, server] of activeServers) {
    const address = server.address();
    if (address && typeof address === 'object' && 'port' in address) {
      usedPorts.add(address.port);
    }
  }
  
  // Find the next available port
  while (usedPorts.has(port)) {
    port++;
  }
  
  return port;
}
