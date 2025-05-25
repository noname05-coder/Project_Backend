import { WebSocketServer } from "ws";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { ConversationSummaryMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import * as readline from "readline";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

// Store active WebSocket servers for each session
const activeServers = new Map<string, WebSocketServer>();


const llm = new ChatOpenAI({
  model: "gpt-4o",
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0.7,
  topP: 0.85,
  frequencyPenalty: 0.2,
  presencePenalty: 0.7,
});

interface projectDescription {
  description: string;
}

interface ChatHistoryEntry {
  interviewer: string;
  candidate: string;
};

async function getData() {
  try {
    const response = await axios.post(
      "http://localhost:3000/api/v1/upload/ml_project",
      
      {
        description:
          "I have made a machine learning project that involves image classification using convolutional neural networks (CNNs). The project should include data preprocessing, model training, and evaluation. I would like to use Python and TensorFlow for this project.",
      },{
        headers: {
          authorization:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWY3MWExMS1kNGNiLTQwYzUtYWQ2NC03ZWJhMDczMTNiMTIiLCJpYXQiOjE3NDc4NDgxNzksImV4cCI6MTc0NzkzNDU3OX0.bfo5x0kkeAKrUGh0i6VQuPiY_85x1VAlkhJeGv64It8"
        }
      });
    console.log("Retrieved repository data successfully");
    return response.data as projectDescription;
  } catch (error) {
    console.error("Failed to fetch repository data:", error);
    throw error;
  }
};




async function generate_summery(chat_history: ChatHistoryEntry[], projectData: projectDescription) {
  try {
    // Format the chat history into a more readable string
    const formattedHistory = chat_history.map(entry => 
      `Interviewer: ${entry.interviewer}\nCandidate: ${entry.candidate}`
    ).join('\n\n');
    
    // Create the prompt with proper escaping of the JSON example
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a machine learning expert. Based on the project description and interview chat history provided, please assess the candidate's performance in the interview. Your task is to evaluate the candidate's responses and provide a detailed performance report.generated in JSON format.
        
        The JSON should follow this structure (with percentages that reflect your assessment:
          "Accuracy of Answers": "X%",
          "Fundamentals": "X%",
          "Understanding of Project": "X%",
          "Scalability & Deployment": "X%",
          "Clarity": "X%"
          
        Here's the project description: ${projectData}
        Here is the interview transcript:${formattedHistory}`
      ]
    ]);
    
    const formattedPrompt = await prompt.format({});
    const response = await llm.invoke(formattedPrompt);
    return response.content;
  } catch (error) {
    console.error("Error in generate_summary:", error);
    return "Failed to generate summary due to an error.";
  }
}



//websocket connection
export function startMLInterviewWebSocket(sessionId: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if server already exists for this session
    if (activeServers.has(sessionId)) {
      resolve(`ws://localhost:${port}?sessionId=${sessionId}`);
      return;
    }

    const wss = new WebSocketServer({ port });
    activeServers.set(sessionId, wss);

    wss.on("connection", async function(socket, req){
        // Parse sessionId from query string
        const url = new URL(req.url || '', 'http://localhost');
        const requestSessionId = url.searchParams.get('sessionId');
        
        // Validate that the connection is for the correct session
        if (requestSessionId !== sessionId) {
            socket.close(1008, 'Invalid session ID');
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
        
          const memory = new ConversationSummaryMemory({
            memoryKey: "chat_history",
            inputKey: "input",
            outputKey: "output",
            returnMessages: true,
            llm: llm,
        });
          let chatHistory: ChatHistoryEntry[] = [];
      let projectData: projectDescription;
    
      try {
        projectData = await getData();
        console.log("Project data retrieved successfully");
      } catch (error) {
        console.error("Failed to fetch project data:", error);
        rl.close();
        return;
      };
    
      const interviewerPrompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a seasoned Machine Learning interviewer with deep expertise in machine learning projects. When the user provides a machine learning project description, act as a senior ML engineer or hiring manager reviewing it. Your task is to generate a list of realistic, in-depth questions about the project.
    
            Conceptual Understanding: Ask about fundamental ML concepts and assumptions relevant to the project (e.g. why certain models or algorithms were chosen, and trade-offs involved).
            
            Technical Details: Inquire about data processing, feature engineering, model architecture, training procedure, hyperparameters, and evaluation metrics used.
            
            Implementation and Code: Probe code and design decisions (e.g. what libraries or frameworks were used, how the code is organized, any scalability or efficiency considerations, and possible refactoring).
            
            Scalability and Impact: Ask about performance on larger data, deployment strategy, and real-world impact (e.g. how the model handles more data or new scenarios, deployment challenges like monitoring model drift, and business value).
            
            Domain-Specific Considerations: Tailor questions to the project domain and tools. For instance, if it’s an NLP project, ask about text representation or relevant metrics; if it’s a computer vision project, ask about image preprocessing or CNN layers; if it’s a time-series project, ask about temporal feature extraction or seasonality.
    
            Your role is to behave exactly like a real interviewer:
                -Be more like human and less like a machine.
                -start with small introduction about how interview will take place and then ask question.
                - without narrating or explaining things to the candidate in breif.
                - Do **not** summarize the candidates answers too long just one or two line.
                - Ask **one** clear question at a time(dont make parts in one question).
                - After each response, continue the conversation by asking a relevant **follow-up question** or **next topic**  just like a real interviewer would.
                -Do not output formatting or commentary
                -based on the complexity of project ask between 10-15 questions.
            here is the project description: ${projectData.description}`,
        ],
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
      ]);
    
      // Create the chain with memory
      const chain2 = new ConversationChain({
          llm: llm,
          memory: memory,
          prompt: interviewerPrompt,
          outputKey: "output"
        });

    
      function getUserInput(socket: any): Promise<string> {
          return new Promise<string>((resolve) => {
            socket.on("message", (message: string) => {
            resolve(message.toString());
          });
        });
      }
    
      let continueInterview = true;
      let userInput = "";
    
      try {
        console.log("AI Interviewer is preparing the first question...");
        const response = await chain2.invoke({
          input: "Please start the interview with your first question."
        });

        socket.send(`\nInterviewer: ${response.output}\n`);

        userInput = await getUserInput(socket);
        if(userInput.toLowerCase() === "exit"){
          console.log("\nExiting interview session...");
          const response = await generate_summery(chatHistory, projectData);
          socket.send(`\nInterview Summary: ${response}\n`);
          rl.close();
          return;
        };
    
        chatHistory.push({
          interviewer: String(response.output),
          candidate: userInput,
        });
        try{
        console.log("AI Interviewer is evaluating your response...");
        const followUpResponse = await chain2.invoke({
          input: userInput
        });
        socket.send(`\nInterviewer: ${followUpResponse.output}\n`);
    
        chatHistory.push({
          interviewer: String(followUpResponse.output),
          candidate: "",
        });
      }catch(error){
        console.error("Error during interview:", error);
      }
      }catch(error){
        console.error("Error starting interview:", error);
        rl.close();
        return;
      }
    
      while (continueInterview) {
        userInput = await getUserInput(socket);
    
        if (userInput.toLowerCase() === "exit") {
          console.log("\nExiting interview session...");
          const response = await generate_summery(chatHistory, projectData);
          socket.send(`\nInterview Summary: ${response}\n`);
          rl.close();
          break;
        }
    
        try {
          console.log("AI Interviewer is evaluating your response...");
          const response = await chain2.invoke({
            input: userInput
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

      // Handle socket close to cleanup session data
      socket.on('close', () => {
        console.log(`ML Interview session ${sessionId} ended`);
        rl.close();
      });
    });

    wss.on('listening', () => {
      console.log(`ML Interview WebSocket server started for session ${sessionId} on port ${port}`);
      resolve(`ws://localhost:${port}?sessionId=${sessionId}`);
    });

    wss.on('error', (error) => {
      console.error(`ML WebSocket server error for session ${sessionId}:`, error);
      activeServers.delete(sessionId);
      reject(error);
    });

    wss.on('close', () => {
      console.log(`ML Interview WebSocket server closed for session ${sessionId}`);
      activeServers.delete(sessionId);
    });
  });
}

// Function to stop a WebSocket server for a specific session
export function stopMLInterviewWebSocket(sessionId: string): void {
  const wss = activeServers.get(sessionId);
  if (wss) {
    wss.close();
    activeServers.delete(sessionId);
    console.log(`Stopped ML Interview WebSocket server for session ${sessionId}`);
  }
}

// Function to get available port for ML interview
export function getMLAvailablePort(): number {
  const basePort = 6000;
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