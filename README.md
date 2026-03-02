# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/c7d89d97-b10d-4ca2-8a19-abc422b1202f

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/c7d89d97-b10d-4ca2-8a19-abc422b1202f) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

### AI Chat (ChatGPT + Google Maps search)

The AI Chat uses OpenAI for replies and can search Google Maps when the user asks (e.g. “search nearby hospital in 90024”).

1. **Start the chat backend** (in a second terminal):
   ```sh
   npm run server
   ```
2. **Add keys to `.env`** in the project root (holdless-main):

   ```sh
   OPENAI_API_KEY=sk-your-openai-key-here
   GOOGLE_PLACES_API_KEY=your-google-places-api-key
   ```

   - `OPENAI_API_KEY` – required for ChatGPT. Without it, the app uses demo responses.
   - `GOOGLE_PLACES_API_KEY` – optional. Enables map search (hospitals, restaurants, etc. in a location). You can use the same key as “Google Maps API key” if you have **Places API** (or “Places API (New)”) enabled in [Google Cloud Console](https://console.cloud.google.com/apis/library).

Without `OPENAI_API_KEY`, the app falls back to built-in demo responses. The backend runs on port 3001; the Vite dev server proxies `/api` to it.

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/c7d89d97-b10d-4ca2-8a19-abc422b1202f) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
