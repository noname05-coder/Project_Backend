import { WebSocketServer } from "ws";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import * as readline from "readline";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const llm = new ChatOpenAI({
  model: "gpt-4o",
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0.3,
  topP: 0.9,
  frequencyPenalty: 0.3,
  presencePenalty: 0.6,
});

const wss = new WebSocketServer({ port: 6000 });

interface RepositoryData {
  readme: string;
  dependencies: string[];
  message?: string;
}

async function getData() {
  try {
    const response = await axios.post(
      "http://localhost:3000/api/v1/upload/github-upload",
      {
        githubUrl: "https://github.com/punyajain1/Intelliguide",
      },
      {
        headers: {
          authorization:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YWY3MWExMS1kNGNiLTQwYzUtYWQ2NC03ZWJhMDczMTNiMTIiLCJpYXQiOjE3NDc4MTEwODEsImV4cCI6MTc0Nzg5NzQ4MX0.ArfE5nuiMO1Rs_6Qna1Q4j7-WlrWVdVMjp9E9WGK9kk",
        },
      }
    );
    console.log("Retrieved repository data successfully");
    return response.data as RepositoryData;
  } catch (error) {
    console.error("Failed to fetch repository data:", error);
    throw error;
  }
}

interface ChatHistoryEntry {
  interviewer: string;
  candidate: string;
}

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

Here is the interview transcript: ${formattedHistory}`,
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

wss.on("connection", async function (socket) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Initialize memory and chat history
  const memory = new BufferMemory({
    returnMessages: true,
    memoryKey: "chat_history",
  });

  let chatHistory: ChatHistoryEntry[] = [];
  let repositoryData: RepositoryData;

  try {
    repositoryData = await getData();
    console.log("Repository data loaded successfully.\n");
  } catch (error) {
    console.error("Failed to load repository data:", error);
    rl.close();
    return;
  }

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
                
                Ask ONE question at a time(also if they are of same tapic then only one question at a time), wait for their response, and then follow up appropriately or ask new question.
                After they answer, evaluate their response mentally and ask a follow-up question or ask new question.
                
                Start with an introduction and then proceed with your first question.
                
                Your role is to behave exactly like a real interviewer:
                    - without narrating or explaining things to the candidate in breif.
                    - Do **not** summarize the candidates answers too long just one or two line.
                    - Ask **one** clear question at a time(dont make parts in one question).
                    - After each response, continue the conversation by asking a relevant **follow-up question** or **next topic**  just like a real interviewer would.
                    -Do not output formatting or commentary
                    -based on the complexity of project ask between 10-15 questions.
                    -question can be mix of any type like coding, design, architecture, system design, etc. and can be mix of any level like easy, medium, hard.
                
                The repository information is: 
                readme:${JSON.stringify(repositoryData.readme)},
                dependencies:${JSON.stringify(repositoryData.dependencies)}`,
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const chain = interviewerPrompt.pipe(llm);

  console.log(
    "Technical interview simulation starting. Type 'exit' any time to end the session.\n"
  );
  console.log(
    "The AI interviewer will ask you questions about the project. Answer as if you're in a real interview.\n"
  );
  console.log("Press Enter to start the interview:");

  // Function to get user input
  const getUserInput = () => {
    return new Promise<string>((resolve) => {
      rl.question("Your answer> ", (input) => {
        resolve(input);
      });
    });
  };

  // Function to display chat history
  const displayChatHistory = () => {
    console.log("\n===== INTERVIEW TRANSCRIPT =====");
    chatHistory.forEach((entry, index) => {
      console.log(`\n--- Exchange ${index + 1} ---`);
      console.log(`Interviewer: ${entry.interviewer}`);
      console.log(`You: ${entry.candidate}`);
    });
    console.log("\n==============================");
  };

  // Start interview with an empty prompt to get the first question
  let continueInterview = true;
  let userInput = "";

  // Initial question from AI
  try {
    console.log("AI Interviewer is preparing the first question...");
    const response = await chain.invoke({
      input: "Please start the interview with your first question.",
      chat_history: [],
    });

    console.log(`\nInterviewer: ${response.content}\n`);
    userInput = await getUserInput();
    await memory.saveContext(
      { input: userInput },
      { output: response.content }
    );

    if (userInput.toLowerCase() === "exit") {
      console.log("\nExiting interview session...");
      displayChatHistory();
      rl.close();
      return;
    }

    chatHistory.push({
      interviewer: String(response.content),
      candidate: userInput,
    });
  } catch (error) {
    console.error("Error starting interview:", error);
    rl.close();
    return;
  }

  while (continueInterview) {
    userInput = await getUserInput();

    if (userInput.toLowerCase() === "exit") {
      console.log("\nExiting interview session...");
      displayChatHistory();
      rl.close();
      break;
    }

    try {
      console.log("AI Interviewer is evaluating your response...");

      const memoryVariables = await memory.loadMemoryVariables({});

      const response = await chain.invoke({
        input: userInput,
        chat_history: memoryVariables.chat_history || [],
      });

      console.log(`\nInterviewer: ${response.content}\n`);

      chatHistory.push({
        interviewer: String(response.content),
        candidate: userInput,
      });

      await memory.saveContext(
        { input: userInput },
        { output: response.content }
      );
    } catch (error) {
      console.error("Error during interview:", error);
    }
  }
});
