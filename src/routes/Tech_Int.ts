import Router from 'express'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { PrismaClient } from '@prisma/client';
import FirecrawlApp from '@mendable/firecrawl-js';
import { v4 as uuidv4 } from 'uuid';
import { getTechAvailablePort, startTechInterviewWebSocket} from '../webSockets/Tech_ws'

const prisma = new PrismaClient();


const app = new FirecrawlApp({apiKey: process.env["FIRECRAWL_API_KEY"]});


// Helper function to find all package.json files in a repository
async function findPackageJsonFiles(dir: string): Promise<{path: string, content: any}[]> {
  const packageJsonFiles: {path: string, content: any}[] = [];
  
  async function searchDirectory(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          await searchDirectory(fullPath);
        } else if (entry.isFile() && entry.name === 'package.json') {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const parsed = JSON.parse(content);
            const relativePath = path.relative(dir, fullPath).replace(/\\/g, '/');
            
            packageJsonFiles.push({
              path: relativePath,
              content: parsed
            });
          } catch (error) {
            console.error(`Error reading/parsing ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error searching directory ${currentDir}:`, error);
    }
  }
  
  await searchDirectory(dir);
  return packageJsonFiles;
}



export const uploadRouter = Router();

uploadRouter.post('/github-upload',async (req, res) => {
  const { githubUrl , description , live_link = null } = req.body;

  if (!githubUrl || !githubUrl.includes('github.com')) {
    res.status(400).json({ error: 'Invalid GitHub URL' });
    return;
  }

  try {
    const repoName = githubUrl.split('/').slice(-1)[0];
    const tempDir = path.join(__dirname, '../../tmp');
    const tempPath = path.join(tempDir, repoName);

    await fs.mkdir(tempDir, { recursive: true });
    
    await new Promise((resolve, reject) => {
      exec(`git clone "${githubUrl}" "${tempPath}"`, (error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
    const readmePath = path.join(tempPath, 'README.md');
    let readme = '';
    try {
      readme = await fs.readFile(readmePath, 'utf-8');
    } catch (e) {
      console.log('README.md not found in root directory');
    }
    const packageJsonFiles = await findPackageJsonFiles(tempPath);
    //deleting the file
    await fs.rm(tempPath, { recursive: true, force: true });

    const dependencies = [];
    for(let i=packageJsonFiles.length-1; i>=0;i--){
      let dependencie= packageJsonFiles[i].content.dependencies;
      if(dependencie){
        for (const key of Object.entries(dependencie)) {
          dependencies.push(key[0]);
        }
      }
    }

    let scrapeResponse = null;

    if(live_link){
      try{
        scrapeResponse = await app.scrapeUrl(`${live_link}`, {formats: ['markdown', 'html'],});
        if (!scrapeResponse.success) {
          res.status(401).json({msg: "Failed to scrape project", error: scrapeResponse.error });
          return;
        }
      }catch(err){
        console.error('Error scraping live link:', err);
        res.status(500).json({ error: 'Failed to scrape live link', details: err });
        return;
      }
    }

    const sessionId = uuidv4(); // Keep this for WebSocket session management
    const port = getTechAvailablePort();
    

    try {
      await prisma.tech_Interview.create({
        data: {
          session: sessionId, // Use sessionId instead of repoName
          description: JSON.stringify(description),
          readme: readme,
          dependencies: dependencies.toString(),
          site_data: scrapeResponse ? scrapeResponse.markdown : null,
        },
      });
      
      // Start WebSocket server for this session
      try {
        const websocketUrl = await startTechInterviewWebSocket(sessionId, port);
        res.json({ websocketUrl});
      } catch (wsError) {
        console.error("WebSocket server error:", wsError);
        res.status(500).json({ error: "Failed to start interview session" });
      }
    } catch (dbError) {
      console.error("Database error:", dbError);
    }
  } catch(error) {
    console.error("Error in /github-upload route:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



//live project
// uploadRouter.post("/live-upload", usermiddleware,async (req, res) => {
//   const user = await prisma.user.findUnique({
//     where: { id: req.userId },
//   });
//   if (!user) {
//     res.status(401).json({ error: "Unauthorized" });
//     return;
//   }
//   const { projectUrl } = req.body;
//   try {
//     const scrapeResponse = await app.scrapeUrl(`${projectUrl}`, {formats: ['markdown', 'html'],});
//     if (!scrapeResponse.success) {
//       res.status(401).json({msg: "Failed to scrape project", error: scrapeResponse.error });
//       return;
//     };
//     res.status(200).json({
//       message: "Project scraped successfully",
//       siteData: scrapeResponse.markdown,
//     });
   
//   } catch (err) {
//     res.status(500).json({ error: "Failed to create project", details: err });
//   }
// });




