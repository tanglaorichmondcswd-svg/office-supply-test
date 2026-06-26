# Local Setup Guide

This guide explains how to run the **CSWDO Mabalacat City - Office Supplies System** locally on your PC and connect it to your OMNI Host Cockpit.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** or **yarn**
- An active Internet connection (to reach the Omni Host API and OmniServer WebSocket)

## Step-by-Step Installation

1. **Export the Project**
   - In the AI Studio UI, go to the **Settings** menu (top right).
   - Select **Export to ZIP** or **Export to GitHub**.
   - If exported to ZIP, extract the contents to a folder on your PC.

2. **Configure Environment Variables**
   - In the root of the project, copy `.env.example` to a new file named `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open the `.env` file and verify the configuration:
     - `VITE_OMNISERVER_URL`: Should point to your OmniServer.
     - `VITE_OMNISERVER_TOKEN`: Should be your authorized JWT token.
     - `VITE_OMNI_HOST_DATA_URL`: Set to your Omni Host API endpoint (defaults to the `cswdo-office-supplies-system` identifier for this app).
     - `VITE_PORT`: Set to `3003` (as requested) or your preferred port.

3. **Install Dependencies**
   - Open a terminal/command prompt in the project folder.
   - Run the following command to install required packages:
     ```bash
     npm install
     ```

4. **Run the Development Server**
   - Start the local server by running:
     ```bash
     npm run dev
     ```
   - The application will be accessible at `http://localhost:3003` (or the port specified in your `.env`).

5. **Production Build (Optional)**
   - To build the application for production:
     ```bash
     npm run build
     ```
   - The static files will be generated in the `dist/` directory.

## Connection to OMNI Host Cockpit

The application is configured to connect to the Omni Host API specified in your `.env` file. It uses:
- **Cloud Database Syncing**: Saving all persistent collections (items, requests, deliveries, budgets, movements) to your Omni Host API.
- **REST API**: For database operations (POST/GET).
- **WebSockets**: For real-time tracking (via `socket.io-client`).
- **File Uploads**: via the `/api/files/upload` endpoint.

Ensure your OMNI Host Cockpit dashboard is configured to accept connections from the domain/IP where you are hosting this application.
