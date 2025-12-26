import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import sharp from "sharp";

admin.initializeApp({
  storageBucket: "fishidy-36f28.firebasestorage.app",
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const corsHandler = cors({ origin: true });

export const identifyFish = functions
  .runWith({
    secrets: ["ANTHROPIC_API_KEY"],
    memory: "1GB",
    timeoutSeconds: 300,
  })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      try {
        const { imageUrl, imageDownloadUrl, userId, catchDetails } = req.body;

        if (!imageUrl || !userId) {
          res.status(400).json({ error: "Missing required fields" });
          return;
        }

        // Fetch user info from Firebase Auth
        let userDisplayName = "Anonymous";
        let userPhotoURL: string | null = null;
        try {
          const userRecord = await admin.auth().getUser(userId);
          userDisplayName = userRecord.displayName || "Anonymous";
          userPhotoURL = userRecord.photoURL || null;
        } catch (authError) {
          console.warn("Could not fetch user info:", authError);
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        const anthropic = new Anthropic({ apiKey });

        // Download the original high-res image (up to 20MB)
        const file = bucket.file(imageUrl);
        const [imageBuffer] = await file.download();

        // We shrink the image ONLY for the AI call, keeping the original in Storage.
        const resizedBuffer = await sharp(imageBuffer)
          .resize(1568, 1568, {
            // Optimal long-edge for Claude
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();

        const base64Image = resizedBuffer.toString("base64");

        // Determine media type based on original path
        let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
          "image/jpeg";
        if (imageUrl.toLowerCase().endsWith(".png")) mediaType = "image/png";
        else if (imageUrl.toLowerCase().endsWith(".webp"))
          mediaType = "image/webp";
        else if (imageUrl.toLowerCase().endsWith(".gif"))
          mediaType = "image/gif";

        // Call Claude with the resized version
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64Image,
                  },
                },
                {
                  type: "text",
                  text: `Identify this fish species. Respond ONLY with valid JSON in this exact format:
{
  "commonName": "string",
  "scientificName": "string",
  "family": "string",
  "confidence": "high|medium|low",
  "characteristics": ["string"],
  "habitat": "string",
  "averageSize": "string",
  "notes": "string"
}`,
                },
              ],
            },
          ],
        });

        const textContent = message.content.find((c) => c.type === "text");
        if (!textContent || textContent.type !== "text") {
          throw new Error("No text response from Claude");
        }

        const cleanText = textContent.text
          .replace(/```json\n?|```\n?/g, "")
          .trim();
        const identification = JSON.parse(cleanText);

        // Store metadata in Firestore linked to the original 20MB image URL
        const catchDoc = await db.collection("catches").add({
          userId,
          userDisplayName: userDisplayName || "Anonymous",
          userPhotoURL: userPhotoURL || null,
          imageUrl: imageDownloadUrl,
          identification,
          catchDetails,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({
          id: catchDoc.id,
          identification,
          catchDetails,
        });
      } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
          error: "Failed to identify fish",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  });

// One-time backfill function to add user info to existing catches
export const backfillUserInfo = functions
  .runWith({
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
      try {
        const catchesSnapshot = await db.collection("catches").get();
        let updated = 0;
        let skipped = 0;

        for (const doc of catchesSnapshot.docs) {
          const data = doc.data();

          // Skip if already has user info
          if (data.userDisplayName && data.userDisplayName !== "Anonymous") {
            skipped++;
            continue;
          }

          // Fetch user info from Firebase Auth
          if (data.userId) {
            try {
              const userRecord = await admin.auth().getUser(data.userId);
              await doc.ref.update({
                userDisplayName: userRecord.displayName || "Anonymous",
                userPhotoURL: userRecord.photoURL || null,
              });
              updated++;
            } catch (authError) {
              console.warn(`Could not fetch user ${data.userId}:`, authError);
              skipped++;
            }
          }
        }

        res.json({
          message: "Backfill complete",
          updated,
          skipped,
          total: catchesSnapshot.size
        });
      } catch (error) {
        console.error("Backfill error:", error);
        res.status(500).json({ error: "Backfill failed" });
      }
    });
  });
