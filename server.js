/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 升級版：使用 LLaVA 1.5 結構化特徵解析 + 可愛漫畫手繪雷雕咒語
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 10000; 

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

app.get('/', (req, res) => {
    res.status(200).send("🟢 AI Photo Booth Backend is running (Manga Style Engrave Ready).");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 啟動 Replicate LLaVA v1.5 精密視覺解析...");

        const visionModel = "yorickvp/llava-v1.5-13b:2facb4a474a0462c15041b78b1ad70952ea46b52368eb2d2cebce45ce8636eca";
        
        // 🌟 核心修正：強制視覺大腦以 Key-Value 格式條列特徵
        const visionPrompt = `Analyze this person's face carefully and reply EXACTLY with these 7 lines. Do not add any extra greeting, markdown formatting, or bullet points:
GENDER: (woman or man)
EYES: (large or small)
HAIR: (describe length, hairstyle, bangs, parting, straight or wavy, e.g., "long straight hair with middle parting" or "boy style short hair with neat bangs")
NECKLINE: (crew neck, v-neck, square neck, turtleneck, or collared shirt)
GLASSES: (wearing glasses or no glasses)
EARRINGS: (wearing earrings or no earrings)
NECKLACE: (wearing a necklace or no necklace)`;

        // 預設特徵防護罩
        let rawFeatures = "GENDER: woman\nEYES: large\nHAIR: long hair\nNECKLINE: crew neck\nGLASSES: no glasses\nEARRINGS: no earrings\nNECKLACE: no necklace";

        try {
            const visionOutput = await replicate.run(visionModel, {
                input: {
                    image: image, 
                    prompt: visionPrompt,
                    max_tokens: 150,
                    temperature: 0.1
                }
            });
            
            if (visionOutput) {
                rawFeatures = Array.isArray(visionOutput) ? visionOutput.join("").trim() : String(visionOutput).trim();
                console.log("✅ 視覺精密解析結果:\n", rawFeatures);
            }
        } catch (visionError) {
            console.warn("⚠️ 視覺解析異常，啟用備用特徵:", visionError.message);
        }

        // 🌟 步驟二：解析 Key-Value 文字並代入您的客製化雷雕咒語
        const lines = rawFeatures.split('\n');
        const parsed = {
            gender: "woman",
            eyes: "large",
            hair: "long straight hair",
            neckline: "crew neck",
            glasses: "no glasses",
            earrings: "no earrings",
            necklace: "no necklace"
        };

        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim().toUpperCase();
                const value = parts.slice(1).join(':').trim();
                if (key === "GENDER") parsed.gender = value;
                if (key === "EYES") parsed.eyes = value;
                if (key === "HAIR") parsed.hair = value;
                if (key === "NECKLINE") parsed.neckline = value;
                if (key === "GLASSES") parsed.glasses = value;
                if (key === "EARRINGS") parsed.earrings = value;
                if (key === "NECKLACE") parsed.necklace = value;
            }
        });

        // 🌟 步驟三：組裝您的客製化可愛漫畫雷雕提示詞
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        
        const assembledPrompt = `${triggerWord}, a high-contrast black and white minimalist hand-drawn manga and portrait illustration, cute manga aesthetic. Minimalist style, bold and powerful clean lines, high contrast monochrome (black ink on pure white paper). Laser engraving ready, pure white background, pure black lines, 1024x1024 resolution. Bold clean black lines, no thin lines, no sketchy lines, no gradients, no complex shading. Half-body manga portrait, simple yet expressive facial features. Eyes are extremely ${parsed.eyes}, round, highly expressive, shoujo manga style eyes with large circular highlights. Hair is ${parsed.hair}. Hair and clothing area (${parsed.neckline}) are filled with solid black ink blocks, clean sharp outlines. Details: charming simple smile, ${parsed.glasses}, ${parsed.earrings}, ${parsed.necklace}.`;
        
        const negativePrompt = "grey background, gray background, dark background, off-white, shadow, shading, gradient, colored background, skin tone, realistic, 3d, messy lines, text, watermark, signature";

        console.log("🚀 [步驟四] 呼叫 Replicate SDXL 繪製極簡可愛漫畫線稿...");
        console.log("👉 最終咒語:", assembledPrompt);
        
        const modelVersion = process.env.REPLICATE_MODEL_VERSION; 
        const output = await replicate.run(
            modelVersion,
            {
                input: {
                    prompt: assembledPrompt,
                    negative_prompt: negativePrompt,
                    width: 1024,
                    height: 1024,
                    scheduler: "K_EULER",
                    num_outputs: 1,
                    guidance_scale: 8.5,
                    apply_watermark: false,
                    num_inference_steps: 30
                }
            }
        );

        const finalImageUrl = Array.isArray(output) ? output[0] : output;
        
        console.log("✅ 圖像生成成功！URL:", finalImageUrl);
        return res.status(200).json({ 
            success: true, 
            resultUrl: finalImageUrl,
            extractedFeatures: rawFeatures 
        });

    } catch (error) {
        console.error("❌ 系統處理錯誤:", error);
        return res.status(500).json({ error: '影像處理失敗，請稍後再試。' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Photo Booth Backend 啟動於 PORT: ${PORT}`);
});

現在只要將 GitHub 上的後端更新，並等 Render 亮綠燈部署成功後，再用右側的 Canvas 「快速預覽與除錯器」上傳照片測試，您就能看到完美的動態雷雕特徵解析囉！
