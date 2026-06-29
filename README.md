# PR Comment Resolver 🚀

PR Comment Resolver is a premium, AI-powered developer tool designed to fetch active pull request review comments directly from GitHub and suggest solutions instantly using Google Gemini.

The interface is built using a modern **light-theme glassmorphism** style with a responsive typography system inspired by top developer tools like Vercel and Linear.

---

## 🛠️ Architecture

The project consists of two main components:
1. **Frontend (`/pr-agent`)**: A React (Vite) application styled with a clean glassmorphic design, custom SVG icons, local loading animations, and copy-to-clipboard interactions.
2. **Backend (`/server`)**: A Node.js Express server that communicates with the GitHub REST API to fetch review comments and utilizes the `@google/generative-ai` SDK to resolve them.

---

## 📋 Prerequisites

Before running the application, make sure you have:
* [Node.js](https://nodejs.org/) installed (v18+ recommended)
* A GitHub Personal Access Token (PAT) with repository read permissions
* A Google Gemini API Key

---

## 🚀 Getting Started

### 1. Set Up the Backend Server

1. Navigate to the server folder:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure your environment variables. Create a `.env` file in the `server` directory:
   ```env
   PORT=8000
   GITHUB_TOKEN=your_github_personal_access_token
   GEMINI_API_KEY=your_gemini_api_key
   ```
4. Start the server:
   ```bash
   npm start
   ```
   The backend will be running on `http://localhost:8000`.

### 2. Set Up the Frontend App

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd pr-agent
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Launch the development server:
   ```bash
   npm run dev
   ```
   The React application will be hosted locally (usually on `http://localhost:5173`).

---

## 💻 How to Use

1. **Enter Repository Details**:
   - **Repository Owner**: The owner name (e.g., `google`).
   - **Repository Name**: The name of the repository (e.g., `generative-ai-js`).
   - **PR Number**: The numeric ID of the active pull request (e.g., `42`).
2. **Fetch Comments**: Click the **Fetch Comments** button. If comments exist, a vertical feed of review threads will populate.
3. **Analyze Code Context**:
   - Review cards showcase the exact file path and line number.
   - The diff block highlights the code context (additions shown in green, deletions in red).
   - Reviewer comments are displayed in structured chat bubbles.
4. **Resolve with AI**:
   - Click the **Resolve with AI** button.
   - The button shows a loading spinner during inference.
   - A glowing panel will slide down with the AI-suggested fix.
5. **Apply suggestion**: Use the **Copy Suggestion** button to copy the resolution immediately to your clipboard.
