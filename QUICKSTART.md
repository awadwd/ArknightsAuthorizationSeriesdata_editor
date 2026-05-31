# Quick Start Guide - Arknights Tool Editor

## 🚀 One-Command Startup

After installing dependencies, simply run:

```bash
npm start
```

This will:
1. ✅ Check and create `.env` file if missing
2. ✅ Start the backend server (Port 3000)
3. ✅ Wait 3 seconds for backend to initialize
4. ✅ Start the frontend dev server (Port 5173)
5. ✅ Display access URLs

## 📋 Complete Setup Instructions

### Step 1: Install Prerequisites

1. **Git** - https://git-scm.com/downloads
   ```bash
   git --version  # Verify installation
   ```

2. **Node.js** (v14+) - https://nodejs.org/
   ```bash
   node --version  # Verify installation
   npm --version   # Verify installation
   ```

3. **GitHub Personal Access Token**
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scope: ✅ `repo` (full repository access)
   - Generate and **copy the token** (you won't see it again!)

### Step 2: Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies  
cd server
npm install
cd ..
```

### Step 3: Configure Environment

```bash
# Copy the example environment file
cp server/.env.example server/.env

# Edit server/.env with your credentials
notepad server/.env  # Windows
# or
nano server/.env     # Linux/Mac
```

**Fill in your GitHub credentials:**
```env
GITHUB_USERNAME=your_github_username
GITHUB_TOKEN=ghp_your_token_here
```

### Step 4: Start the Application

```bash
npm start
```

The application will automatically:
- Create `.env` file if missing (you'll need to edit it)
- Start backend server at http://localhost:3000
- Start frontend at http://localhost:5173

### Step 5: Access the Editor

Open your browser and navigate to:
```
http://localhost:5173
```

## 🔧 Manual Startup (Alternative)

If `npm start` doesn't work, start servers manually:

**Terminal 1 (Backend):**
```bash
cd server
node server.js
# Or with auto-restart:
# npm run dev
```

**Terminal 2 (Frontend):**
```bash
npm run dev
```

## 📝 Using the Editor

### 1. Authentication
- Enter your GitHub username
- Enter your Personal Access Token
- Click "Authenticate"
- ✅ Credentials are stored **locally only**

### 2. Repository Setup
- Click "Clone/Update Repository"
- Waits for repository to clone (first time only)
- ✅ Repository clones to `server/data/repo/`

### 3. Edit Files
- Switch between `Box_id.json`, `Version.json`, `searchWord.json`
- Edit JSON directly in the editor
- ✅ Real-time JSON validation

### 4. Save and Create PR
- Enter a commit message
- Click "Save & Create PR"
- ✅ Automatically:
  - Creates a new branch (never commits to main)
  - Saves your changes
  - Commits and pushes
  - Creates PR to **dev branch** (NOT main)

### 5. Manual Commands (Fallback)
If the web app doesn't work:
- Click "Get Manual Git Commands"
- Copy the commands
- Run them in your terminal

## ⚠️ Important Rules

🚫 **NEVER commit to main branch** - PRs to main will be **rejected**  
✅ **Always target dev branch** for Pull Requests  
✅ **Validate JSON** before saving  
✅ **Use descriptive commit messages**  

## 🔍 Troubleshooting

### Problem: "Authentication failed"
- ✅ Check username is correct
- ✅ Check token has `repo` scope
- ✅ Check token hasn't expired
- ✅ Verify token at: https://github.com/settings/tokens

### Problem: "Repository clone failed"
- ✅ Check internet connection
- ✅ Check Git installation: `git --version`
- ✅ Verify repository access rights
- ✅ Check GitHub token permissions

### Problem: "JSON validation error"
- ✅ Use a JSON validator: https://jsonlint.com/
- ✅ Check for missing commas
- ✅ Check for unclosed brackets
- ✅ Check for trailing commas (not allowed in JSON)

### Problem: "PR creation failed"
- ✅ Ensure not pushing to main branch
- ✅ Check branch name is unique
- ✅ Verify push access to repository
- ✅ Check GitHub token hasn't expired

### Problem: "Port already in use"
- ✅ Change backend port in `server/.env` (PORT=3001)
- ✅ Change frontend port in `vite.config.js`
- ✅ Kill existing processes: `npx kill-port 3000 5173`

## 📚 Project Structure

```
arknightstoolWorkspace/
├── server/               # Backend (Node.js + Express)
│   ├── server.js        # Main server file
│   ├── package.json     # Backend dependencies
│   ├── .env.example     # Environment template
│   └── data/            # Local storage
│       ├── config.json  # Local config
│       └── repo/        # Cloned repository
├── src/                 # Frontend (Vue 3)
│   ├── App.vue         # Main component
│   ├── main.js         # Entry point
│   └── index.css       # Styles
├── start.js             # One-command startup
├── README.md            # Full documentation
└── QUICKSTART.md       # This file
```

## 🆘 Getting Help

1. **Check README.md** - Full documentation
2. **GitHub Issues** - https://github.com/awadwd/ArknightsAuthorization_Series-mirror/issues
3. **GitCode Mirror** - https://gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/issues

---

**Made with ❤️ for the Arknights community**
