# Arknights Tool Editor

A collaborative web-based editor for developing and editing JSON files in the Arknights Authorization Series projects.

## Features

✅ **Web-based JSON Editor** - Edit Box_id.json, Version.json, and searchWord.json directly in the browser  
✅ **GitHub Integration** - Authenticate with GitHub and create Pull Requests directly from the editor  
✅ **Branch Protection** - Prevents PRs to main branch (they will be rejected)  
✅ **Manual Commands** - Get copy-paste Git commands if you can't run the web app  
✅ **JSON Validation** - Real-time JSON format validation  

## Prerequisites

1. **Git must be installed** on your system
   - Download: https://git-scm.com/downloads
   - Verify installation: `git --version`

2. **GitHub Account** with a Personal Access Token (PAT)
   - Create token: https://github.com/settings/tokens
   - Required scopes: `repo` (full repository access)

3. **Node.js** (v14 or higher)
   - Download: https://nodejs.org/

## Installation & Setup

### Step 1: Clone the Repository
```bash
# Clone the GitHub mirror repository
git clone https://github.com/awadwd/ArknightsAuthorization_Series-mirror.git
cd ArknightsAuthorization_Series-mirror/arknightstoolWorkspace
```

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

# Edit server/.env and fill in your GitHub credentials
# GITHUB_USERNAME=your_username
# GITHUB_TOKEN=your_personal_access_token
```

### Step 4: Run the Application
```bash
# Terminal 1: Start the backend server
cd server
node server.js
# Or for development with auto-restart:
# npm run dev

# Terminal 2: Start the frontend development server
npm run dev
```

### Step 5: Access the Editor
Open your browser and navigate to:
```
http://localhost:5173
```

## Usage Guide

### 1. Authentication
- Enter your GitHub username and Personal Access Token
- Credentials are stored **locally only** and are not uploaded to any server
- Click "Authenticate" to validate your credentials

### 2. Repository Setup
- Click "Clone/Update Repository" to clone the GitHub repository locally
- The repository will be cloned to `server/data/repo/`

### 3. Editing Files
- Use the tabs to switch between `Box_id.json`, `Version.json`, and `searchWord.json`
- Edit the JSON content directly in the editor
- Real-time JSON validation shows if your JSON is valid

### 4. Saving and Creating PR
- Enter a commit message describing your changes
- Click "Save & Create PR"
- The editor will:
  1. Create a new branch (never commits to main)
  2. Save your changes to the file
  3. Commit and push the changes
  4. Create a Pull Request to the **dev branch** (NOT main)

### 5. Manual Git Commands
If you cannot run the web application, click "Get Manual Git Commands" to get a copy-paste list of Git commands you can run in your terminal.

## Important Rules

🚫 **NEVER create PRs to the main branch** - They will be **rejected**  
✅ **Always target the dev branch** for Pull Requests  
✅ **Validate your JSON** before saving - invalid JSON will cause errors  
✅ **Use descriptive commit messages** to help reviewers understand your changes  

## Project Structure

```
arknightstoolWorkspace/
├── server/                 # Backend Node.js server
│   ├── server.js          # Main server file
│   ├── package.json       # Server dependencies
│   ├── .env.example       # Environment variables template
│   └── data/              # Local data storage (git repo, config)
│       ├── config.json    # Local configuration
│       └── repo/          # Cloned repository
├── src/                   # Frontend Vue.js application
│   ├── App.vue           # Main Vue component
│   ├── main.js           # Vue entry point
│   └── index.css         # Global styles
├── public/               # Static assets
├── index.html            # HTML entry point
├── package.json          # Frontend dependencies
├── vite.config.js        # Vite configuration
└── README.md             # This file
```

## API Endpoints

The backend server provides the following API endpoints:

- `POST /api/auth/validate` - Validate GitHub credentials
- `GET /api/auth/status` - Check authentication status
- `POST /api/repo/clone` - Clone or update the repository
- `GET /api/files/:filename` - Get file content
- `POST /api/files/save` - Save file and create PR
- `GET /api/manual-commands` - Get manual Git commands
- `POST /api/repo/protect-main` - Protect main branch (admin only)

## Troubleshooting

### Authentication Fails
- Verify your GitHub token has `repo` scope
- Check that your username is correct
- Ensure the token hasn't expired

### Repository Clone Fails
- Check your internet connection
- Verify you have access to the repository
- Ensure Git is properly installed

### JSON Validation Errors
- Use a JSON validator to check your syntax
- Common errors: missing commas, unclosed brackets, trailing commas

### PR Creation Fails
- Ensure you're not trying to push to main branch
- Check that your branch name is unique
- Verify you have push access to the repository

## Contributing

1. Create a new branch from `dev` (not main)
2. Make your changes
3. Test thoroughly
4. Submit a PR to the `dev` branch
5. Wait for review and approval

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:
- GitHub Issues: https://github.com/awadwd/ArknightsAuthorization_Series-mirror/issues
- GitCode Mirror: https://gitcode.com/huangjinzhou1/ArknightsAuthorization_Series/issues

---

**Remember: Main branch is protected. All PRs must target the dev branch.**
