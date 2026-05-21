/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 升級版：使用 Llama 3.2 Vision 旗艦視覺大腦，支援嬰兒辨識、動態髮型與無吊帶限制
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
    res.status(200).send("🟢 AI Photo Booth Backend is running (Llama 3.2 Vision Ready).");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 啟動 Replicate Llama 3.2 Vision 進行高精密視覺解析...");

        // 🌟 核心修正：使用 Llama 3.2 Vision 旗艦級高速度、高精度模型，徹底解決冷啟動逾時問題
        const visionModel = "meta/llama-3.2-11b-vision-instruct";
        
        const visionPrompt = `Analyze this person's face and clothing carefully. Reply EXACTLY with these 8 lines. Do not add any extra greeting, markdown formatting, or bullet points:
GENDER: (baby, child, toddler, boy, girl, woman, or man)
EYES: (large or small)
HAIR: (describe hair: e.g., 'very short baby hair', 'bald', 'short hair', 'long hair tied in a ponytail', 'hair tied back', 'hair with bangs')
MOUTH: (describe exact mouth state: 'subtle smile', 'pouting lips', 'closed mouth', 'toothy smile', 'big laugh')
CLOTHING: (describe the exact top clothing, e.g. 'striped baby bib' or 'simple plain t-shirt'. Strictly state 'no overalls, no suspender straps')
GLASSES: (look extremely closely for clear, transparent, thin metallic, or dark-framed glasses; say 'wearing glasses' or 'no glasses')
EARRINGS: (wearing earrings or no earrings)
NECKLACE: (wearing a necklace or no necklace)`;

        // 🌟 修正：中性防呆備案，不強制套用女性、馬尾或眼鏡
        let rawFeatures = "GENDER: child\nEYES: large\nHAIR: short hair\nMOUTH: subtle smile\nCLOTHING: simple plain t-shirt, no overalls, no straps\nGLASSES: no glasses\nEARRINGS: no earrings\nNECKLACE: no necklace";

        try {
            const visionOutput = await replicate.run(visionModel, {
                input: {
                    image: image, 
                    prompt: visionPrompt,
                    max_new_tokens: 150
                }
            });
            
            if (visionOutput) {
                rawFeatures = Array.isArray(visionOutput) ? visionOutput.join("").trim() : String(visionOutput).trim();
                console.log("✅ 視覺精密解析結果:\n", rawFeatures);
            }
        } catch (visionError) {
            console.warn("⚠️ 視覺解析異常，啟用備用特徵:", visionError.message);
        }

        // 解析 Key-Value 特徵
        const lines = rawFeatures.split('\n');
        const parsed = {
            gender: "child",
            eyes: "large",
            hair: "short hair",
            mouth: "subtle smile",
            clothing: "simple plain t-shirt, no overalls, no straps",
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
                if (key === "MOUTH") parsed.mouth = value;
                if (key === "CLOTHING") parsed.clothing = value;
                if (key === "GLASSES") parsed.glasses = value;
                if (key === "EARRINGS") parsed.earrings = value;
                if (key === "NECKLACE") parsed.necklace = value;
            }
        });

        // 🌟 步驟三：組裝高對比度極簡手繪可愛漫畫雷雕提示詞
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        
        // 🌟 修正：移除先前寫死的 ", ponytail"，讓髮型與衣服細節 100% 動態生成，並強烈排除任何吊帶肩帶
        const assembledPrompt = `${triggerWord}, a high-contrast black and white minimalist hand-drawn manga and portrait illustration, cute manga aesthetic. Minimalist style, bold and powerful clean lines, high contrast monochrome (black ink on pure white paper). Laser engraving ready, pure white background, pure black lines, 1024x1024 resolution. Bold clean black lines, no thin lines, no sketchy lines, no gradients, no complex shading. Half-body manga portrait of a ${parsed.gender}, simple yet expressive facial features. Eyes are extremely ${parsed.eyes}, round, highly expressive, shoujo manga style eyes with large circular highlights. Hair is ${parsed.hair}. Mouth is a beautiful ${parsed.mouth}. Clothing is ${parsed.clothing}, strictly no overalls, no suspenders, no shoulder straps, no overalls straps. Hair and clothing area are filled with solid black ink blocks, clean sharp outlines. Details: ${parsed.glasses}, ${parsed.earrings}, ${parsed.necklace}.`;
        
        const negativePrompt = "overalls, suspenders, dungarees, shoulder straps, backpack straps, overalls straps, grey background, gray background, dark background, off-white, shadow, shading, gradient, colored background, skin tone, realistic, 3d, messy lines, text, watermark, signature";

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
                    guidance_scale: 9.0, // 拉高服從度以配合細節特徵
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
