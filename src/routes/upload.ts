import Router from 'express'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { usermiddleware } from '../middleware/usermiddleware'
import { PrismaClient } from '@prisma/client';
import FirecrawlApp, { CrawlParams, CrawlStatusResponse } from '@mendable/firecrawl-js';

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



uploadRouter.post('/github-upload', usermiddleware,async (req, res) => {

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });
    if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    };
    const { githubUrl } = req.body;

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
    
    // Clean up
    await fs.rm(tempPath, { recursive: true, force: true });

    console.log(`Found ${packageJsonFiles.length} package.json files`);

    const dependencies = [];
    for(let i=packageJsonFiles.length-1; i>=0;i--){
      let dependencie= packageJsonFiles[i].content.dependencies;
      if(dependencie){
        for (const key of Object.entries(dependencie)) {
          dependencies.push(key[0]);
        }
      }
    }
    
    res.json({
      readme,
      dependencies,
      message: 'Project parsed successfully',
    });
  } catch(err) {
    console.error('Error in github-upload:', err);
    res.status(500).json({ error: 'Failed to parse project', details: err });
  }
});



//live project
uploadRouter.post("/live-upload", usermiddleware,async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
  });
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { projectUrl } = req.body;

  // if (!projectUrl || !projectDescription) {
  //   res.status(400).json({ error: "Project URL and description are required" });
  // }

  try {
    const scrapeResponse = await app.scrapeUrl(`${projectUrl}`, {formats: ['markdown', 'html'],});
    if (!scrapeResponse.success) {
      res.status(401).json({msg: "Failed to scrape project", error: scrapeResponse.error });
      return;
    };
    const data = {"markdown": scrapeResponse.markdown, "metadata": scrapeResponse.metadata};
    res.status(200).json({
      message: "Project scraped successfully",
      siteData: scrapeResponse,
    });
   
  } catch (err) {
    res.status(500).json({ error: "Failed to create project", details: err });
  }
});


//ml project
uploadRouter.post("/ml_project",usermiddleware,async(req,res)=>{
    try{
        const userId = req.userId;
        if(!userId){
            res.status(401).json({error: "Unauthorized"});
            return;
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const description = req.body;
        res.json(description);
    }catch(e){
        console.error("Error in /ml_project route:", e);
        res.status(500).json({ error: "Internal server error" });
    }
});

