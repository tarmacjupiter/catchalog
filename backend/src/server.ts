import express from "express";
import cors from "cors";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let mcpClient: Client;

async function initializeMCP() {
  const mcpServerPath = path.join(__dirname, "../../mcp-server");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: mcpServerPath, // Run from mcp-server directory
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    },
  });

  mcpClient = new Client(
    {
      name: "fishidy-backend",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await mcpClient.connect(transport);
  console.log("✅ MCP client connected");
}

app.post("/api/identify-fish", async (req, res) => {
  try {
    const { imageUrl, userId, catchDetails, imageDownloadUrl } = req.body;

    console.log("Identifying fish:", { imageUrl, userId });

    const result = await mcpClient.callTool({
      name: "identify_fish",
      arguments: {
        imageUrl,
        imageDownloadUrl,
        userId,
        catchDetails,
      },
    });

    if (result.isError) {
      throw new Error(result.content[0].text);
    }

    const response = JSON.parse(result.content[0].text);
    res.json(response);
  } catch (error: any) {
    console.error("Error identifying fish:", error);
    res.status(500).json({ error: error.message || "Failed to identify fish" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3001;

initializeMCP()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize MCP:", error);
    process.exit(1);
  });
