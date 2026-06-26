import express from "express";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add JSON parsing middleware with a generous limit for syncing full database states
  app.use(express.json({ limit: '50mb' }));

  const HOST_DATA_URL = process.env.VITE_OMNI_HOST_DATA_URL || 'https://ais-dev-cspw766qmfzgzsulbjkhi4-78153391540.asia-east1.run.app/api/host-data/cswdo-office-supplies-system';

  // Server-side API Proxy routes for the Omni Host data store to bypass browser CORS restrictions
  app.get("/api/proxy-host-data", async (req, res) => {
    try {
      const response = await fetch(HOST_DATA_URL);
      if (!response.ok) {
        throw new Error(`Host API returned status ${response.status}`);
      }
      const text = await response.text();
      
      // Safe JSON parsing check
      const trimmed = text.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        console.warn("Omni Host API returned non-JSON content. Initializing with empty state.");
        return res.json({});
      }

      try {
        const data = JSON.parse(text);
        res.json(data);
      } catch (parseError: any) {
        console.warn("JSON parsing failed on Omni Host data. Returning empty state:", parseError.message);
        res.json({});
      }
    } catch (error: any) {
      console.error("Error proxying load from Omni Host:", error.message);
      // Always return valid JSON even on error
      res.status(200).json({ collections: {}, error: error.message });
    }
  });

  app.post("/api/proxy-host-data", async (req, res) => {
    try {
      const response = await fetch(HOST_DATA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });
      if (!response.ok) {
        throw new Error(`Host API returned status ${response.status}`);
      }
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        res.json(data);
      } catch (e) {
        res.json({ status: "success" });
      }
    } catch (error: any) {
      console.error("Error proxying save to Omni Host:", error.message);
      res.status(200).json({ error: error.message, status: "error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
