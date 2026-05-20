/**
 * AI 互動雷雕拍照系統 - 後端 API (Render 部署版)
 * 最終完美版：精準捕捉眼鏡與髮型特徵 ＋ 純白背景強制令
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
    res.status(200).send("🟢 AI Photo Booth Backend is running (LLaVA Vision + White BG).");
});

app.post('/api/generate-lineart', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: '未提供圖片資料' });

        console.log("🚀 [步驟一] 啟動 Replicate LLaVA 視覺模型分析照片...");

        // 🌟 使用聰明的 LLaVA 模型 (帶有穩定的版本號防呆)
        const llavaModel = "yorickvp/llava-13b:e2721573d8c313139360852ef4efb15ca50de99e39e0ad697b764d0bc904090b";
        
        // 🌟 嚴格命令：強迫 AI 必須回答髮型與是否戴眼鏡
        const visionPrompt = "Describe this person's face concisely. You MUST include: 1. Gender (woman/man), 2. Hair (e.g., long hair tied back, short hair), 3. Glasses (say EXACTLY 'wearing glasses' or 'no glasses'). Reply in a short comma-separated list.";

        // 防呆備案
        let description = "a woman looking at the camera"; 

        try {
            const llavaOutput = await replicate.run(llavaModel, {
                input: {
                    image: image, 
                    prompt: visionPrompt,
                    max_tokens: 30,
                    temperature: 0.2 // 讓 AI 回答更精準
                }
            });
            
            if (llavaOutput) {
                description = Array.isArray(llavaOutput) ? llavaOutput.join("").trim() : String(llavaOutput).trim();
                console.log("✅ 視覺解析成功:", description);
            }
        } catch (visionError) {
            console.warn("⚠️ 視覺解析異常，啟用備用特徵:", visionError.message);
        }

        // 🌟 步驟二：畫圖提示詞強化純白底色
        const triggerWord = process.env.REPLICATE_TRIGGER_WORD || "TOK_CUTELINE-SDXL";
        
        const assembledPrompt = `${triggerWord}, ${description}, minimalist black and white line art portrait, pure solid white background, #FFFFFF background, isolated on solid white canvas, clear black lines, laser engraving design.`;
        
        // 🌟 負向提示詞：死命封殺所有灰色與陰影
        const negativePrompt = "grey background, gray background, dark background, off-white, shadow, shading, gradient, colored background, skin tone, realistic, 3d, messy lines, text, watermark, signature";

        console.log("🚀 [步驟三] 呼叫 Replicate SDXL 進行雷雕線稿繪製...");
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
                    guidance_scale: 8.5, // 拉高服從度，確保特徵(眼鏡)與白底都被畫出來
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
            extractedFeatures: description 
        });

    } catch (error) {
        console.error("❌ 系統處理錯誤:", error);
        return res.status(500).json({ error: '影像處理失敗，請稍後再試。' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Photo Booth Backend 啟動於 PORT: ${PORT}`);
});
