#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  readFileSync("./fishidy-credentials.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "fishidy-36f28.firebasestorage.app",
});

const db = admin.firestore();
const storage = admin.storage();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const server = new Server(
  {
    name: "fish-identification-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "identify_fish",
        description:
          "Identifies a fish from an image URL and stores result in database",
        inputSchema: {
          type: "object",
          properties: {
            imageUrl: {
              type: "string",
              description: "Firebase Storage path of the fish image",
            },
            imageDownloadUrl: {
              type: "string",
              description: "Firebase Storage download URL",
            },
            userId: {
              type: "string",
              description: "User ID who uploaded the image",
            },
            catchDetails: {
              type: "object",
              properties: {
                location: { type: "string" },
                method: { type: "string" },
                date: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
          required: ["imageUrl", "userId"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [{ type: "text", text: "No arguments provided" }],
      isError: true,
    };
  }

  try {
    if (name === "identify_fish") {
      const imageUrl = args.imageUrl as string;
      const imageDownloadUrl = args.imageDownloadUrl as string;
      const userId = args.userId as string;
      const catchDetails = args.catchDetails as any;

      // Get file reference
      const file = storage.bucket().file(imageUrl);

      // Check if file exists
      const [exists] = await file.exists();
      console.error(`File exists: ${exists}, Path: ${imageUrl}`);

      if (!exists) {
        throw new Error(`File not found: ${imageUrl}`);
      }

      // Get signed URL for Claude to access
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
      });

      console.error(`Signed URL: ${url}`);

      // Use Claude Vision to identify the fish
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "url",
                  url: url,
                },
              },
              {
                type: "text",
                text: `Please identify this fish and provide the following information in JSON format:
                {
                  "commonName": "string",
                  "scientificName": "string",
                  "family": "string",
                  "confidence": "high/medium/low",
                  "characteristics": ["list", "of", "key", "features"],
                  "habitat": "typical habitat description",
                  "averageSize": "size range",
                  "notes": "any additional interesting information"
                }
                
                If you cannot identify the fish with confidence, indicate that in the confidence field.`,
              },
            ],
          },
        ],
      });

      // Parse response
      const firstBlock = response.content[0];
      if (firstBlock.type !== "text") {
        throw new Error("Unexpected response type from Claude");
      }

      const identificationText = firstBlock.text;
      const identification = JSON.parse(
        identificationText.match(/\{[\s\S]*\}/)?.[0] || "{}"
      );

      // Store in Firestore
      const catchDoc = await db.collection("catches").add({
        userId,
        imageUrl: imageDownloadUrl,
        identification,
        catchDetails: catchDetails || {},
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                catchId: catchDoc.id,
                identification,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
