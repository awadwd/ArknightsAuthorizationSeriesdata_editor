// Disable SSL certificate verification for development (to fix 'unable to verify the first certificate' error)
// TODO: Remove this in production and use proper SSL certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load environment variables
import 'dotenv/config';

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const { Octokit } = require('octokit');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// GitHub OAuth Config
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

// Middleware
// Allow all origins for development (will be restricted in production)
app.use(cors({
  origin: true, // Reflects the request origin
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add request logging
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  next();
});

// Data directory for local storage
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const REPO_DIR = path.join(DATA_DIR, 'repo');

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(REPO_DIR);

// Initialize config file if it doesn't exist
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeJsonSync(CONFIG_FILE, {
    github: {
      username: '',
      token: '',
      authenticated: false
    },
    repo: {
      gitcode: {
        owner: process.env.GITCODE_REPO_OWNER || 'huangjinzhou1',
        name: process.env.GITCODE_REPO_NAME || 'ArknightsAuthorization_Series'
      },
      github: {
        owner: process.env.GITHUB_REPO_OWNER || 'awadwd',
        name: process.env.GITHUB_REPO_NAME || 'ArknightsAuthorization_Series-mirror'
      }
    },
    targetBranch: process.env.TARGET_BRANCH || 'dev',
    baseBranch: process.env.BASE_BRANCH || 'main'
  });
}

// Helper function to get config
function getConfig() {
  return fs.readJsonSync(CONFIG_FILE);
}

// Helper function to save config
function saveConfig(config) {
  fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
}

// Helper function to init Octokit
function initOctokit(token) {
  return new Octokit({ auth: token });
}

// Routes

// 1. OAuth Login - Redirect to GitHub
app.get('/api/auth/login', (req, res) => {
  const scope = 'repo read:user';
  const state = Math.random().toString(36).substring(7);
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  console.log('OAuth login redirect:', authUrl);
  res.json({ authUrl, state });
});

// 2. OAuth Callback - Exchange code for token
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  console.log('OAuth callback:', { code, state });

  if (!code) {
    return res.status(400).send('<h1>授权失败</h1><p>缺少授权码</p><script>setTimeout(() => window.close(), 3000)</script>');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response:', tokenData);

    if (tokenData.error) {
      return res.status(400).send(`<h1>授权失败</h1><p>${tokenData.error_description || tokenData.error}</p><script>setTimeout(() => window.close(), 3000)</script>`);
    }

    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Arknights-Tool-Editor',
      },
    });

    const userData = await userResponse.json();
    console.log('User data:', userData.login);

    // Save to config
    const config = getConfig();
    config.github.username = userData.login;
    config.github.token = accessToken;
    config.github.authenticated = true;
    saveConfig(config);

    // Return success page that communicates with parent window
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>授权成功</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h1 style="color: #2e7d32;">✓ 授权成功</h1>
        <p>欢迎, <strong>${userData.login}</strong></p>
        <p>窗口将自动关闭...</p>
        <script>
          // Send to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'github-oauth-success',
              user: '${userData.login}',
              token: '${accessToken}'
            }, '*');
          }
          setTimeout(() => window.close(), 1500);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`<h1>授权失败</h1><p>${error.message}</p><script>setTimeout(() => window.close(), 3000)</script>`);
  }
});

// 3. Validate GitHub credentials (legacy PAT method)
app.post('/api/auth/validate', async (req, res) => {
  console.log('\n=== AUTH VALIDATION START ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { username, token } = req.body;
    
    if (!username || !token) {
      console.log('ERROR: Missing username or token');
      return res.status(400).json({ error: 'Username and token are required' });
    }
    
    console.log('Validating GitHub credentials...');
    console.log('Username:', username);
    console.log('Token (first 20 chars):', token.substring(0, 20) + '...');
    
    // Validate credentials using Octokit
    console.log('Initializing Octokit...');
    const octokit = initOctokit(token);
    
    console.log('Calling GitHub API: users.getAuthenticated()...');
    const { data } = await octokit.rest.users.getAuthenticated();
    
    console.log('GitHub API response:', JSON.stringify(data, null, 2));
    console.log('Authenticated user login:', data.login);
    console.log('Expected username:', username);
    
    // Check if authentication succeeded
    // For fine-grained PATs, we might not have data.login
    // So we just check that the API call succeeded (no error thrown)
    console.log('Authentication successful (API call succeeded)');
    
    // Optionally verify username if data.login is available
    if (data.login && data.login !== username) {
      console.log('WARNING: Token username mismatch');
      console.log('Token is for:', data.login);
      console.log('User entered:', username);
      
      // For fine-grained PATs, we'll allow it anyway but warn the user
      console.log('Proceeding with authentication anyway...');
    }
    
    // Save credentials to local config
    console.log('Saving credentials to config...');
    const config = getConfig();
    config.github.username = username;
    config.github.token = token;
    config.github.authenticated = true;
    saveConfig(config);
    console.log('Config saved successfully');
    
    console.log('=== AUTH VALIDATION SUCCESS ===\n');
    return res.json({ 
      success: true, 
      message: 'Authentication successful',
      user: data.login || username
    });
    
  } catch (error) {
    console.error('=== AUTH VALIDATION ERROR ===');
    console.error('Error:', error.message);
    console.error('Error status:', error.status);
    console.error('Error response:', error.response?.data);
    console.error('=== AUTH VALIDATION END ===\n');
    
    return res.status(401).json({ 
      error: 'Invalid credentials: ' + error.message,
      details: error.response?.data || error.message
    });
  }
});

// 2. Check authentication status
app.get('/api/auth/status', (req, res) => {
  const config = getConfig();
  return res.json({
    authenticated: config.github.authenticated,
    username: config.github.username || null
  });
});

// 3. Clone or update repository
app.post('/api/repo/clone', async (req, res) => {
  try {
    const config = getConfig();

    if (!config.github.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Embed token in URL to bypass DPI/network blocking
    const encodedUser = encodeURIComponent(config.github.username);
    const encodedToken = encodeURIComponent(config.github.token);
    const repoUrl = `https://${encodedUser}:${encodedToken}@github.com/${config.repo.github.owner}/${config.repo.github.name}.git`;

    console.log('Clone URL (credentials hidden):', `https://***@github.com/${config.repo.github.owner}/${config.repo.github.name}.git`);

    // Check if repo already exists
    const isRepo = fs.pathExistsSync(REPO_DIR) && await simpleGit(REPO_DIR).checkIsRepo().catch(() => false);

    if (!isRepo) {
      console.log('Cloning fresh repository...');
      // Use env vars to bypass SSL verification issues
      await simpleGit().env('GIT_SSL_NO_VERIFY', 'true').clone(repoUrl, REPO_DIR);
      console.log('Clone completed.');
    } else {
      console.log('Repository exists, pulling latest...');
      const git = simpleGit(REPO_DIR);
      // Update remote URL with token for push
      await git.remote(['set-url', 'origin', repoUrl]).catch(() => {});
      await git.env('GIT_SSL_NO_VERIFY', 'true').pull('origin', config.baseBranch);
      console.log('Pull completed.');
    }

    return res.json({ success: true, message: 'Repository ready' });
  } catch (error) {
    console.error('Repo clone error:', error);
    return res.status(500).json({ error: 'Failed to clone repository: ' + error.message });
  }
});

// 4. Get file content (query-based, matches frontend)
app.get('/api/repo/file', async (req, res) => {
  try {
    const config = getConfig();

    if (!config.github.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const filename = req.query.filename;
    const validFiles = ['Box_id.json', 'Version.json', 'searchWord.json'];

    if (!filename || !validFiles.includes(filename)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const filePath = path.join(REPO_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found. Please clone the repository first.' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return res.json({ success: true, content });
  } catch (error) {
    console.error('Get file error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 5. Save file and create PR
app.post('/api/repo/save-and-pr', async (req, res) => {
  try {
    const config = getConfig();

    if (!config.github.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { filename, content, commitMessage } = req.body;
    const validFiles = ['Box_id.json', 'Version.json', 'searchWord.json'];

    if (!validFiles.includes(filename)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Validate JSON
    try {
      JSON.parse(content);
    } catch (jsonError) {
      return res.status(400).json({ error: 'Invalid JSON format' });
    }

    // Check if repo exists
    const isRepo = fs.pathExistsSync(REPO_DIR) && await simpleGit(REPO_DIR).checkIsRepo().catch(() => false);
    if (!isRepo) {
      return res.status(400).json({ error: 'Repository not initialized. Please clone first.' });
    }

    const git = simpleGit(REPO_DIR);

    // Create new branch from dev
    const branchName = `update/${filename.replace('.json', '')}-${Date.now()}`;
    await git.checkoutBranch(branchName, `origin/${config.targetBranch}`).catch(async () => {
      // If remote branch doesn't exist yet, create from baseBranch
      await git.checkoutBranch(branchName, `origin/${config.baseBranch}`);
    });

    // Write file
    const filePath = path.join(REPO_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf8');

    // Commit and push
    await git.add(filePath);
    await git.commit(commitMessage || `Update ${filename}`);

    // Push to origin with token embedded
    const encodedUser = encodeURIComponent(config.github.username);
    const encodedToken = encodeURIComponent(config.github.token);
    const remoteUrl = `https://${encodedUser}:${encodedToken}@github.com/${config.repo.github.owner}/${config.repo.github.name}.git`;
    await git.remote(['set-url', 'origin', remoteUrl]).catch(() => {});
    await git.env('GIT_SSL_NO_VERIFY', 'true').push('origin', branchName, ['-u']);

    // Create PR using GitHub API — always target dev, NEVER main
    const octokit = initOctokit(config.github.token);
    const pr = await octokit.rest.pulls.create({
      owner: config.repo.github.owner,
      repo: config.repo.github.name,
      title: commitMessage || `Update ${filename}`,
      head: branchName,
      base: config.targetBranch, // Always dev — main is protected!
      body: `Auto-created PR via Arknights Tool Editor.\n\nFile: ${filename}\nBranch: ${branchName}`,
    });

    // Switch back to dev
    await git.checkout(config.targetBranch).catch(() => git.checkout('dev').catch(() => {}));

    return res.json({
      success: true,
      prUrl: pr.data.html_url,
      branchName,
      message: 'File saved and PR created successfully'
    });
  } catch (error) {
    console.error('Save and PR error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 6. Get manual Git commands for users who can't run the web app
app.get('/api/manual-commands', (req, res) => {
  const config = getConfig();
  
  const commands = `
# Manual Git Commands for Arknights Authorization Tool Editor
# Use these commands if you cannot run the web application

# 1. Clone the repository (if not already cloned)
git clone https://github.com/${config.repo.github.owner}/${config.repo.github.name}.git
cd ${config.repo.github.name}

# 2. Create a new branch (NEVER commit directly to main)
git checkout -b edit-filename-$(date +%s)

# 3. Edit the JSON files using your preferred editor
# - Box_id.json
# - Version.json
# - searchWord.json

# 4. Validate JSON format (important!)
# Use a JSON validator or parser to ensure valid JSON

# 5. Commit your changes
git add Box_id.json Version.json searchWord.json
git commit -m "Update JSON files via manual edit"

# 6. Push to your branch
git push origin edit-filename-$(date +%s)

# 7. Create a Pull Request to the dev branch (NOT main)
# Go to: https://github.com/${config.repo.github.owner}/${config.repo.github.name}/pulls
# - Set base branch to: ${config.targetBranch}
# - Set compare branch to: your branch name
# - Fill in PR title and description
# - Submit the PR

# IMPORTANT: 
# - NEVER submit PRs to the main branch (they will be rejected)
# - Always target the ${config.targetBranch} branch
# - Ensure all JSON files are valid before committing
`;
  
  return res.json({ success: true, commands });
});

// 7. Protect main branch (mock implementation)
app.post('/api/repo/protect-main', async (req, res) => {
  try {
    const config = getConfig();
    
    if (!config.github.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const octokit = initOctokit(config.github.token);
    
    // This requires admin access to the repository
    // In a real implementation, you would set up branch protection rules
    // For now, we'll just return a message
    return res.json({
      success: true,
      message: 'Main branch protection should be set up manually in GitHub repository settings. Go to Settings > Branches > Add rule for "main" branch.'
    });
  } catch (error) {
    console.error('Protect main error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 8. Image proxy for CORS bypass (B站图床等)
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Validate URL
    const allowedHosts = [
      'i0.hdslb.com',
      'i1.hdslb.com',
      'i2.hdslb.com',
      'media.prts.wiki',
      'avatars.githubusercontent.com',
    ];
    const urlObj = new URL(imageUrl);
    if (!allowedHosts.some(h => urlObj.hostname.endsWith(h) || urlObj.hostname === h)) {
      return res.status(403).json({ error: 'Host not allowed' });
    }

    // Fetch image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': urlObj.origin,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    console.error('Proxy image error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
