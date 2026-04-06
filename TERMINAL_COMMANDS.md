# Terminal Commands Guide

This project contains both a Node.js frontend/backend and a Python FastAPI backend. Here are the commands you need to set up and run the different parts of the application.

## 1. Node.js (Frontend & Basic Server) Setup

First, install the necessary JavaScript dependencies.

```bash
# Install Node modules
npm install
```

### Running the Frontend

To start the Vite development server (React, Tailwind, Shadcn UI):

```bash
npm run dev
```

### Running the Node.js Server

To start the local Node backend proxy (which proxies AI chat requests if using the Node version):

```bash
npm run server
```

## 2. Python Backend (FastAPI) Setup

The project also uses a Python FastAPI backend for advanced chat capabilities, intent classification, and state machines.

### Setting up the Virtual Environment

Create and activate a Python virtual environment to keep dependencies isolated.

**For macOS/Linux:**
```bash
# Create a virtual environment named .venv
python -m venv .venv

# Activate the virtual environment
source .venv/bin/activate
```

**For Windows (Command Prompt or PowerShell):**
```bash
# Create a virtual environment named .venv
python -m venv .venv

# Activate the virtual environment
.venv\Scripts\activate
```

### Installing Dependencies

Once the virtual environment is activated, install the required Python packages:

```bash
pip install -r requirements.txt
```

### Running the Python FastAPI Backend

To start the Python backend server on your local machine with hot-reloading:

```bash
uvicorn app.main:app --reload
```
*(Alternatively, you can use `fastapi dev app/main.py` if you have the FastAPI CLI installed).*

## 3. Environment Variables

Don't forget to configure your environment variables. Copy `.env.example` to `.env` and fill in the required API keys (e.g., OpenAI, Supabase, Redis, Google Places API).

```bash
cp .env.example .env
```
